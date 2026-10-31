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
from collections import Counter
from dataclasses import dataclass, field
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
    reason: str  # "approved" | "missing_approval" | "revoked" | "hash_mismatch" | "malformed" | "unauthorized_reviewer"
    reviewer_id: Optional[str] = None
    approval_id: Optional[str] = None


@dataclass(frozen=True)
class RegistryData:
    """Parsed content of the on-disk registry: both approvals and the authorized-
    reviewer allowlist.  load_error is set (non-None) when the file could not be
    read or was structurally invalid; callers must treat any non-None load_error
    as a signal to fail closed immediately."""
    approvals: List[dict] = field(default_factory=list)
    authorized_reviewers: List[dict] = field(default_factory=list)
    load_error: Optional[str] = None


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
def _load_registry_data() -> RegistryData:
    """Load BOTH approvals AND the authorized-reviewer allowlist from the registry.

    Fail-closed loading rules:
    • JSON parse error / file unreadable → load_error set, empty lists returned.
    • authorized_reviewers missing or not a list → load_error set.
    • authorized_reviewers list is empty → load_error set (no reviewer can authorize).
    • Duplicate reviewer_id entries → load_error set (ambiguous).
    Any of these conditions causes EVERY gate call to fail closed via the
    load_error check in check_approval / check_section_correspondence_approval.
    """
    try:
        raw = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
        approvals = raw.get("approvals", [])

        ar_raw = raw.get("authorized_reviewers")
        if not isinstance(ar_raw, list):
            raise ValueError(
                f"authorized_reviewers must be a list, got {type(ar_raw).__name__}"
            )
        if not ar_raw:
            raise ValueError(
                "authorized_reviewers list is empty — no reviewer can authorize"
            )
        reviewer_ids = [r.get("reviewer_id") for r in ar_raw if isinstance(r, dict)]
        non_empty = [rid for rid in reviewer_ids if rid]
        dupes = [rid for rid, cnt in Counter(non_empty).items() if cnt > 1]
        if dupes:
            raise ValueError(
                f"Duplicate reviewer_id entries in authorized_reviewers: {dupes}"
            )

        logger.info(
            "[approval_evidence] loaded %d approval(s), %d authorized reviewer(s)",
            len(approvals), len(ar_raw),
        )
        return RegistryData(approvals=approvals, authorized_reviewers=ar_raw)
    except Exception as exc:
        logger.error(
            "[approval_evidence] failed to load registry, failing closed: %s", exc
        )
        return RegistryData(approvals=[], authorized_reviewers=[], load_error=str(exc))


@lru_cache(maxsize=1)
def _load_registry() -> List[dict]:
    """Backward-compatible shim: returns only the approvals list.

    Prefer _load_registry_data() for new code that also needs to enforce
    reviewer-identity checks.  This shim exists so law_status_guard.py and
    the test suite that injects synthetic approval lists continue to compile
    without changes.
    """
    return _load_registry_data().approvals


def _is_reviewer_authorized(reviewer_id: str, authorized_reviewers: List[dict]) -> bool:
    """Return True iff reviewer_id names exactly one active, non-revoked reviewer.

    Fail-closed conditions (all return False):
    • reviewer_id is empty or None.
    • authorized_reviewers list is empty.
    • reviewer_id matches zero entries (unknown reviewer).
    • reviewer_id matches two or more entries (duplicate/ambiguous).
    • The matching reviewer's status != 'active'.
    • The matching reviewer has revoked=True.
    """
    if not reviewer_id:
        return False
    if not authorized_reviewers:
        return False
    matches = [
        r for r in authorized_reviewers
        if isinstance(r, dict) and r.get("reviewer_id") == reviewer_id
    ]
    if len(matches) != 1:
        # 0 = unknown reviewer; 2+ = ambiguous duplicate — both fail closed
        return False
    reviewer = matches[0]
    if reviewer.get("status") != "active":
        return False
    if reviewer.get("revoked"):
        return False
    return True


