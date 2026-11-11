"""
advocate_notetaker_router.py — Consultation Notetaker API (Phase 1 MVP).

Prefix : /api/notetaker
Auth   : Every endpoint requires a valid JWT (current_user dependency).
         All writes additionally verify the caller owns the matter.
Flag   : FEATURE_ADVOCATE_NOTETAKER must be "true" in the environment;
         all endpoints return 503 when the flag is off.

Collections
-----------
nt_matters          — Advocate-owned case records.
nt_consultations    — Consultation sessions within a matter.
nt_consents         — Per-participant consent attestations.

State machine
-------------
DRAFT → CONSENT_PENDING → READY
  → (manual)        NOTE_DRAFT → APPROVED
  → (transcript)    TRANSCRIPT_REVIEW → NOTE_DRAFT → APPROVED
  → (audio)   IMPORTING → AUDIO_REVIEW → PROCESSING → TRANSCRIPT_REVIEW
                                                     → NOTE_DRAFT → APPROVED
Any state → FAILED | CANCELLED | INTERRUPTED
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Header
from pydantic import BaseModel, Field, model_validator

from dependencies import db, current_user
from services.object_storage import put_object, get_object
from services.notetaker_ai import generate_note_draft, transcribe_audio

logger = logging.getLogger("notetaker")

FEATURE_ON = os.environ.get("FEATURE_ADVOCATE_NOTETAKER", "false").lower() == "true"

router = APIRouter(prefix="/notetaker", tags=["notetaker"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())


def _guard():
    if not FEATURE_ON:
        raise HTTPException(503, "Consultation notetaker is not enabled.")


async def _require_advocate(user: dict = Depends(current_user)) -> dict:
    """Raise 403 if the caller has no advocate profile."""
    _guard()
    profile = await db.advocate_profiles.find_one({"user_id": user["id"]})
    if not profile:
        raise HTTPException(403, "An advocate profile is required to use the notetaker.")
    return user


async def _require_verified_advocate(user: dict = Depends(_require_advocate)) -> dict:
    """
    Raise 403 if the caller's advocate profile is not yet verified.
    Founder decision (2026-11): AI drafting, approval and export are
    blocked for unverified advocates. Manual note-taking and editing
    remain available regardless of verification status.
    """
    profile = await db.advocate_profiles.find_one({"user_id": user["id"]})
    if not profile or not profile.get("verified"):
        raise HTTPException(
            403,
            "This action requires a verified advocate profile. Your verification is pending review.",
        )
    return user


async def _get_matter(matter_id: str, user: dict) -> dict:
    """Fetch a matter owned by this user or raise 404."""
    doc = await db.nt_matters.find_one({"id": matter_id, "owner_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Matter not found.")
    return doc


def _normalize_sections(note: Optional[dict]) -> Optional[dict]:
    """
    Back-compat shim (2026-11 QA batch N1-C): historical documents created
    before the "verified_facts" → "facts_stated" rename still have the old
    key stored. This renames it at READ time only, on a shallow copy — it
    never mutates/rewrites the document in Mongo and never touches
    content_hash, so a previously-approved note's stored hash is byte-for-
    byte unchanged by this shim.
    """
    if not note or not isinstance(note, dict):
        return note
    sections = note.get("sections")
    if isinstance(sections, dict) and "verified_facts" in sections and "facts_stated" not in sections:
        sections = dict(sections)
        sections["facts_stated"] = sections.pop("verified_facts")
        note = {**note, "sections": sections}
    return note


def _normalize_consultation_doc(doc: dict) -> dict:
    """Apply the facts_stated back-compat shim to every note-shaped field."""
    doc["note_draft"] = _normalize_sections(doc.get("note_draft"))
    doc["approved_version"] = _normalize_sections(doc.get("approved_version"))
    doc["note_versions"] = [_normalize_sections(v) for v in doc.get("note_versions", [])]
    return doc


async def _get_consultation(consultation_id: str, user: dict) -> dict:
    """Fetch a consultation owned by this user or raise 404."""
    doc = await db.nt_consultations.find_one({"id": consultation_id, "owner_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Consultation not found.")
    return _normalize_consultation_doc(doc)


def _strip_id(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ── Enums ─────────────────────────────────────────────────────────────────────

class InputMethod(str, Enum):
    manual = "manual"
    transcript_import = "transcript_import"
    audio_import = "audio_import"


class ConsultationState(str, Enum):
    DRAFT = "DRAFT"
    CONSENT_PENDING = "CONSENT_PENDING"
    READY = "READY"
    IMPORTING = "IMPORTING"
    AUDIO_REVIEW = "AUDIO_REVIEW"
    PROCESSING = "PROCESSING"
    TRANSCRIPT_REVIEW = "TRANSCRIPT_REVIEW"
    NOTE_DRAFT = "NOTE_DRAFT"
    APPROVED = "APPROVED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    INTERRUPTED = "INTERRUPTED"
    CONSENT_WITHDRAWN = "CONSENT_WITHDRAWN"


class ConsentDecision(str, Enum):
    given = "given"
    declined = "declined"
    unknown = "unknown"
    withdrawn = "withdrawn"


# States in which consent can still be recorded or withdrawn (anything
# before the consultation is finalised/errored/cancelled/withdrawn).
_ACTIVE_FOR_CONSENT = {
    ConsultationState.DRAFT.value,
    ConsultationState.CONSENT_PENDING.value,
    ConsultationState.READY.value,
    ConsultationState.IMPORTING.value,
    ConsultationState.AUDIO_REVIEW.value,
    ConsultationState.PROCESSING.value,
    ConsultationState.TRANSCRIPT_REVIEW.value,
    ConsultationState.NOTE_DRAFT.value,
}


def _consent_readiness(consents: list[dict]) -> dict:
    """
    Compute the consent status from the LATEST decision per participant
    (by participant_name). Spec (2026-11 QA batch N1-B):
      - a declined or unknown decision on a *required* participant blocks
        recording, audio upload and AI drafting;
      - the consultation is only "ready" once every required participant
        has granted — note: if there are zero required participants on
        record, we deliberately do NOT treat that as vacuously ready
        (safer than the literal spec) and stay "pending" instead;
      - a withdrawal always wins and is terminal.
    Returns {"status": "not_started"|"pending"|"blocked"|"ready"|"withdrawn",
             "reason": str|None, "granted": int, "declined": int,
             "unknown": int, "withdrawn": int}.
    """
    latest: dict[str, dict] = {}
    for c in sorted(consents, key=lambda x: x["recorded_at"]):
        latest[c["participant_name"]] = c
    counts = {
        "granted": sum(1 for c in latest.values() if c["decision"] == "given"),
        "declined": sum(1 for c in latest.values() if c["decision"] == "declined"),
        "unknown": sum(1 for c in latest.values() if c["decision"] == "unknown"),
        "withdrawn": sum(1 for c in latest.values() if c["decision"] == "withdrawn"),
    }
    if not latest:
        return {"status": "not_started", "reason": None, **counts}

    if any(c["decision"] == "withdrawn" for c in latest.values()):
        return {"status": "withdrawn", "reason": "A participant withdrew consent.", **counts}

    required = [c for c in latest.values() if c.get("required", True)]
    blocking = [c for c in required if c["decision"] in ("declined", "unknown")]
    if blocking:
        names = ", ".join(sorted(c["participant_name"] for c in blocking))
        reason = (
            f"{names} must grant consent (currently declined or unknown) before recording, "
            f"audio upload or AI drafting can proceed."
        )
        return {"status": "blocked", "reason": reason, **counts}

    required_given = [c for c in required if c["decision"] == "given"]
    if required and len(required_given) == len(required):
        return {"status": "ready", "reason": None, **counts}

    return {"status": "pending", "reason": "Waiting for required participants to respond.", **counts}


# ── Pydantic models ───────────────────────────────────────────────────────────

class MatterIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    client_ref: Optional[str] = Field(None, max_length=200)


class ConsultationIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    date: str = Field(..., description="YYYY-MM-DD")
    purpose: str = Field(..., min_length=1, max_length=500)
    input_method: InputMethod
    language: Optional[str] = Field(None, max_length=10)


class ConsentIn(BaseModel):
    participant_name: str = Field(..., min_length=1, max_length=100)
    participant_role: Optional[str] = Field(None, max_length=100)
    decision: ConsentDecision
    required: bool = Field(True, description="Whether this participant's consent is required to proceed.")
    not_required_reason: Optional[str] = Field(
        None, max_length=300,
        description="Mandatory, stored justification when required=False.",
    )
    scope: List[str] = Field(
        default_factory=lambda: ["notes"],
        description="What was agreed to: notes, audio, transcription, storage.",
    )
    consent_notice_version: str = Field("v1", max_length=20)
    evidence_ref: Optional[str] = Field(None, max_length=300)

    @model_validator(mode="after")
    def _check_not_required_reason(self):
        if not self.required and not (self.not_required_reason or "").strip():
            raise ValueError("not_required_reason is required when required=False.")
        return self


class ConsentWithdrawIn(BaseModel):
    participant_name: str = Field(..., min_length=1, max_length=100)


class ConsentUpdateIn(BaseModel):
    decision: ConsentDecision


class ManualNotesIn(BaseModel):
    notes: str = Field(..., min_length=1)


class TranscriptImportIn(BaseModel):
    text: str = Field(..., min_length=1)


class TranscriptUpdateIn(BaseModel):
    working_transcript: Optional[str] = None
    speaker_labels: Optional[List[dict]] = None


class NoteUpdateIn(BaseModel):
    sections: Optional[dict] = None
    statute_citations: Optional[List[dict]] = None


class TaskDraftIn(BaseModel):
    action_indices: Optional[List[int]] = None  # None = all proposed_actions


# ── MATTERS ───────────────────────────────────────────────────────────────────

@router.post("/matters", status_code=201)
async def create_matter(body: MatterIn, user: dict = Depends(_require_advocate)):
    """Create a new matter (named client case)."""
    doc = {
        "id": _uuid(),
        "owner_id": user["id"],
        "title": body.title.strip(),
        "client_ref": (body.client_ref or "").strip() or None,
        "status": "active",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.nt_matters.insert_one(doc)
    return _strip_id(doc)


@router.get("/matters")
async def list_matters(user: dict = Depends(_require_advocate)):
    """List all active matters owned by the advocate."""
    cursor = db.nt_matters.find(
        {"owner_id": user["id"], "status": "active"},
        sort=[("created_at", -1)],
    )
    matters = [_strip_id(d) async for d in cursor]
    # Attach consultation counts
    for m in matters:
        m["consultation_count"] = await db.nt_consultations.count_documents(
            {"matter_id": m["id"]}
        )
    return matters


@router.get("/matters/{matter_id}")
async def get_matter(matter_id: str, user: dict = Depends(_require_advocate)):
    doc = await _get_matter(matter_id, user)
    doc["consultation_count"] = await db.nt_consultations.count_documents(
        {"matter_id": matter_id}
    )
    return _strip_id(doc)


# ── CONSULTATIONS ─────────────────────────────────────────────────────────────

@router.post("/matters/{matter_id}/consultations", status_code=201)
async def create_consultation(
    matter_id: str,
    body: ConsultationIn,
    user: dict = Depends(_require_advocate),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
):
    """
    Create a consultation inside a matter. Initial state is DRAFT.
    Idempotent when an Idempotency-Key header is supplied: a repeat call
    with the same key returns the consultation already created instead of
    making a second one.
    """
    await _get_matter(matter_id, user)  # ownership check

    if idempotency_key:
        existing = await db.nt_consultations.find_one(
            {"owner_id": user["id"], "idempotency_key": idempotency_key}
        )
        if existing:
            return _normalize_consultation_doc(_strip_id(existing))

    doc = {
        "id": _uuid(),
        "matter_id": matter_id,
        "owner_id": user["id"],
        "title": body.title.strip(),
        "date": body.date,
        "purpose": body.purpose.strip(),
        "input_method": body.input_method.value,
        "language": body.language,
        "state": ConsultationState.DRAFT.value,
        "created_at": _now(),
        "updated_at": _now(),
        "manual_only_override": False,
        # Content fields (populated as the consultation progresses)
        "manual_notes": None,
        "original_transcript": None,
        "working_transcript": None,
        "speaker_labels": [],
        "audio_storage_key": None,
        "audio_original_name": None,
        "audio_size_bytes": None,
        "audio_content_type": None,
        "note_draft": None,
        "note_versions": [],
        "approved_version": None,
        "processing_error": None,
    }
    if idempotency_key:
        doc["idempotency_key"] = idempotency_key  # only set when present — keeps the sparse unique index happy

    try:
        await db.nt_consultations.insert_one(doc)
    except Exception:
        if idempotency_key:
            existing = await db.nt_consultations.find_one(
                {"owner_id": user["id"], "idempotency_key": idempotency_key}
            )
            if existing:
                return _normalize_consultation_doc(_strip_id(existing))
        raise
    return _strip_id(doc)


@router.get("/matters/{matter_id}/consultations")
async def list_consultations(
    matter_id: str,
    user: dict = Depends(_require_advocate),
):
    await _get_matter(matter_id, user)
    cursor = db.nt_consultations.find(
        {"matter_id": matter_id, "owner_id": user["id"]},
        sort=[("created_at", -1)],
    )
    out = []
    async for d in cursor:
        d = _normalize_consultation_doc(d)
        consents = [c async for c in db.nt_consents.find({"consultation_id": d["id"]})]
        d["consent_summary"] = _consent_readiness(consents)
        out.append(_strip_id(d))
    return out


@router.get("/consultations/{consultation_id}")
async def get_consultation(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    doc = await _get_consultation(consultation_id, user)
    consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
    doc["consent_summary"] = _consent_readiness(consents)
    return _strip_id(doc)


@router.patch("/consultations/{consultation_id}/cancel")
async def cancel_consultation(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    """Explicitly cancel a consultation (sets state = CANCELLED)."""
    doc = await _get_consultation(consultation_id, user)
    terminal = {
        ConsultationState.APPROVED.value,
        ConsultationState.CANCELLED.value,
        ConsultationState.CONSENT_WITHDRAWN.value,
    }
    if doc["state"] in terminal:
        raise HTTPException(409, f"Cannot cancel a consultation in state {doc['state']}.")
    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {"state": ConsultationState.CANCELLED.value, "updated_at": _now()}},
    )
    return {"ok": True, "state": ConsultationState.CANCELLED.value}


# ── CONSENT ───────────────────────────────────────────────────────────────────

async def _apply_consent_decision(
    consultation_id: str,
    user: dict,
    *,
    participant_name: str,
    participant_role: Optional[str],
    decision: ConsentDecision,
    required: bool,
    not_required_reason: Optional[str],
    scope: List[str],
    consent_notice_version: str,
    evidence_ref: Optional[str],
    idempotency_key: Optional[str],
) -> dict:
    """
    Shared implementation behind both POST /consent and POST /consent/withdraw.
    Inserts one consent record, recomputes readiness from the latest
    decision per participant, and moves consultation state accordingly:
      - any required participant declined/unknown  -> CONSENT_PENDING (blocked)
      - a withdrawal                                -> CONSENT_WITHDRAWN (terminal, audited)
      - every required participant granted          -> READY (only promotes
        from DRAFT/CONSENT_PENDING; never auto-advances past READY)
      - a late-joining participant re-evaluates readiness and can demote an
        already-advanced consultation back to CONSENT_PENDING.
    """
    doc = await _get_consultation(consultation_id, user)

    if idempotency_key:
        existing = await db.nt_consents.find_one(
            {"consultation_id": consultation_id, "idempotency_key": idempotency_key}
        )
        if existing:
            fresh = await _get_consultation(consultation_id, user)
            consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
            summary = _consent_readiness(consents)
            existing.pop("_id", None)
            return {**existing, "consultation_state": fresh["state"], "consent_summary": summary}

    if doc["state"] not in _ACTIVE_FOR_CONSENT:
        raise HTTPException(409, f"Cannot record consent in state {doc['state']}.")

    consent_doc = {
        "id": _uuid(),
        "consultation_id": consultation_id,
        "matter_id": doc["matter_id"],
        "owner_id": user["id"],
        "participant_name": participant_name.strip(),
        "participant_role": (participant_role or "").strip() or None,
        "decision": decision.value,
        "required": required,
        "not_required_reason": (not_required_reason or "").strip() or None,
        "scope": scope,
        "consent_notice_version": consent_notice_version,
        "evidence_ref": (evidence_ref or "").strip() or None,
        "recorded_at": _now(),
        "withdrawn_at": _now() if decision == ConsentDecision.withdrawn else None,
        "attested_by": user["id"],
    }
    if idempotency_key:
        consent_doc["idempotency_key"] = idempotency_key

    try:
        await db.nt_consents.insert_one(consent_doc)
    except Exception:
        if idempotency_key:
            existing = await db.nt_consents.find_one(
                {"consultation_id": consultation_id, "idempotency_key": idempotency_key}
            )
            if existing:
                fresh = await _get_consultation(consultation_id, user)
                consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
                summary = _consent_readiness(consents)
                existing.pop("_id", None)
                return {**existing, "consultation_state": fresh["state"], "consent_summary": summary}
        raise

    all_consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
    summary = _consent_readiness(all_consents)

    current_state = doc["state"]
    new_state = current_state
    audit_event = None
    if summary["status"] == "withdrawn":
        new_state = ConsultationState.CONSENT_WITHDRAWN.value
        audit_event = "consent_withdrawn"
    elif summary["status"] == "blocked":
        new_state = ConsultationState.CONSENT_PENDING.value
    elif summary["status"] == "ready":
        if current_state in (ConsultationState.DRAFT.value, ConsultationState.CONSENT_PENDING.value):
            new_state = ConsultationState.READY.value
        # else: already progressed further — leave state untouched.
    else:  # "pending"
        if current_state == ConsultationState.DRAFT.value:
            new_state = ConsultationState.CONSENT_PENDING.value

    update_fields: dict = {"updated_at": _now()}
    if new_state != current_state:
        update_fields["state"] = new_state
    await db.nt_consultations.update_one({"id": consultation_id}, {"$set": update_fields})

    if audit_event:
        await db.nt_consent_audit.insert_one({
            "id": _uuid(),
            "consultation_id": consultation_id,
            "event": audit_event,
            "participant_name": consent_doc["participant_name"],
            "at": _now(),
            "by": user["id"],
        })

    consent_doc.pop("_id", None)
    return {**consent_doc, "consultation_state": new_state, "consent_summary": summary}


@router.post("/consultations/{consultation_id}/consent", status_code=201)
async def record_consent(
    consultation_id: str,
    body: ConsentIn,
    user: dict = Depends(_require_advocate),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
):
    """
    Record a participant consent decision (given / declined / unknown /
    withdrawn). A declined or unknown decision on a *required* participant
    blocks recording, audio upload and AI drafting — the consultation only
    reaches READY once every required participant has granted. Supports an
    Idempotency-Key header so a retried request returns the existing record
    instead of creating a duplicate.
    """
    return await _apply_consent_decision(
        consultation_id, user,
        participant_name=body.participant_name,
        participant_role=body.participant_role,
        decision=body.decision,
        required=body.required,
        not_required_reason=body.not_required_reason,
        scope=body.scope,
        consent_notice_version=body.consent_notice_version,
        evidence_ref=body.evidence_ref,
        idempotency_key=idempotency_key,
    )


@router.post("/consultations/{consultation_id}/consent/withdraw", status_code=201)
async def withdraw_consent(
    consultation_id: str,
    body: ConsentWithdrawIn,
    user: dict = Depends(_require_advocate),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
):
    """
    Withdraw a previously recorded consent for one participant, at any
    active stage. Immediately halts further capture/upload/AI processing
    (consultation moves to CONSENT_WITHDRAWN) and writes an audit event to
    nt_consent_audit. No data is deleted or modified — no retention policy
    is configured yet, so existing material is left exactly as it was.
    """
    result = await _apply_consent_decision(
        consultation_id, user,
        participant_name=body.participant_name,
        participant_role=None,
        decision=ConsentDecision.withdrawn,
        required=True,
        not_required_reason=None,
        scope=[],
        consent_notice_version="v1",
        evidence_ref=None,
        idempotency_key=idempotency_key,
    )
    result["retention_policy"] = "not_configured"
    return result


@router.post("/consultations/{consultation_id}/consent/continue-manual-only")
async def continue_manual_only(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    """
    Advocate explicitly chooses "Continue with manual notes only (no
    recording, no AI processing)" after consent was blocked. Sets
    manual_only_override (checked again in generate_note as defense in
    depth — AI drafting is permanently blocked for this consultation after
    this call) and moves the consultation to READY with input_method
    forced to manual so notes can be typed.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["state"] != ConsultationState.CONSENT_PENDING.value:
        raise HTTPException(
            409, f"This action is only available while consent is blocked (current state: {doc['state']})."
        )
    consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
    summary = _consent_readiness(consents)
    if summary["status"] != "blocked":
        raise HTTPException(409, "Consent is not currently blocked for this consultation.")

    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {
            "manual_only_override": True,
            "input_method": InputMethod.manual.value,
            "state": ConsultationState.READY.value,
            "updated_at": _now(),
        }},
    )
    return {"ok": True, "state": ConsultationState.READY.value, "manual_only_override": True}


