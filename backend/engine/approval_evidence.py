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

AUTHORIZED-REVIEWER ALLOWLIST: an approval record only counts if its
reviewer_id matches an entry in the registry's "authorized_reviewers" list
with status "active" and no revoked_at. That list is populated ONLY
out-of-band by the customer's authorized legal lead. Ordinary user roles
(advocate/admin/any app login), the verified_by / reviewed_by fields on
legal records, ADMIN_KEY, and seed/import timestamps NEVER confer approval.
An empty or unloadable allowlist approves nothing.
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
    reason: str  # "approved" | "missing_approval" | "revoked" | "hash_mismatch" | "malformed" | "unauthorized_reviewer"
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


@lru_cache(maxsize=1)
def _load_authorized_reviewers() -> List[dict]:
    """Load the authorized-reviewer allowlist. Any error (missing file, bad
    JSON, wrong type) fails closed to an empty allowlist = nothing approved."""
    try:
        raw = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
        reviewers = raw.get("authorized_reviewers", [])
        if not isinstance(reviewers, list):
            raise ValueError("authorized_reviewers is not a list")
        logger.info("[approval_evidence] loaded %d authorized reviewer(s)", len(reviewers))
        return reviewers
    except Exception as e:
        logger.error("[approval_evidence] failed to load authorized reviewers, failing closed (0 reviewers): %s", e)
        return []


def _is_authorized_reviewer(reviewer_id: str, authorized_reviewers: List[dict]) -> bool:
    if not reviewer_id:
        return False
    for entry in authorized_reviewers or []:
        if (
            isinstance(entry, dict)
            and entry.get("reviewer_id") == reviewer_id
            and entry.get("status") == "active"
            and not entry.get("revoked_at")
        ):
            return True
    return False


def check_approval(
    record_type: str,
    subject_key: str,
    content_hash: str,
    registry: Optional[List[dict]] = None,
    authorized_reviewers: Optional[List[dict]] = None,
) -> ApprovalCheckResult:
    """Fail-closed approval lookup.

    `registry` is normally left as None, which loads the real (currently
    empty) on-disk registry. Tests MAY pass an explicit in-memory list of
    synthetic records to exercise the approved/revoked/hash-mismatch paths
    — this never reads or writes the real registry file, so test code can
    never create a real approval.

    `authorized_reviewers` likewise defaults to the on-disk allowlist
    (currently empty). An otherwise-valid approval whose reviewer_id is not
    an active, unrevoked allowlist entry is rejected as
    "unauthorized_reviewer". User roles, verified_by/reviewed_by fields,
    ADMIN_KEY and seed timestamps never confer approval.
    """
    records = _load_registry() if registry is None else registry
    if not isinstance(records, list):
        records = []
    reviewers = _load_authorized_reviewers() if authorized_reviewers is None else authorized_reviewers
    if not isinstance(reviewers, list):
        reviewers = []
    candidates = [
        r for r in records
        if isinstance(r, dict) and r.get("record_type") == record_type and r.get("subject_key") == subject_key
    ]
    if not candidates:
        return ApprovalCheckResult(False, "missing_approval")

    saw_malformed = saw_revoked = saw_hash_mismatch = saw_unauthorized = False
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
        if not _is_authorized_reviewer(rec.get("reviewer_id"), reviewers):
            saw_unauthorized = True
            continue
        return ApprovalCheckResult(True, "approved", rec.get("reviewer_id"), rec.get("approval_id"))

    if saw_revoked:
        return ApprovalCheckResult(False, "revoked")
    if saw_unauthorized:
        return ApprovalCheckResult(False, "unauthorized_reviewer")
    if saw_hash_mismatch:
        return ApprovalCheckResult(False, "hash_mismatch")
    if saw_malformed:
        return ApprovalCheckResult(False, "malformed")
    return ApprovalCheckResult(False, "missing_approval")
