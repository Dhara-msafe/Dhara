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
# NOTE: reviewer_id is NOT in this list — it is pre-checked separately before
# the generic malformed check so the specific "missing_reviewer" reason code
# can be returned instead of the generic "malformed" in production mode.
_REQUIRED_FIELDS = ("approval_id", "record_type", "subject_key", "content_hash", "status")

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
    reason: str  # one of the 14 defined reason codes:
    # "approved"                   — all checks passed
    # "missing_approval"           — no record found for the pair
    # "pending_human_review"       — approval record status is pending_human_review
    # "inactive_approval"          — approval record has non-active, non-revoked, non-pending status
    # "revoked_approval"           — approval record has revoked_at set or status=="revoked"
    # "missing_reviewer"           — reviewer_id field is absent or empty
    # "unauthorized_reviewer"      — reviewer_id present but not in the authorized allowlist
    # "inactive_reviewer"          — reviewer is in allowlist but status != "active"
    # "revoked_reviewer"           — reviewer is in allowlist but revoked == True
    # "missing_review_artifact"    — review_artifact_id or review_artifact_digest absent/empty
    # "invalid_approved_at"        — approved_at absent, no timezone, or beyond clock-skew tolerance
    # "hash_mismatch"              — content_hash does not match (re)computed value
    # "record_mismatch"            — section_from/section_to cross-check fails
    # "registry_unavailable"       — registry file unreadable (I/O / file-not-found error)
    # "malformed_registry"         — registry JSON unparseable or structurally invalid
    # "conflicting_registry_records" — duplicate approval_id within subject_key candidates
    # "malformed"                  — required fields missing or empty in a candidate record
    reviewer_id: Optional[str] = None
    approval_id: Optional[str] = None