@router.get("/consultations/{consultation_id}/consent")
async def list_consents(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    await _get_consultation(consultation_id, user)  # ownership
    cursor = db.nt_consents.find(
        {"consultation_id": consultation_id},
        sort=[("recorded_at", 1)],
    )
    return [_strip_id(c) async for c in cursor]


# ── MANUAL NOTES ──────────────────────────────────────────────────────────────

@router.post("/consultations/{consultation_id}/manual-notes")
async def save_manual_notes(
    consultation_id: str,
    body: ManualNotesIn,
    user: dict = Depends(_require_advocate),
):
    """
    Save or replace manual notes. Transitions state to NOTE_DRAFT.
    Allowed from: READY, NOTE_DRAFT.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["input_method"] != InputMethod.manual.value:
        raise HTTPException(400, "This consultation uses a different input method.")
    if doc["state"] not in (ConsultationState.READY.value, ConsultationState.NOTE_DRAFT.value):
        raise HTTPException(
            409, f"Cannot save manual notes in state {doc['state']}."
        )
    if doc["state"] == ConsultationState.READY.value and not doc.get("manual_only_override"):
        consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
        summary = _consent_readiness(consents)
        if summary["status"] != "ready":
            raise HTTPException(409, "Required participant consent must be granted before capturing notes.")

    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {
            "manual_notes": body.notes,
            "state": ConsultationState.NOTE_DRAFT.value,
            "updated_at": _now(),
        }},
    )
    return {"ok": True, "state": ConsultationState.NOTE_DRAFT.value}


# ── TRANSCRIPT IMPORT ─────────────────────────────────────────────────────────

@router.post("/consultations/{consultation_id}/transcript")
async def import_transcript(
    consultation_id: str,
    body: TranscriptImportIn,
    user: dict = Depends(_require_advocate),
):
    """
    Import a text transcript. Stores the original (immutable) and sets up
    the working copy. Transitions state to TRANSCRIPT_REVIEW.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["input_method"] != InputMethod.transcript_import.value:
        raise HTTPException(400, "This consultation uses a different input method.")
    if doc["state"] not in (ConsultationState.READY.value,):
        raise HTTPException(409, f"Cannot import transcript in state {doc['state']}.")
    consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
    summary = _consent_readiness(consents)
    if summary["status"] != "ready":
        raise HTTPException(409, "Required participant consent must be granted before importing.")

    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {
            "original_transcript": body.text,  # immutable
            "working_transcript": body.text,   # advocate edits this
            "state": ConsultationState.TRANSCRIPT_REVIEW.value,
            "updated_at": _now(),
        }},
    )
    return {"ok": True, "state": ConsultationState.TRANSCRIPT_REVIEW.value}