def check_approval(
    record_type: str,
    subject_key: str,
    content_hash: str,
    registry: Optional[List[dict]] = None,
    authorized_reviewers: Optional[List[dict]] = None,
) -> ApprovalCheckResult:
    """Fail-closed approval lookup (v0 hash only).

    `registry` is normally left as None, which loads the real on-disk registry.
    Tests MAY pass an explicit in-memory list of synthetic records to exercise the
    approved/revoked/hash-mismatch paths — this never reads or writes the real
    registry file, so test code can never create a real approval.

    Reviewer identity enforcement:
    • Production mode (registry=None): load RegistryData from file; apply reviewer
      identity check against authorized_reviewers.  A load error fails ALL calls
      closed immediately.
    • Test mode with authorized_reviewers explicitly provided: apply reviewer check
      against the provided list (may be empty — fails closed if so).
    • Test mode with registry provided but authorized_reviewers=None: reviewer
      identity check is SKIPPED for backward compatibility with existing tests that
      only inject approval records.

    NOTE: This function only supports the v0 string hash.  For section-
    correspondence claims use check_section_correspondence_approval which
    is schema-version-aware (v0 and v1 canonical).
    """
    # ── Load registry data ────────────────────────────────────────────────────
    if registry is None:
        reg_data = _load_registry_data()
        if reg_data.load_error:
            logger.error(
                "[approval_evidence] registry load error — approval check fails closed: %s",
                reg_data.load_error,
            )
            return ApprovalCheckResult(False, "unauthorized_reviewer")
        records = reg_data.approvals
        effective_reviewers: Optional[List[dict]] = reg_data.authorized_reviewers
    else:
        records = registry
        effective_reviewers = authorized_reviewers  # None → reviewer check skipped (compat)

    candidates = [
        r for r in records
        if isinstance(r, dict) and r.get("record_type") == record_type and r.get("subject_key") == subject_key
    ]
    if not candidates:
        return ApprovalCheckResult(False, "missing_approval")

    saw_unauthorized_reviewer = False
    saw_malformed = saw_revoked = saw_hash_mismatch = False
    for rec in candidates:
        # 1. Required-fields check (malformed)
        if any(not rec.get(f) for f in _REQUIRED_FIELDS):
            saw_malformed = True
            continue
        # 2. Reviewer identity check (production and explicit-override modes only)
        if effective_reviewers is not None:
            if not _is_reviewer_authorized(rec.get("reviewer_id", ""), effective_reviewers):
                logger.warning(
                    "[approval_evidence] reviewer identity check failed: reviewer_id=%r "
                    "not authorized for record_type=%r subject_key=%r",
                    rec.get("reviewer_id"), record_type, subject_key,
                )
                saw_unauthorized_reviewer = True
                continue
        # 3. Active/revoked check
        if rec.get("status") != "active" or rec.get("revoked_at"):
            saw_revoked = True
            continue
        # 4. Hash check
        if rec.get("content_hash") != content_hash:
            saw_hash_mismatch = True
            continue
        return ApprovalCheckResult(True, "approved", rec.get("reviewer_id"), rec.get("approval_id"))

    if saw_unauthorized_reviewer:
        return ApprovalCheckResult(False, "unauthorized_reviewer")
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
    authorized_reviewers: Optional[List[dict]] = None,
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

    Reviewer identity enforcement (P2 correction):
    • Production mode (registry=None): load RegistryData from file; apply reviewer
      identity check against authorized_reviewers.  A load error fails ALL calls
      closed immediately with "unauthorized_reviewer".
    • Test mode with authorized_reviewers explicitly provided: apply reviewer check
      against the provided list.  An empty list fails closed.
    • Test mode with registry provided but authorized_reviewers=None: reviewer
      identity check is SKIPPED for backward compatibility with existing tests that
      only inject approval records without an authorized-reviewer list.

    Five checks per candidate record (each fail-closed):
      1. Required-fields check  → "malformed"
      2. Reviewer identity check → "unauthorized_reviewer"  (skipped in compat mode)
      3. Active/revoked check    → "revoked"
      4. Canonical hash check    → "hash_mismatch"
      5. section_from/section_to cross-check → "malformed"

    Rechecked on every call: callers MUST NOT cache the return value between
    requests.
    """
    subject_key = f"{from_act_and_section}->{to_act_and_section}"

    # ── Load registry data ────────────────────────────────────────────────────
    if registry is None:
        reg_data = _load_registry_data()
        if reg_data.load_error:
            logger.error(
                "[approval_evidence] registry load error — correspondence check fails closed: %s",
                reg_data.load_error,
            )
            return ApprovalCheckResult(False, "unauthorized_reviewer")
        records = reg_data.approvals
        effective_reviewers: Optional[List[dict]] = reg_data.authorized_reviewers
    else:
        records = registry
        effective_reviewers = authorized_reviewers  # None → reviewer check skipped (compat)

    candidates = [
        r for r in records
        if isinstance(r, dict)
        and r.get("record_type") == "correspondence"
        and r.get("subject_key") == subject_key
    ]
    if not candidates:
        return ApprovalCheckResult(False, "missing_approval")

    saw_unauthorized_reviewer = False
    saw_malformed = saw_revoked = saw_hash_mismatch = False
    for rec in candidates:
        # ── 1. Required-fields check (malformed) ─────────────────────────────
        if any(not rec.get(f) for f in _REQUIRED_FIELDS):
            saw_malformed = True
            continue

        # ── 2. Reviewer identity check ────────────────────────────────────────
        #    Skipped only when the caller is in backward-compat test mode
        #    (registry provided, authorized_reviewers not provided).
        if effective_reviewers is not None:
            if not _is_reviewer_authorized(rec.get("reviewer_id", ""), effective_reviewers):
                logger.warning(
                    "[approval_evidence] reviewer identity check failed: reviewer_id=%r "
                    "not authorized for correspondence %r — failing closed",
                    rec.get("reviewer_id"), subject_key,
                )
                saw_unauthorized_reviewer = True
                continue

        # ── 3. Active/revoked check ───────────────────────────────────────────
        if rec.get("status") != "active" or rec.get("revoked_at"):
            saw_revoked = True
            continue

        # ── 4. Schema-version-aware hash check ───────────────────────────────
        rec_schema = rec.get("schema_version", "v0")  # REGISTRY-001 has no field → v0

        if rec_schema == _CANONICAL_SCHEMA_VERSION:   # "v1"
            if canonical_record is None:
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

        # ── 5. Secondary structural guard ────────────────────────────────────
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

        # ── All five checks passed ────────────────────────────────────────────
        return ApprovalCheckResult(
            True, "approved",
            rec.get("reviewer_id"), rec.get("approval_id"),
        )

    # No record passed all checks — return the most informative failure reason.
    if saw_unauthorized_reviewer:
        return ApprovalCheckResult(False, "unauthorized_reviewer")
    if saw_revoked:
        return ApprovalCheckResult(False, "revoked")
    if saw_hash_mismatch:
        return ApprovalCheckResult(False, "hash_mismatch")
    if saw_malformed:
        return ApprovalCheckResult(False, "malformed")
    return ApprovalCheckResult(False, "missing_approval")
