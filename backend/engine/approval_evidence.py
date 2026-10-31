"""Approval Evidence Gate — P0 containment (T03, Batch A legal-release
containment, DHARA-Team-Delivery-Tracker-2026-10-26.xlsx).

Historical/successor "this old text still governs" framing (and, in a
future batch, correspondence/relationship claims such as IPC<->BNS mapping
tables) must never be granted merely because a corpus entry or stored flag
says so. This module is the single place that checks for an actual,
reviewer-identified, hash-bound, unrevoked approval record before such
framing is allowed to reach a user. Everything else must fail closed.

NO APPROVALS ARE SEEDED HERE OR BY ANY ENGINEERING/AGENT WORK. The on-disk
registry (backend/data/approval_evidence_registry.json) starts and stays
empty until an authorized legal reviewer populates it out-of-band. Missing,
malformed, revoked, or hash-mismatched evidence all fail closed identically
to "no approval at all" — callers must fall back to the standard
dead/superseded treatment, never to the historical/correspondence framing.

Hash scheme versions
--------------------
v0 (legacy, pre-2026-10-31): content_hash = SHA-256(subject_key_string)
    e.g. SHA-256("IPC:166A->BNS:199") = eedb095a...
    Used by REGISTRY-001-IPC166A-BNS199 (the only existing record).
    Registry records with no "schema_version" field are treated as v0.

v1 (canonical, from 2026-10-31): content_hash = SHA-256(json.dumps(
    canonical_obj, sort_keys=True, separators=(',', ':')))
    where canonical_obj = {
        "schema_version": "v1",
        "source_act": ..., "source_section": ...,
        "target_act": ..., "target_section": ...,
        "offence_text": ..., "punishment_text": ...
    }
    Binds the hash to the SUBSTANTIVE record content, not just the section
    pair string.  Any text change (single character in offence_text or
    punishment_text) invalidates the approval automatically.
    New GO instructions must use v1 hashes.

For IPC:166A->BNS:199 (REGISTRY-001 reference values):
    v0  hash  =  eedb095a3250ac8ca0c5929c4fabe4076c9ef43342801683ee88b64db8ee401b
    v1  hash  =  1787743a993d9df1f94c1addad280016fc1b565781d8a790d51fb273068f16f8
    (offence_text="Public servant disobeying direction under law",
     punishment_text="Rigorous imprisonment of at least six months and up to
     two years, and fine")

REGISTRY-001 remains valid under the v0 scheme until a new GO re-issues it
with a v1 canonical hash.  The migration proposal is in
backend/data/REGISTRY_MIGRATION_PROPOSAL.md.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("gandhikar")

_REGISTRY_PATH = Path(__file__).parent.parent / "data" / "approval_evidence_registry.json"

# Every candidate record must carry all of these, non-empty, to even be
# considered — anything missing is treated as malformed, never as approved.
_REQUIRED_FIELDS = ("approval_id", "record_type", "subject_key", "content_hash", "reviewer_id", "status")

# ── Canonical v1 record hash spec ─────────────────────────────────────────────

_CANONICAL_SCHEMA_VERSION = "v1"

# All seven fields are required in a canonical v1 object.  Missing any field
# raises ValueError from compute_canonical_record_hash (fail-closed, not silent).
_CANONICAL_V1_REQUIRED_FIELDS = (
    "schema_version",
    "source_act",
    "source_section",
    "target_act",
    "target_section",
    "offence_text",
    "punishment_text",
)


@dataclass(frozen=True)
class ApprovalCheckResult:
    approved: bool
    reason: str  # "approved" | "missing_approval" | "revoked" | "hash_mismatch" | "malformed"
    reviewer_id: Optional[str] = None
    approval_id: Optional[str] = None


def compute_content_hash(text: str) -> str:
    """v0 legacy: SHA-256 of a plain text string (UTF-8, stripped).

    Used for registry records created before the v1 canonical hash scheme
    (schema_version absent or "v0").  Kept for backward compatibility with
    REGISTRY-001-IPC166A-BNS199 and any other v0-era records.

    Do NOT use for new registry entries — use compute_canonical_record_hash
    with a fully populated v1 canonical object instead.
    """
    normalized = (text or "").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def compute_canonical_record_hash(canonical_obj: dict) -> str:
    """v1 canonical: SHA-256 of a versioned legal-record JSON object.

    The canonical object MUST contain exactly the seven fields listed in
    _CANONICAL_V1_REQUIRED_FIELDS:
        schema_version, source_act, source_section,
        target_act, target_section,
        offence_text, punishment_text.

    Serialised with json.dumps(sort_keys=True, separators=(',', ':'),
    ensure_ascii=True) for strict determinism regardless of dict insertion
    order or platform locale.

    Any field change — even a single character in offence_text or
    punishment_text — produces a completely different hash and automatically
    invalidates any approval that carried the old hash (fail-closed).

    Missing required fields raise ValueError (not a silent fallback).
    Callers MUST pass a complete, validated canonical object.

    Example (IPC:166A → BNS:199):
        canonical_obj = {
            "schema_version": "v1",
            "source_act": "IPC",
            "source_section": "166A",
            "target_act": "BNS",
            "target_section": "199",
            "offence_text": "Public servant disobeying direction under law",
            "punishment_text": "Rigorous imprisonment of at least six months"
                               " and up to two years, and fine",
        }
        → SHA-256 = 1787743a993d9df1f94c1addad280016fc1b565781d8a790d51fb273068f16f8
    """
    missing = [f for f in _CANONICAL_V1_REQUIRED_FIELDS if f not in canonical_obj]
    if missing:
        raise ValueError(
            f"compute_canonical_record_hash: missing required field(s): {missing}"
        )
    if canonical_obj.get("schema_version") != _CANONICAL_SCHEMA_VERSION:
        raise ValueError(
            f"compute_canonical_record_hash: schema_version must be "
            f"{_CANONICAL_SCHEMA_VERSION!r}, got {canonical_obj.get('schema_version')!r}"
        )
    serialized = json.dumps(
        canonical_obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def _load_registry() -> List[dict]:
    try:
        raw = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
        approvals = raw.get("approvals", [])
        logger.info("[approval_evidence] loaded %d approval record(s) from registry", len(approvals))
        return approvals
    except Exception as e:
        logger.error("[approval_evidence] failed to load registry, failing closed (0 approvals): %s", e)
        return []


def check_approval(
    record_type: str,
    subject_key: str,
    content_hash: str,
    registry: Optional[List[dict]] = None,
) -> ApprovalCheckResult:
    """Fail-closed approval lookup (v0 hash only).

    `registry` is normally left as None, which loads the real on-disk
    registry. Tests MAY pass an explicit in-memory list of synthetic records
    to exercise the approved/revoked/hash-mismatch paths — this never reads
    or writes the real registry file, so test code can never create a real
    approval.

    NOTE: This function only supports the v0 string hash.  For section-
    correspondence claims use check_section_correspondence_approval which
    is schema-version-aware (v0 and v1 canonical).
    """
    records = _load_registry() if registry is None else registry
    candidates = [
        r for r in records
        if isinstance(r, dict) and r.get("record_type") == record_type and r.get("subject_key") == subject_key
    ]
    if not candidates:
        return ApprovalCheckResult(False, "missing_approval")

    saw_malformed = saw_revoked = saw_hash_mismatch = False
    for rec in candidates:
        if any(not rec.get(f) for f in _REQUIRED_FIELDS):
            saw_malformed = True
            continue
        if rec.get("status") != "active" or rec.get("revoked_at"):
            saw_revoked = True
            continue
        if rec.get("content_hash") != content_hash:
            saw_hash_mismatch = True
            continue
        return ApprovalCheckResult(True, "approved", rec.get("reviewer_id"), rec.get("approval_id"))

    if saw_revoked:
        return ApprovalCheckResult(False, "revoked")
    if saw_hash_mismatch:
        return ApprovalCheckResult(False, "hash_mismatch")
    if saw_malformed:
        return ApprovalCheckResult(False, "malformed")
    return ApprovalCheckResult(False, "missing_approval")


# ── Section-correspondence gate ───────────────────────────────────────────────

def check_section_correspondence_approval(
    from_act_and_section: str,              # e.g. "IPC:166A"
    to_act_and_section: str,               # e.g. "BNS:199"
    canonical_record: Optional[dict] = None, # v1 canonical object (see below)
    registry: Optional[List[dict]] = None,
) -> ApprovalCheckResult:
    """Fail-closed check for a specific section-to-section correspondence claim.

    Schema-version-aware hash verification:

    v0 records (schema_version absent or "v0", e.g. REGISTRY-001):
        content_hash expected = compute_content_hash(subject_key)
        i.e. SHA-256 of the plain subject_key string "IPC:166A->BNS:199".
        The canonical_record parameter is ignored for v0 records.

    v1 records (schema_version == "v1"):
        content_hash expected = compute_canonical_record_hash(canonical_record)
        canonical_record MUST be a fully-populated dict with all seven
        fields from _CANONICAL_V1_REQUIRED_FIELDS.  If canonical_record is
        None when a v1 record is found, the check fails closed with
        "hash_mismatch" — the caller MUST supply the canonical object or
        the gate will not open.

    The claim is gated by a single approval record that ALSO:
      • has record_type="correspondence"
      • has subject_key = "{from_act_and_section}->{to_act_and_section}"
      • has section_from = from_act_and_section (secondary structural guard)
      • has section_to   = to_act_and_section   (secondary structural guard)
      • is active, unrevoked, not malformed

    Rechecked on every call: callers MUST NOT cache the return value between
    requests. A stored dead_with_successor flag in a corpus record is NOT
    sufficient — this gate must pass independently for each output that names
    the specific successor section.
    """
    subject_key = f"{from_act_and_section}->{to_act_and_section}"
    records = _load_registry() if registry is None else registry

    candidates = [
        r for r in records
        if isinstance(r, dict)
        and r.get("record_type") == "correspondence"
        and r.get("subject_key") == subject_key
    ]
    if not candidates:
        return ApprovalCheckResult(False, "missing_approval")

    saw_malformed = saw_revoked = saw_hash_mismatch = False
    for rec in candidates:
        # ── 1. Required-fields check (malformed) ─────────────────────────────
        if any(not rec.get(f) for f in _REQUIRED_FIELDS):
            saw_malformed = True
            continue

        # ── 2. Active/revoked check ───────────────────────────────────────────
        if rec.get("status") != "active" or rec.get("revoked_at"):
            saw_revoked = True
            continue

        # ── 3. Schema-version-aware hash check ───────────────────────────────
        rec_schema = rec.get("schema_version", "v0")  # REGISTRY-001 has no field → v0

        if rec_schema == _CANONICAL_SCHEMA_VERSION:   # "v1"
            if canonical_record is None:
                # Caller did not supply canonical object — fail closed.
                # This prevents the gate from opening when the caller doesn't
                # have (or hasn't passed) the substantive record fields.
                logger.warning(
                    "[approval_evidence] v1 record %s requires canonical_record "
                    "but none supplied — failing closed with hash_mismatch",
                    rec.get("approval_id"),
                )
                saw_hash_mismatch = True
                continue
            try:
                expected_hash = compute_canonical_record_hash(canonical_record)
            except ValueError as exc:
                logger.warning(
                    "[approval_evidence] compute_canonical_record_hash failed: %s", exc
                )
                saw_malformed = True
                continue
        else:
            # v0 backward compat (includes REGISTRY-001): hash the subject_key string
            expected_hash = compute_content_hash(subject_key)

        if rec.get("content_hash") != expected_hash:
            saw_hash_mismatch = True
            continue

        # ── 4. Secondary structural guard ────────────────────────────────────
        # Prevents an approval for a different pair from covering this claim
        # if the subject_key were ever forged or aliased.
        rec_from = (rec.get("section_from") or "").strip()
        rec_to   = (rec.get("section_to")   or "").strip()
        if rec_from != from_act_and_section or rec_to != to_act_and_section:
            logger.warning(
                "[approval_evidence] section_correspondence structural mismatch: "
                "record %s claims from=%r to=%r but check requested from=%r to=%r "
                "— failing closed",
                rec.get("approval_id"), rec_from, rec_to,
                from_act_and_section, to_act_and_section,
            )
            saw_malformed = True
            continue

        # ── All four checks passed ────────────────────────────────────────────
        return ApprovalCheckResult(
            True, "approved",
            rec.get("reviewer_id"), rec.get("approval_id"),
        )

    # No record passed all checks — return the most informative failure reason.
    if saw_revoked:
        return ApprovalCheckResult(False, "revoked")
    if saw_hash_mismatch:
        return ApprovalCheckResult(False, "hash_mismatch")
    if saw_malformed:
        return ApprovalCheckResult(False, "malformed")
    return ApprovalCheckResult(False, "missing_approval")