# ── AUDIO UPLOAD ──────────────────────────────────────────────────────────────

_ALLOWED_AUDIO = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/m4a", "audio/x-m4a", "audio/mp4"}
_ALLOWED_EXT   = {".mp3", ".wav", ".m4a"}
_MAX_BYTES     = 25 * 1024 * 1024  # 25 MB


@router.post("/consultations/{consultation_id}/audio")
async def upload_audio(
    consultation_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(_require_advocate),
):
    """
    Upload an audio file for transcription.
    1. Validates format and size.
    2. Stores to Emergent Object Storage.
    3. Transitions state to AUDIO_REVIEW.
    4. Returns immediately — transcription starts only when the advocate
       calls POST /audio/transcribe.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["input_method"] != InputMethod.audio_import.value:
        raise HTTPException(400, "This consultation uses a different input method.")
    if doc["state"] not in (ConsultationState.READY.value,):
        raise HTTPException(409, f"Cannot upload audio in state {doc['state']}.")
    consents = [c async for c in db.nt_consents.find({"consultation_id": consultation_id})]
    summary = _consent_readiness(consents)
    if summary["status"] != "ready":
        raise HTTPException(409, "Required participant consent must be granted before uploading.")

    # Extension check
    import os.path
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(
            400,
            f"Unsupported audio format '{ext}'. Allowed: mp3, wav, m4a.",
        )

    # Read and size-check
    audio_bytes = await file.read()
    if len(audio_bytes) > _MAX_BYTES:
        raise HTTPException(
            413,
            f"Audio file is {len(audio_bytes) // (1024*1024)} MB; maximum is 25 MB.",
        )
    if len(audio_bytes) == 0:
        raise HTTPException(400, "Audio file is empty.")

    # Content-type normalisation
    ct = (file.content_type or "").lower()
    if ct not in _ALLOWED_AUDIO:
        # Infer from extension
        ct = {"mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/m4a"}.get(ext.lstrip("."), "audio/mpeg")

    # SHA-256 for dedup / audit
    file_hash = hashlib.sha256(audio_bytes).hexdigest()
    storage_key = f"notetaker/{doc['matter_id']}/{consultation_id}/{file_hash}{ext}"

    # Upload to object storage
    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {"state": ConsultationState.IMPORTING.value, "updated_at": _now()}},
    )
    try:
        await put_object(storage_key, audio_bytes, ct)
    except Exception as e:
        await db.nt_consultations.update_one(
            {"id": consultation_id},
            {"$set": {
                "state": ConsultationState.FAILED.value,
                "processing_error": f"Storage upload failed: {e}",
                "updated_at": _now(),
            }},
        )
        raise HTTPException(502, "Audio storage upload failed.")

    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {
            "audio_storage_key": storage_key,
            "audio_original_name": file.filename,
            "audio_size_bytes": len(audio_bytes),
            "audio_content_type": ct,
            "state": ConsultationState.AUDIO_REVIEW.value,
            "processing_error": None,
            "updated_at": _now(),
        }},
    )
    return {
        "ok": True,
        "state": ConsultationState.AUDIO_REVIEW.value,
        "storage_key": storage_key,
        "size_bytes": len(audio_bytes),
    }


@router.delete("/consultations/{consultation_id}/audio")
async def cancel_audio(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    """Cancel an audio upload or in-progress transcription."""
    doc = await _get_consultation(consultation_id, user)
    cancellable = {
        ConsultationState.IMPORTING.value,
        ConsultationState.AUDIO_REVIEW.value,
        ConsultationState.PROCESSING.value,
    }
    if doc["state"] not in cancellable:
        raise HTTPException(409, f"Cannot cancel audio in state {doc['state']}.")
    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {
            "state": ConsultationState.CANCELLED.value,
            "updated_at": _now(),
        }},
    )
    return {"ok": True, "state": ConsultationState.CANCELLED.value}


@router.post("/consultations/{consultation_id}/audio/transcribe")
async def start_transcription(
    consultation_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(_require_advocate),
):
    """
    Begin Whisper transcription for an uploaded audio file.
    Transitions state to PROCESSING immediately; transcript arrives
    asynchronously. The frontend polls GET /consultations/{id} for
    state changes (PROCESSING → TRANSCRIPT_REVIEW | FAILED).
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["state"] != ConsultationState.AUDIO_REVIEW.value:
        raise HTTPException(409, f"Transcription can only start in AUDIO_REVIEW state (current: {doc['state']}).")
    if not doc.get("audio_storage_key"):
        raise HTTPException(409, "No audio file found for this consultation.")

    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {"state": ConsultationState.PROCESSING.value, "updated_at": _now()}},
    )
    background_tasks.add_task(
        _run_transcription,
        consultation_id=consultation_id,
        storage_key=doc["audio_storage_key"],
        filename=doc.get("audio_original_name", "audio.mp3"),
        content_type=doc.get("audio_content_type", "audio/mpeg"),
        language=doc.get("language"),
    )
    return {"ok": True, "state": ConsultationState.PROCESSING.value}