@dataclass(frozen=True)
class RegistryData:
    """Parsed content of the on-disk registry: both approvals and the authorized-
    reviewer allowlist.  load_error is set (non-None) when the file could not be
    read or was structurally invalid; load_error_reason is the specific reason code.
    Callers must treat any non-None load_error as a signal to fail closed."""
    approvals: List[dict] = field(default_factory=list)
    authorized_reviewers: List[dict] = field(default_factory=list)
    load_error: Optional[str] = None
    load_error_reason: Optional[str] = None  # "registry_unavailable" | "malformed_registry"


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

    Fail-closed loading rules — each produces a distinct load_error_reason:

    registry_unavailable:
    • File not found, permission denied, or any I/O error reading the file.

    malformed_registry:
    • JSON parse error.
    • authorized_reviewers missing or not a list.
    • authorized_reviewers list is empty (no reviewer can authorize).
    • Duplicate reviewer_id entries in authorized_reviewers.
    • Duplicate approval_id entries across the approvals list.

    Any load_error causes EVERY gate call to fail closed with the stored
    load_error_reason via the early-exit check in check_approval /
    check_section_correspondence_approval.
    """
    try:
        raw_text = _REGISTRY_PATH.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, OSError, IOError) as exc:
        logger.error("[approval_evidence] registry file unavailable: %s", exc)
        return RegistryData(
            load_error=str(exc),
            load_error_reason="registry_unavailable",
        )

    try:
        raw = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.error("[approval_evidence] registry JSON parse error: %s", exc)
        return RegistryData(
            load_error=str(exc),
            load_error_reason="malformed_registry",
        )

    try:
        approvals = raw.get("approvals", [])

        # ── Duplicate approval_id check ───────────────────────────────────────
        appr_ids = [a.get("approval_id") for a in approvals if isinstance(a, dict) and a.get("approval_id")]
        appr_dupes = [aid for aid, cnt in Counter(appr_ids).items() if cnt > 1]
        if appr_dupes:
            raise ValueError(f"Duplicate approval_id entries in approvals: {appr_dupes}")

        # ── authorized_reviewers validation ───────────────────────────────────
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
    except ValueError as exc:
        logger.error("[approval_evidence] registry structure invalid: %s", exc)
        return RegistryData(
            load_error=str(exc),
            load_error_reason="malformed_registry",
        )


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
    """Backward-compat shim — returns True only when _check_reviewer_identity returns None."""
    return _check_reviewer_identity(reviewer_id, authorized_reviewers) is None


# ── Clock-skew tolerance for approved_at timestamps ────────────────────────
_APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES: int = 60
"""Maximum future tolerance for approved_at timestamps (minutes).
Approvals with approved_at more than this far in the future are rejected with
'invalid_approved_at'.  Documented here so operators and tests can reference it."""


def _check_reviewer_identity(
    reviewer_id: Optional[str],
    authorized_reviewers: List[dict],
) -> Optional[str]:
    """Return None if the reviewer is fully authorized, or a specific reason code.

    None                          = authorized
    "missing_reviewer"            = reviewer_id is absent or empty
    "unauthorized_reviewer"       = reviewer_id not found in allowlist (incl. empty list)
    "inactive_reviewer"           = found in allowlist but status != "active"
    "revoked_reviewer"            = found in allowlist but revoked == True
    "conflicting_registry_records"= duplicate reviewer_id entries (ambiguous)
    """
    if not reviewer_id:
        return "missing_reviewer"
    if not authorized_reviewers:
        return "unauthorized_reviewer"
    matches = [
        r for r in authorized_reviewers
        if isinstance(r, dict) and r.get("reviewer_id") == reviewer_id
    ]
    if len(matches) == 0:
        return "unauthorized_reviewer"
    if len(matches) > 1:
        return "conflicting_registry_records"
    reviewer = matches[0]
    if reviewer.get("revoked"):
        return "revoked_reviewer"
    if reviewer.get("status") == "revoked":
        return "revoked_reviewer"
    if reviewer.get("status") != "active":
        return "inactive_reviewer"
    return None  # fully authorized


def _validate_approved_at(approved_at: Optional[str]) -> Optional[str]:
    """Return None if approved_at is a valid ISO 8601 datetime with timezone,
    or 'invalid_approved_at' if not.

    Validation rules:
    • Non-empty string required.
    • Must be parseable as ISO 8601 (Python datetime.fromisoformat after Z → +00:00).
    • Parsed result must carry timezone info (no naive datetimes).
    • Must NOT be more than _APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES in the future
      (clock-skew tolerance is explicitly documented above).
    """
    if not approved_at:
        return "invalid_approved_at"
    try:
        from datetime import datetime, timezone, timedelta
        # Z (UTC shorthand) normalised for Python 3.10 compat
        normalized = approved_at.replace("Z", "+00:00") if approved_at else ""
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            return "invalid_approved_at"
        now = datetime.now(timezone.utc)
        tolerance = timedelta(minutes=_APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES)
        if dt > now + tolerance:
            logger.warning(
                "[approval_evidence] approved_at %r is more than %d minutes in the "
                "future — rejecting as invalid_approved_at",
                approved_at, _APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES,
            )
            return "invalid_approved_at"
        return None
    except (ValueError, AttributeError, TypeError):
        return "invalid_approved_at"


def _validate_artifact_fields(rec: dict) -> Optional[str]:
    """Return None if artifact evidence fields are present, or 'missing_review_artifact'.

    Active approvals must carry both:
    • review_artifact_id   — immutable identifier for the review artefact
    • review_artifact_digest — cryptographic digest binding the artefact to this record

    A Markdown template in the repository (HUMAN_REVIEW_PACKAGE.md) does NOT satisfy
    this requirement; only a real, completed review with an out-of-band artefact does.
    """
    if not rec.get("review_artifact_id") or not rec.get("review_artifact_digest"):
        return "missing_review_artifact"
    return None


def check_approval(
    record_type: str,
    subject_key: str,
    content_hash: str,
    registry: Optional[List[dict]] = None,
    authorized_reviewers: Optional[List[dict]] = None,
) -> ApprovalCheckResult:
    """Fail-closed approval lookup (v0 hash only).

    `registry` is normally left as None, which loads the real on-disk registry.
    Tests MAY pass an explicit in-memory list of synthetic records to exercise
    approved/revoked/hash-mismatch paths — this never reads or writes the real
    registry file, so test code can never create a real approval.

    Reviewer identity enforcement — same three modes as check_section_correspondence_approval.

    NOTE: This function only supports v0 string hashes.  For section-correspondence
    claims use check_section_correspondence_approval (schema-version-aware).
    """
    # ── Load registry data ────────────────────────────────────────────────────
    if registry is None:
        reg_data = _load_registry_data()
        if reg_data.load_error:
            logger.error(
                "[approval_evidence] registry load error — approval check fails closed: %s",
                reg_data.load_error,
            )
            return ApprovalCheckResult(False, reg_data.load_error_reason or "registry_unavailable")
        records = reg_data.approvals
        effective_reviewers: Optional[List[dict]] = reg_data.authorized_reviewers
    else:
        records = registry
        effective_reviewers = authorized_reviewers

    candidates = [
        r for r in records
        if isinstance(r, dict)
        and r.get("record_type") == record_type
        and r.get("subject_key") == subject_key
    ]
    if not candidates:
        return ApprovalCheckResult(False, "missing_approval")

    # Duplicate approval_id within candidates
    cand_ids = [r.get("approval_id") for r in candidates if isinstance(r, dict) and r.get("approval_id")]
    if len(cand_ids) != len(set(cand_ids)):
        return ApprovalCheckResult(False, "conflicting_registry_records")

    saw_pending = saw_revoked_appr = saw_inactive_appr = False
    saw_reviewer_reason: Optional[str] = None
    saw_hash_mismatch = saw_malformed = False

    for rec in candidates:
        # 0. reviewer_id presence (specific code in production mode)
        if not rec.get("reviewer_id"):
            if effective_reviewers is not None:
                saw_reviewer_reason = saw_reviewer_reason or "missing_reviewer"
            else:
                saw_malformed = True
            continue
        # 1. Required-fields check (malformed)
        if any(not rec.get(f) for f in _REQUIRED_FIELDS):
            saw_malformed = True
            continue
        # 2. Status check
        status = rec.get("status")
        if status == "pending_human_review":
            saw_pending = True
            continue
        if rec.get("revoked_at") or status == "revoked":
            saw_revoked_appr = True
            continue
        if status != "active":
            saw_inactive_appr = True
            continue
        # 3. Reviewer identity check (production and explicit-AR modes)
        if effective_reviewers is not None:
            reviewer_reason = _check_reviewer_identity(rec.get("reviewer_id", ""), effective_reviewers)
            if reviewer_reason is not None:
                logger.warning(
                    "[approval_evidence] reviewer identity check: %s for record_type=%r subject_key=%r",
                    reviewer_reason, record_type, subject_key,
                )
                saw_reviewer_reason = saw_reviewer_reason or reviewer_reason
                continue
        # 4. Hash check
        if rec.get("content_hash") != content_hash:
            saw_hash_mismatch = True
            continue
        return ApprovalCheckResult(True, "approved", rec.get("reviewer_id"), rec.get("approval_id"))

    if saw_reviewer_reason:
        return ApprovalCheckResult(False, saw_reviewer_reason)
    if saw_pending:
        return ApprovalCheckResult(False, "pending_human_review")
    if saw_revoked_appr:
        return ApprovalCheckResult(False, "revoked_approval")
    if saw_inactive_appr:
        return ApprovalCheckResult(False, "inactive_approval")
    if saw_hash_mismatch:
        return ApprovalCheckResult(False, "hash_mismatch")
    if saw_malformed:
        return ApprovalCheckResult(False, "malformed")
    return ApprovalCheckResult(False, "missing_approval")


# ── Section-correspondence gate ───────────────────────────────────────────────

def check_section_correspondence_approval(
    from_act_and_section: str,
    to_act_and_section: str,
    canonical_record: Optional[dict] = None,
    registry: Optional[List[dict]] = None,
    authorized_reviewers: Optional[List[dict]] = None,
) -> ApprovalCheckResult:
    """Fail-closed correspondence-claim gate (schema-version-aware).

    Schema-version-aware hash verification:

    v0 records (schema_version absent or "v0"):
        expected hash = compute_content_hash(subject_key)
        canonical_record is ignored.

    v1 records (schema_version == "v1"):
        expected hash = compute_canonical_record_hash(canonical_record)
        canonical_record MUST be supplied; if absent → "hash_mismatch".

    Reviewer identity enforcement:
    • Production (registry=None): full 7-check pipeline enforced; load errors
      fail closed with the registry-specific reason code.
    • Test with authorized_reviewers explicitly provided: reviewer check applied.
    • Backward-compat test (registry provided, authorized_reviewers=None): reviewer
      check SKIPPED — existing tests that only inject approval records still work.

    Seven checks per active candidate (each fail-closed):
      0. reviewer_id presence      → "missing_reviewer" (prod) / "malformed" (compat)
      1. Required-fields check     → "malformed"
      2. Status check              → "pending_human_review" / "revoked_approval" / "inactive_approval"
      3. Reviewer identity check   → "missing_reviewer" / "unauthorized_reviewer" / "inactive_reviewer"
                                      "revoked_reviewer" / "conflicting_registry_records"
      4. Hash check                → "hash_mismatch"
      5. Structural cross-check    → "record_mismatch"
      6. approved_at validation    → "invalid_approved_at"
      7. Artifact evidence check   → "missing_review_artifact"
    """
    subject_key = f"{from_act_and_section}->{to_act_and_section}"

    # ── Load registry data ────────────────────────────────────────────────────
    if registry is None:
        reg_data = _load_registry_data()
        if reg_data.load_error:
            logger.error(
                "[approval_evidence] registry load error — correspondence check fails closed "
                "(%s): %s", reg_data.load_error_reason, reg_data.load_error,
            )
            return ApprovalCheckResult(
                False, reg_data.load_error_reason or "registry_unavailable"
            )
        records = reg_data.approvals
        effective_reviewers: Optional[List[dict]] = reg_data.authorized_reviewers
    else:
        records = registry
        effective_reviewers = authorized_reviewers

    candidates = [
        r for r in records
        if isinstance(r, dict)
        and r.get("record_type") == "correspondence"
        and r.get("subject_key") == subject_key
    ]
    if not candidates:
        return ApprovalCheckResult(False, "missing_approval")

    # ── Duplicate approval_id within candidates ───────────────────────────────
    cand_ids = [r.get("approval_id") for r in candidates if isinstance(r, dict) and r.get("approval_id")]
    if len(cand_ids) != len(set(cand_ids)):
        logger.error(
            "[approval_evidence] conflicting_registry_records: duplicate approval_id "
            "for %s — failing closed", subject_key,
        )
        return ApprovalCheckResult(False, "conflicting_registry_records")

    saw_pending = saw_revoked_appr = saw_inactive_appr = False
    saw_reviewer_reason: Optional[str] = None
    saw_hash_mismatch = saw_record_mismatch = saw_invalid_at = saw_missing_artifact = False
    saw_malformed = False

    for rec in candidates:
        # ── 0. reviewer_id presence ───────────────────────────────────────────
        if not rec.get("reviewer_id"):
            if effective_reviewers is not None:
                saw_reviewer_reason = saw_reviewer_reason or "missing_reviewer"
            else:
                saw_malformed = True
            continue

        # ── 1. Required-fields check (malformed) ─────────────────────────────
        if any(not rec.get(f) for f in _REQUIRED_FIELDS):
            saw_malformed = True
            continue

        # ── 2. Status check ───────────────────────────────────────────────────
        status = rec.get("status")
        if status == "pending_human_review":
            saw_pending = True
            continue  # do NOT apply reviewer / artifact checks to pending records
        if rec.get("revoked_at") or status == "revoked":
            saw_revoked_appr = True
            continue
        if status != "active":
            saw_inactive_appr = True
            continue

        # ── 3. Reviewer identity check ────────────────────────────────────────
        if effective_reviewers is not None:
            reviewer_reason = _check_reviewer_identity(
                rec.get("reviewer_id", ""), effective_reviewers
            )
            if reviewer_reason is not None:
                logger.warning(
                    "[approval_evidence] reviewer identity check: %s for "
                    "correspondence %r — failing closed",
                    reviewer_reason, subject_key,
                )
                saw_reviewer_reason = saw_reviewer_reason or reviewer_reason
                continue

        # ── 4. Schema-version-aware hash check ───────────────────────────────
        rec_schema = rec.get("schema_version", "v0")
        if rec_schema == _CANONICAL_SCHEMA_VERSION:
            if canonical_record is None:
                logger.warning(
                    "[approval_evidence] v1 record %s requires canonical_record "
                    "but none supplied — hash_mismatch",
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
            expected_hash = compute_content_hash(subject_key)

        if rec.get("content_hash") != expected_hash:
            saw_hash_mismatch = True
            continue

        # ── 5. Secondary structural guard (record_mismatch) ───────────────────
        rec_from = (rec.get("section_from") or "").strip()
        rec_to   = (rec.get("section_to")   or "").strip()
        if rec_from != from_act_and_section or rec_to != to_act_and_section:
            logger.warning(
                "[approval_evidence] record_mismatch: record %s claims from=%r to=%r "
                "but check requested from=%r to=%r — failing closed",
                rec.get("approval_id"), rec_from, rec_to,
                from_act_and_section, to_act_and_section,
            )
            saw_record_mismatch = True
            continue

        # ── 6. approved_at validation ─────────────────────────────────────────
        at_reason = _validate_approved_at(rec.get("approved_at"))
        if at_reason is not None:
            logger.warning(
                "[approval_evidence] invalid_approved_at for record %s: "
                "approved_at=%r — failing closed",
                rec.get("approval_id"), rec.get("approved_at"),
            )
            saw_invalid_at = True
            continue

        # ── 7. Artifact evidence check ────────────────────────────────────────
        artifact_reason = _validate_artifact_fields(rec)
        if artifact_reason is not None:
            logger.warning(
                "[approval_evidence] missing_review_artifact for record %s — "
                "failing closed",
                rec.get("approval_id"),
            )
            saw_missing_artifact = True
            continue

        # ── All seven checks passed ───────────────────────────────────────────
        return ApprovalCheckResult(
            True, "approved",
            rec.get("reviewer_id"), rec.get("approval_id"),
        )

    # Priority: most actionable / most fundamental first.
    if saw_pending:
        return ApprovalCheckResult(False, "pending_human_review")
    if saw_reviewer_reason:
        return ApprovalCheckResult(False, saw_reviewer_reason)
    if saw_revoked_appr:
        return ApprovalCheckResult(False, "revoked_approval")
    if saw_inactive_appr:
        return ApprovalCheckResult(False, "inactive_approval")
    if saw_hash_mismatch:
        return ApprovalCheckResult(False, "hash_mismatch")
    if saw_record_mismatch:
        return ApprovalCheckResult(False, "record_mismatch")
    if saw_invalid_at:
        return ApprovalCheckResult(False, "invalid_approved_at")
    if saw_missing_artifact:
        return ApprovalCheckResult(False, "missing_review_artifact")
    if saw_malformed:
        return ApprovalCheckResult(False, "malformed")
    return ApprovalCheckResult(False, "missing_approval")
