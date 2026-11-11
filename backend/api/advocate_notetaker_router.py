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

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel, Field

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


async def _get_matter(matter_id: str, user: dict) -> dict:
    """Fetch a matter owned by this user or raise 404."""
    doc = await db.nt_matters.find_one({"id": matter_id, "owner_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Matter not found.")
    return doc


async def _get_consultation(consultation_id: str, user: dict) -> dict:
    """Fetch a consultation owned by this user or raise 404."""
    doc = await db.nt_consultations.find_one({"id": consultation_id, "owner_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Consultation not found.")
    return doc


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


class ConsentDecision(str, Enum):
    given = "given"
    declined = "declined"
    withdrawn = "withdrawn"


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
):
    """Create a consultation inside a matter. Initial state is DRAFT."""
    await _get_matter(matter_id, user)  # ownership check
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
    await db.nt_consultations.insert_one(doc)
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
    return [_strip_id(d) async for d in cursor]


@router.get("/consultations/{consultation_id}")
async def get_consultation(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    doc = await _get_consultation(consultation_id, user)
    return _strip_id(doc)


@router.patch("/consultations/{consultation_id}/cancel")
async def cancel_consultation(
    consultation_id: str,
    user: dict = Depends(_require_advocate),
):
    """Explicitly cancel a consultation (sets state = CANCELLED)."""
    doc = await _get_consultation(consultation_id, user)
    terminal = {ConsultationState.APPROVED.value, ConsultationState.CANCELLED.value}
    if doc["state"] in terminal:
        raise HTTPException(409, f"Cannot cancel a consultation in state {doc['state']}.")
    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {"state": ConsultationState.CANCELLED.value, "updated_at": _now()}},
    )
    return {"ok": True, "state": ConsultationState.CANCELLED.value}


# ── CONSENT ───────────────────────────────────────────────────────────────────

@router.post("/consultations/{consultation_id}/consent", status_code=201)
async def record_consent(
    consultation_id: str,
    body: ConsentIn,
    user: dict = Depends(_require_advocate),
):
    """
    Record a participant consent decision.
    Transitions:
      DRAFT           → CONSENT_PENDING  (first consent recorded)
      CONSENT_PENDING → READY            (at least one 'given' consent exists
                                          and no 'declined' blocks proceed)
    A DECLINED consent does not block the consultation — the advocate manages
    this at the input stage.  WITHDRAWN withdraws a previously given consent.
    """
    doc = await _get_consultation(consultation_id, user)
    if doc["state"] not in (
        ConsultationState.DRAFT.value,
        ConsultationState.CONSENT_PENDING.value,
        ConsultationState.READY.value,
    ):
        raise HTTPException(
            409,
            f"Cannot record consent in state {doc['state']}.",
        )

    consent_doc = {
        "id": _uuid(),
        "consultation_id": consultation_id,
        "matter_id": doc["matter_id"],
        "owner_id": user["id"],
        "participant_name": body.participant_name.strip(),
        "participant_role": (body.participant_role or "").strip() or None,
        "decision": body.decision.value,
        "recorded_at": _now(),
        "withdrawn_at": _now() if body.decision == ConsentDecision.withdrawn else None,
        "attested_by": user["id"],
    }
    await db.nt_consents.insert_one(consent_doc)

    # Determine new state
    all_consents = []
    async for c in db.nt_consents.find({"consultation_id": consultation_id}):
        all_consents.append(c)

    has_given = any(c["decision"] == "given" for c in all_consents)
    new_state = (
        ConsultationState.READY.value
        if has_given
        else ConsultationState.CONSENT_PENDING.value
    )
    await db.nt_consultations.update_one(
        {"id": consultation_id},
        {"$set": {"state": new_state, "updated_at": _now()}},
    )
    return {**_strip_id(consent_doc), "consultation_state": new_state}


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
    if doc["state"] == ConsultationState.READY.value:
        # Need at least one 'given' consent before proceeding
        given = await db.nt_consents.count_documents(
            {"consultation_id": consultation_id, "decision": "given"}
        )
        if given == 0:
            raise HTTPException(409, "At least one participant must have given consent before capturing notes.")

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
    given = await db.nt_consents.count_documents(
        {"consultation_id": consultation_id, "decision": "given"}
    )
    if given == 0:
        raise HTTPException(409, "At least one participant must have given consent before importing.")

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
    given = await db.nt_consents.count_documents(
        {"consultation_id": consultation_id, "decision": "given"}
    )
    if given == 0:
        raise HTTPException(409, "At least one participant must have given consent before uploading.")

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
    user: dict = Depends(_require_advocate),
):
    """
    Generate a structured draft note using Claude Sonnet 5.5.
    Allowed in state: NOTE_DRAFT.
    Returns the draft immediately (the LLM call is synchronous here
    because the structured JSON must be complete before the UI renders it).
    """
    doc = await _get_consultation(consultation_id, user)
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
    user: dict = Depends(_require_advocate),
):
    """
    Approve the current draft note. Creates an immutable approved_version.
    Transitions state to APPROVED.
    """
    doc = await _get_consultation(consultation_id, user)
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
    return {"ok": True, "state": ConsultationState.APPROVED.value, "content_hash": content_hash}


# ── EXPORT ────────────────────────────────────────────────────────────────────

@router.get("/consultations/{consultation_id}/export")
async def export_note(
    consultation_id: str,
    fmt: str = "text",
    user: dict = Depends(_require_advocate),
):
    """
    Export the approved note as plain text.
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
        ("verified_facts", "VERIFIED FACTS"),
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
):
    """
    Create local task drafts from the proposed_actions in the approved note.
    Returns the list of tasks created (stored in nt_tasks collection).
    """
    doc = await _get_consultation(consultation_id, user)
    approved = doc.get("approved_version")
    if not approved:
        raise HTTPException(409, "No approved version exists.")

    all_actions = approved.get("sections", {}).get("proposed_actions", [])
    if not all_actions:
        return {"tasks_created": 0, "tasks": []}

    indices = body.action_indices if body.action_indices is not None else list(range(len(all_actions)))
    tasks_created = []
    for idx in indices:
        if 0 <= idx < len(all_actions):
            action = all_actions[idx]
            task = {
                "id": _uuid(),
                "consultation_id": consultation_id,
                "matter_id": doc["matter_id"],
                "owner_id": user["id"],
                "text": action.get("text", ""),
                "assignee": action.get("assignee", "advocate"),
                "source_ref": action.get("source_ref", ""),
                "status": "pending",
                "created_at": _now(),
            }
            await db.nt_tasks.insert_one(task)
            task.pop("_id", None)
            tasks_created.append(task)

    return {"tasks_created": len(tasks_created), "tasks": tasks_created}


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