async def _run_transcription(
    consultation_id: str,
    storage_key: str,
    filename: str,
    content_type: str,
    language: str | None,
):
    """Background task: download audio, transcribe, update consultation."""
    try:
        audio_bytes, _ = await get_object(storage_key)
        text = await transcribe_audio(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
            language=language,
        )
        await db.nt_consultations.update_one(
            {"id": consultation_id},
            {"$set": {
                "original_transcript": text,
                "working_transcript": text,
                "state": ConsultationState.TRANSCRIPT_REVIEW.value,
                "processing_error": None,
                "updated_at": _now(),
            }},
        )
        logger.info("[notetaker] transcription complete for %s", consultation_id)
    except asyncio.CancelledError:
        await db.nt_consultations.update_one(
            {"id": consultation_id},
            {"$set": {
                "state": ConsultationState.INTERRUPTED.value,
                "processing_error": "Transcription was cancelled.",
                "updated_at": _now(),
            }},
        )
    except Exception as e:
        logger.error("[notetaker] transcription failed for %s: %s", consultation_id, e)
        await db.nt_consultations.update_one(
            {"id": consultation_id},
            {"$set": {
                "state": ConsultationState.FAILED.value,
                "processing_error": str(e)[:500],
                "updated_at": _now(),
            }},
        )


