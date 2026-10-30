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


@dataclass(frozen=True)
class ApprovalCheckResult:
    approved: bool
    reason: str  # "approved" | "missing_approval" | "revoked" | "hash_mismatch" | "malformed"
    reviewer_id: Optional[str] = None
    approval_id: Optional[str] = None


def compute_content_hash(text: str) -> str:
    """Stable sha256 hex digest binding an approval to one exact text
    version. If the underlying text changes later, the hash changes and any
    existing approval for the old text automatically stops matching —
    it fails closed rather than silently covering the new text."""
    normalized = (text or "").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


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
    """Fail-closed approval lookup.

    `registry` is normally left as None, which loads the real (currently
    empty) on-disk registry. Tests MAY pass an explicit in-memory list of
    synthetic records to exercise the approved/revoked/hash-mismatch paths
    — this never reads or writes the real registry file, so test code can
    never create a real approval.
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
    from_act_and_section: str,   # e.g. "IPC:166A"
    to_act_and_section: str,     # e.g. "BNS:199"
    registry: Optional[List[dict]] = None,
) -> ApprovalCheckResult:
    """Fail-closed check for a specific section-to-section correspondence claim.

    The claim (e.g. "IPC:166A maps to BNS:199") is gated by a single approval
    record that:
      • has record_type="correspondence"
      • has subject_key = "{from_act_and_section}->{to_act_and_section}"
      • has content_hash = sha256(subject_key)  — binding the exact pair
      • has section_from = from_act_and_section  (checked as a secondary guard)
      • has section_to   = to_act_and_section    (checked as a secondary guard)
      • is active, unrevoked, not malformed

    Rechecked on every turn: callers MUST NOT cache the return value between
    requests. A stored dead_with_successor flag in a corpus record is NOT
    sufficient — this gate must pass independently for each output that names
    the specific successor section.
    """
    subject_key = f"{from_act_and_section}->{to_act_and_section}"
    # The canonical claim text is the subject_key string itself; the registry
    # content_hash is SHA-256 of that string (see approval_evidence_registry.json
    # and _content_hash_note).
    content_hash = compute_content_hash(subject_key)

    # Step 1: standard hash+status gate.
    base_result = check_approval("correspondence", subject_key, content_hash, registry=registry)
    if not base_result.approved:
        return base_result

    # Step 2: secondary structural guard — both endpoint fields must agree.
    # This prevents an approval for a different pair (e.g. IPC:166->BNS:198)
    # from covering this claim if the subject_key were ever forged or aliased.
    records = _load_registry() if registry is None else registry
    for rec in records:
        if (
            isinstance(rec, dict)
            and rec.get("record_type") == "correspondence"
            and rec.get("subject_key") == subject_key
            and rec.get("status") == "active"
            and not rec.get("revoked_at")
            and rec.get("content_hash") == content_hash
        ):
            rec_from = (rec.get("section_from") or "").strip()
            rec_to   = (rec.get("section_to")   or "").strip()
            if rec_from != from_act_and_section or rec_to != to_act_and_section:
                logger.warning(
                    "[approval_evidence] section_correspondence structural mismatch: "
                    "record %s claims from=%r to=%r but check requested from=%r to=%r — "
                    "failing closed",
                    rec.get("approval_id"), rec_from, rec_to,
                    from_act_and_section, to_act_and_section,
                )
                return ApprovalCheckResult(False, "malformed",
                                           rec.get("reviewer_id"), rec.get("approval_id"))
            return ApprovalCheckResult(True, "approved",
                                       rec.get("reviewer_id"), rec.get("approval_id"))

    # If base_result.approved is True but no full record matches the structural
    # guard (shouldn't happen, but be explicit):
    return ApprovalCheckResult(False, "malformed")