# ── TRANSCRIPT REVIEW ─────────────────────────────────────────────────────────

@router.patch("/consultations/{consultation_id}/transcript")
async def update_transcript(
    consultation_id: str,
    body: TranscriptUpdateIn,
    user: dict = Depends(_require_advocate),
):
    """
    Update the working copy of the transcript and/or speaker labels.
    The original_transcript is never modified.
    Allowed in state: TRANSCRIPT_REVIEW.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["state"] != ConsultationState.TRANSCRIPT_REVIEW.value:
        raise HTTPException(409, f"Transcript editing is only allowed in TRANSCRIPT_REVIEW state (current: {doc['state']}).")

    updates: dict = {"updated_at": _now()}
    if body.working_transcript is not None:
        updates["working_transcript"] = body.working_transcript
    if body.speaker_labels is not None:
        updates["speaker_labels"] = body.speaker_labels
    await db.nt_consultations.update_one({"id": consultation_id}, {"$set": updates})
    return {"ok": True}


@router.post("/consultations/{consultation_id}/transcript/approve")
async def approve_transcript(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    """
    Advocate approves the reviewed transcript.
    Transitions state to NOTE_DRAFT.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["state"] != ConsultationState.TRANSCRIPT_REVIEW.value:
        raise HTTPException(409, f"Transcript approval is only allowed in TRANSCRIPT_REVIEW state (current: {doc['state']}).")
    if not (doc.get("working_transcript") or "").strip():
        raise HTTPException(400, "Working transcript is empty; cannot approve.")

    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {"state": ConsultationState.NOTE_DRAFT.value, "updated_at": _now()}},
    )
    return {"ok": True, "state": ConsultationState.NOTE_DRAFT.value}


# ── NOTE GENERATION ───────────────────────────────────────────────────────────

@router.post("/consultations/{consultation_id}/note/generate")
async def generate_note(
    consultation_id: str,
    user: dict = Depends(_require_verified_advocate),
):
    """
    Generate a structured draft note using Claude Sonnet 5.5.
    Allowed in state: NOTE_DRAFT. Requires a verified advocate profile.
    Permanently blocked if this consultation is running under the
    "manual notes only, no AI processing" consent override.
    Returns the draft immediately (the LLM call is synchronous here
    because the structured JSON must be complete before the UI renders it).
    """
    doc = await _get_consultation(consultation_id, user)
    if doc.get("manual_only_override"):
        raise HTTPException(
            403,
            "AI drafting is blocked for this consultation because required participant "
            "consent was declined or unknown; it is running in manual-notes-only mode.",
        )
    if doc["state"] != ConsultationState.NOTE_DRAFT.value:
        raise HTTPException(
            409,
            f"Note generation is only allowed in NOTE_DRAFT state (current: {doc['state']}).",
        )

    # Choose the input content
    input_method = doc["input_method"]
    if input_method == InputMethod.manual.value:
        content = doc.get("manual_notes") or ""
    else:
        content = doc.get("working_transcript") or ""
    if not content.strip():
        raise HTTPException(400, "No content to generate a note from.")

    try:
        draft = await generate_note_draft(
            content=content,
            language=doc.get("language"),
            input_method=input_method,
        )
    except ValueError as e:
        raise HTTPException(502, f"Note generation failed: {e}")
    except Exception as e:
        logger.error("[notetaker] note generation error for %s: %s", consultation_id, e)
        raise HTTPException(502, "Note generation failed.")

    # Build the versioned draft
    version = len(doc.get("note_versions", [])) + 1
    draft_doc = {
        "version": version,
        "generated_at": _now(),
        **draft,
    }
    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {
            "note_draft": draft_doc,
            "updated_at": _now(),
        }},
    )
    return draft_doc


@router.get("/consultations/{consultation_id}/note")
async def get_note(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    doc = await _get_consultation(consultation_id, user)
    return {
        "note_draft": doc.get("note_draft"),
        "approved_version": doc.get("approved_version"),
        "note_versions": doc.get("note_versions", []),
        "state": doc["state"],
    }


@router.patch("/consultations/{consultation_id}/note")
async def update_note(
    consultation_id: str,
    body: NoteUpdateIn,
    user: dict = Depends(_require_advocate),
):
    """
    Advocate edits the note draft in-place.
    Allowed in state: NOTE_DRAFT.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["state"] != ConsultationState.NOTE_DRAFT.value:
        raise HTTPException(409, f"Note editing is only allowed in NOTE_DRAFT state (current: {doc['state']}).")
    if not doc.get("note_draft"):
        raise HTTPException(400, "No draft exists yet. Generate one first.")

    updates: dict = {"updated_at": _now()}
    draft = dict(doc["note_draft"])
    if body.sections is not None:
        draft["sections"] = body.sections
    if body.statute_citations is not None:
        draft["statute_citations"] = body.statute_citations
    updates["note_draft"] = draft
    await db.nt_consultations.update_one({"id": consultation_id}, {"$set": updates})
    return {"ok": True, "note_draft": draft}


@router.post("/consultations/{consultation_id}/note/approve")
async def approve_note(
    consultation_id: str,
    user: dict = Depends(_require_verified_advocate),
):
    """
    Approve the current draft note. Creates an immutable approved_version.
    Transitions state to APPROVED. Requires a verified advocate profile.
    Idempotent: if this consultation is already APPROVED, returns the
    existing approved version instead of erroring or recomputing anything
    — the stored content_hash is never recomputed on a repeat call.
    """
    doc = await _get_consultation(consultation_id, user)

    if doc["state"] == ConsultationState.APPROVED.value and doc.get("approved_version"):
        existing = doc["approved_version"]
        return {
            "ok": True,
            "state": ConsultationState.APPROVED.value,
            "content_hash": existing.get("content_hash"),
            "version": existing.get("version"),
            "already_approved": True,
        }

    if doc["state"] != ConsultationState.NOTE_DRAFT.value:
        raise HTTPException(409, f"Note approval is only allowed in NOTE_DRAFT state (current: {doc['state']}).")
    if not doc.get("note_draft"):
        raise HTTPException(400, "No draft exists. Generate one before approving.")

    draft = doc["note_draft"]
    # Content hash of the approved version for audit trail
    import json as _json
    content_hash = hashlib.sha256(
        _json.dumps(draft, sort_keys=True).encode()
    ).hexdigest()[:16]

    approved = {
        **draft,
        "approved_at": _now(),
        "approved_by": user["id"],
        "content_hash": content_hash,
    }
    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {
            "approved_version": approved,
            "state": ConsultationState.APPROVED.value,
            "updated_at": _now(),
        }, "$push": {"note_versions": approved}},
    )
    return {
        "ok": True,
        "state": ConsultationState.APPROVED.value,
        "content_hash": content_hash,
        "version": approved.get("version"),
        "already_approved": False,
    }


# ── EXPORT ────────────────────────────────────────────────────────────────────

@router.get("/consultations/{consultation_id}/export")
async def export_note(
    consultation_id: str,
    fmt: str = "text",
    user: dict = Depends(_require_verified_advocate),
):
    """
    Export the approved note as plain text. Requires a verified advocate
    profile.
    fmt=text (default) returns a plain-text string.
    fmt=json returns the raw approved_version dict.
    PDF export is handled on the frontend via the device share sheet.
    """
    doc = await _get_consultation(consultation_id, user)
    approved = doc.get("approved_version")
    if not approved:
        raise HTTPException(409, "No approved version exists for this consultation.")

    if fmt == "json":
        return approved

    # Plain text rendering
    lines: list[str] = []
    matter = await db.nt_matters.find_one({"id": doc["matter_id"]})
    lines.append(f"DHARA CONSULTATION NOTE")
    lines.append(f"Matter  : {matter['title'] if matter else doc['matter_id']}")
    lines.append(f"Title   : {doc['title']}")
    lines.append(f"Date    : {doc['date']}")
    lines.append(f"Approved: {approved.get('approved_at', '')}")
    lines.append(f"Hash    : {approved.get('content_hash', '')}")
    lines.append("=" * 60)

    sections = approved.get("sections", {})
    section_labels = [
        ("facts_stated", "FACTS STATED BY PARTICIPANTS"),
        ("client_instructions", "CLIENT INSTRUCTIONS"),
        ("advice_given", "ADVICE GIVEN"),
        ("open_uncertainties", "OPEN UNCERTAINTIES"),
        ("proposed_actions", "PROPOSED ACTIONS"),
    ]
    for key, label in section_labels:
        items = sections.get(key, [])
        if items:
            lines.append(f"\n{label}")
            lines.append("-" * len(label))
            for i, item in enumerate(items, 1):
                lines.append(f"{i}. {item.get('text', '')}")
                if item.get("source_ref"):
                    lines.append(f"   Source: {item['source_ref']}")
                if item.get("assignee"):
                    lines.append(f"   Assignee: {item['assignee']}")

    cites = approved.get("statute_citations", [])
    if cites:
        lines.append("\nSTATUTE CITATIONS")
        lines.append("-" * 17)
        for c in cites:
            lines.append(f"• {c.get('statute', '')} {c.get('section', '')} — {c.get('relevance', '')}")

    lines.append("\n" + "=" * 60)
    lines.append("This note was generated by DHARA Consultation Notetaker.")
    lines.append("It records what the advocate attested was said during the consultation.")

    from fastapi.responses import PlainTextResponse
    return PlainTextResponse("\n".join(lines), headers={
        "Content-Disposition": f'attachment; filename="consultation-{consultation_id[:8]}.txt"'
    })


# ── TASK DRAFTS ───────────────────────────────────────────────────────────────

@router.post("/consultations/{consultation_id}/tasks", status_code=201)
async def create_task_drafts(
    consultation_id: str,
    body: TaskDraftIn,
    user: dict = Depends(_require_advocate),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
):
    """
    Create local task drafts from the proposed_actions in the approved note.
    Idempotent: enforced by a unique index on
    (consultation_id, note_version, action_index) — a repeat call for the
    same approved version and action returns the task already created
    instead of making a duplicate. An optional Idempotency-Key header is a
    second guard for exact-retry detection.
    """
    doc = await _get_consultation(consultation_id, user)
    approved = doc.get("approved_version")
    if not approved:
        raise HTTPException(409, "No approved version exists.")
    note_version = approved.get("version")

    if idempotency_key:
        by_key = [t async for t in db.nt_tasks.find({
            "consultation_id": consultation_id, "idempotency_key": idempotency_key,
        })]
        if by_key:
            for t in by_key:
                t.pop("_id", None)
            return {"tasks_created": 0, "tasks": by_key, "already_created": True}

    all_actions = approved.get("sections", {}).get("proposed_actions", [])
    if not all_actions:
        return {"tasks_created": 0, "tasks": []}

    indices = body.action_indices if body.action_indices is not None else list(range(len(all_actions)))
    result_tasks = []
    newly_created = 0
    for idx in indices:
        if not (0 <= idx < len(all_actions)):
            continue
        existing = await db.nt_tasks.find_one({
            "consultation_id": consultation_id, "note_version": note_version, "action_index": idx,
        })
        if existing:
            existing.pop("_id", None)
            result_tasks.append(existing)
            continue

        action = all_actions[idx]
        task = {
            "id": _uuid(),
            "consultation_id": consultation_id,
            "matter_id": doc["matter_id"],
            "owner_id": user["id"],
            "note_version": note_version,
            "action_index": idx,
            "text": action.get("text", ""),
            "assignee": action.get("assignee", "advocate"),
            "source_ref": action.get("source_ref", ""),
            "status": "pending",
            "created_at": _now(),
        }
        if idempotency_key:
            task["idempotency_key"] = idempotency_key

        try:
            await db.nt_tasks.insert_one(task)
        except Exception:
            # Unique-index race: a concurrent request just inserted the same
            # (consultation_id, note_version, action_index) — fetch it back
            # instead of erroring or duplicating.
            existing = await db.nt_tasks.find_one({
                "consultation_id": consultation_id, "note_version": note_version, "action_index": idx,
            })
            if existing:
                existing.pop("_id", None)
                result_tasks.append(existing)
            continue

        task.pop("_id", None)
        result_tasks.append(task)
        newly_created += 1

    return {
        "tasks_created": newly_created,
        "tasks": result_tasks,
        "already_created": newly_created == 0 and len(result_tasks) > 0,
    }


class TaskStatusIn(BaseModel):
    status: str = Field(..., pattern="^(done|pending)$")


@router.get("/tasks")
async def list_tasks(status: str = "pending", user: dict = Depends(_require_advocate)):
    """
    List task drafts for the authenticated advocate.
    status=pending (default) | done | all.
    Each task is annotated with its matter/consultation title for display,
    so the task list screen never has to make per-task follow-up calls.
    """
    query: dict = {"owner_id": user["id"]}
    if status != "all":
        query["status"] = status
    cursor = db.nt_tasks.find(query, sort=[("created_at", -1)])
    tasks = [_strip_id(t) async for t in cursor]

    matter_ids = {t["matter_id"] for t in tasks}
    consultation_ids = {t["consultation_id"] for t in tasks}
    matters = {
        m["id"]: m["title"]
        async for m in db.nt_matters.find({"id": {"$in": list(matter_ids)}})
    } if matter_ids else {}
    consultations = {
        c["id"]: c["title"]
        async for c in db.nt_consultations.find({"id": {"$in": list(consultation_ids)}})
    } if consultation_ids else {}
    for t in tasks:
        t["matter_title"] = matters.get(t["matter_id"])
        t["consultation_title"] = consultations.get(t["consultation_id"])
    return tasks


@router.patch("/tasks/{task_id}/status")
async def update_task_status(
    task_id: str,
    body: TaskStatusIn,
    user: dict = Depends(_require_advocate),
):
    """Mark a task draft done, or undo that back to pending."""
    doc = await db.nt_tasks.find_one({"id": task_id, "owner_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Task not found.")
    updates: dict = {"status": body.status}
    updates["completed_at"] = _now() if body.status == "done" else None
    await db.nt_tasks.update_one({"id": task_id}, {"$set": updates})
    return {"ok": True, "status": body.status}
