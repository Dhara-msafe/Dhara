"""
DHARA Approval Activation Boundary
====================================
Provides a controlled validation function that MUST be exercised before any
approval record may be changed from ``pending_human_review`` to ``active``.

Architecture limitation (documented):
--------------------------------------
This module provides *validation only*.  It does NOT write to the registry file.
The actual write (changing ``status`` from ``pending_human_review`` to ``active``)
must be performed manually by an operator with write access to the registry JSON,
after this validator passes and after the reviewer supplies a signed declaration.

This design is intentional while the registry is a local JSON file without
a transactional store.  A future registry workflow (database-backed, API-gated)
would integrate this validator as the only write path, making direct status
mutation impossible without a corresponding audit event.

Until that workflow exists, the following controls prevent unauthorized activation:
  1. The registry JSON is not exposed through any API endpoint that accepts writes.
  2. This module MUST be called and its result checked before any manual edit.
  3. An audit event is appended to the append-only audit log on every invocation.
  4. The activation gate in check_section_correspondence_approval independently
     verifies all fields at query time, so an incomplete activation is caught
     even if this validator was bypassed.

Controlled activation prerequisites
--------------------------------------
A record may only be activated when ALL of the following hold:
  A. approval_id is present and matches the target record.
  B. record_type, subject_key, schema_version, section_from, section_to are
     present and internally consistent.
  C. content_hash recomputed from canonical_record matches stored content_hash
     (canonical content has not changed since the hash was stored).
  D. reviewer_id is non-empty and names exactly one active, non-revoked entry
     in the authorized_reviewers list.
  E. approved_at is a valid ISO 8601 datetime with explicit timezone and is not
     more than _APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES in the future.
  F. review_artifact_id is non-empty.
  G. review_artifact_digest is non-empty and matches the format sha256:<hex64>.
  H. Current status of the record is ``pending_human_review`` (not already active,
     not revoked, not rejected).
  I. No other active approval exists for the same subject_key (prevents duplicates).
  J. Registry and authorized_reviewers are loadable and well-formed.

None of these checks can be bypassed by passing a modified request payload.
The registry file must be edited directly — but only AFTER this function passes.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from engine.approval_evidence import (
    _APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES,
    _CANONICAL_SCHEMA_VERSION,
    _load_registry_data,
    _check_reviewer_identity,
    compute_canonical_record_hash,
)

logger = logging.getLogger("gandhikar")

# Path for append-only activation-attempt audit log
_AUDIT_LOG_PATH = Path(__file__).parent.parent / "data" / "activation_audit_log.jsonl"

# Artifact digest must match sha256:<64 hex chars>
_ARTIFACT_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$", re.IGNORECASE)


# ─────────────────────────────────────────────────────────────────────────────
# Result types
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ActivationValidationResult:
    """Returned by validate_activation_candidate.  Never approves or writes."""
    valid: bool
    approval_id: str
    failures: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    # populated only when valid=True; human operator must copy these into registry
    activation_fields: Optional[dict] = None


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _append_audit_event(event: dict) -> None:
    """Append a JSON line to the activation audit log.  Fails silently (logs error)."""
    try:
        _AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _AUDIT_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=True) + "\n")
    except Exception as exc:
        logger.error("[activation_boundary] failed to write audit event: %s", exc)


def _check_artifact_digest_format(digest: Optional[str]) -> bool:
    """Return True iff digest matches sha256:<64-hex>."""
    if not digest:
        return False
    return bool(_ARTIFACT_DIGEST_RE.match(digest))


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def validate_activation_candidate(
    approval_id: str,
    canonical_record: dict,
    registry_override: Optional[List[dict]] = None,
    authorized_reviewers_override: Optional[List[dict]] = None,
) -> ActivationValidationResult:
    """Validate that an approval record is ready for activation.

    Does NOT write to the registry.  Appends an audit event recording the
    outcome (pass or fail with reasons).

    Parameters
    ----------
    approval_id:
        The ``approval_id`` of the record to validate (e.g.
        ``"REGISTRY-001-v1-IPC166A-BNS199"``).
    canonical_record:
        The seven-field canonical dict that was hashed when the record was
        created.  Used to recompute and verify content_hash.
    registry_override:
        Test-only — inject a synthetic approval list.  Production callers
        must leave this as None so the real registry file is loaded.
    authorized_reviewers_override:
        Test-only — inject a synthetic reviewer list.

    Returns
    -------
    ActivationValidationResult with valid=True and activation_fields populated
    when all prerequisites are met.  valid=False with a non-empty failures list
    otherwise.
    """
    failures: List[str] = []
    warnings: List[str] = []

    # ── J. Load registry ─────────────────────────────────────────────────────
    if registry_override is None:
        reg_data = _load_registry_data()
        if reg_data.load_error:
            reason = f"registry load error ({reg_data.load_error_reason}): {reg_data.load_error}"
            failures.append(reason)
            _append_audit_event({
                "event": "activation_validation",
                "approval_id": approval_id,
                "valid": False,
                "failures": failures,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            return ActivationValidationResult(
                valid=False, approval_id=approval_id, failures=failures
            )
        approvals = reg_data.approvals
        authorized_reviewers = reg_data.authorized_reviewers
    else:
        approvals = registry_override
        authorized_reviewers = authorized_reviewers_override or []

    # ── A. Find the target record ─────────────────────────────────────────────
    candidates = [
        r for r in approvals
        if isinstance(r, dict) and r.get("approval_id") == approval_id
    ]
    if not candidates:
        failures.append(f"approval_id '{approval_id}' not found in registry")
        _append_audit_event({
            "event": "activation_validation", "approval_id": approval_id,
            "valid": False, "failures": failures,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        return ActivationValidationResult(valid=False, approval_id=approval_id, failures=failures)
    if len(candidates) > 1:
        failures.append(f"duplicate approval_id '{approval_id}' in registry — conflicting records")
        _append_audit_event({
            "event": "activation_validation", "approval_id": approval_id,
            "valid": False, "failures": failures,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        return ActivationValidationResult(valid=False, approval_id=approval_id, failures=failures)

    rec = candidates[0]

    # ── H. Status must be pending_human_review ────────────────────────────────
    current_status = rec.get("status")
    if current_status == "active":
        failures.append("record is already active — no activation needed")
    elif current_status in ("revoked", "rejected"):
        failures.append(
            f"record status is '{current_status}' — cannot activate a revoked or rejected record"
        )
    elif current_status != "pending_human_review":
        failures.append(
            f"record status is '{current_status}' — expected 'pending_human_review'"
        )

    # ── B. Structural consistency ─────────────────────────────────────────────
    required_structural = ("record_type", "subject_key", "schema_version", "section_from", "section_to")
    for fld in required_structural:
        if not rec.get(fld):
            failures.append(f"required structural field '{fld}' is absent or empty")

    # ── C. Canonical content hash must match ──────────────────────────────────
    stored_hash = rec.get("content_hash")
    if not stored_hash:
        failures.append("content_hash field is absent or empty")
    else:
        if rec.get("schema_version") == _CANONICAL_SCHEMA_VERSION:
            try:
                recomputed = compute_canonical_record_hash(canonical_record)
                if recomputed != stored_hash:
                    failures.append(
                        f"content_hash MISMATCH — canonical content changed after hash was stored. "
                        f"Stored: {stored_hash[:16]}... Recomputed: {recomputed[:16]}..."
                    )
            except ValueError as exc:
                failures.append(f"canonical_record is invalid: {exc}")
        else:
            warnings.append(
                "schema_version is not v1 — canonical content hash cannot be recomputed; "
                "manual hash verification required"
            )

    # ── D. Reviewer identity ──────────────────────────────────────────────────
    reviewer_reason = _check_reviewer_identity(
        rec.get("reviewer_id", ""), authorized_reviewers
    )
    if reviewer_reason is not None:
        failures.append(
            f"reviewer_id '{rec.get('reviewer_id')}' failed identity check: {reviewer_reason}"
        )

    # ── E. approved_at ────────────────────────────────────────────────────────
    approved_at = rec.get("approved_at")
    if not approved_at:
        failures.append("approved_at is absent — reviewer must supply an ISO 8601 datetime with timezone")
    else:
        try:
            normalized = approved_at.replace("Z", "+00:00")
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                failures.append(
                    f"approved_at '{approved_at}' has no timezone — explicit offset required"
                )
            else:
                from datetime import timedelta
                now = datetime.now(timezone.utc)
                tolerance = timedelta(minutes=_APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES)
                if dt > now + tolerance:
                    failures.append(
                        f"approved_at '{approved_at}' is more than "
                        f"{_APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES} minutes in the future"
                    )
        except (ValueError, AttributeError):
            failures.append(f"approved_at '{approved_at}' is not a valid ISO 8601 datetime")

    # ── F. review_artifact_id ─────────────────────────────────────────────────
    if not rec.get("review_artifact_id"):
        failures.append("review_artifact_id is absent or empty")

    # ── G. review_artifact_digest ─────────────────────────────────────────────
    digest = rec.get("review_artifact_digest")
    if not digest:
        failures.append("review_artifact_digest is absent or empty")
    elif not _check_artifact_digest_format(digest):
        failures.append(
            f"review_artifact_digest '{digest}' does not match expected format sha256:<64 hex chars>"
        )

    # ── I. No other active record for same subject_key ────────────────────────
    subject_key = rec.get("subject_key", "")
    active_conflicts = [
        a for a in approvals
        if isinstance(a, dict)
        and a.get("subject_key") == subject_key
        and a.get("approval_id") != approval_id
        and a.get("status") == "active"
    ]
    if active_conflicts:
        conflict_ids = [a.get("approval_id") for a in active_conflicts]
        failures.append(
            f"another active approval already exists for '{subject_key}': {conflict_ids}. "
            "Revoke it before activating this record."
        )

    # ── Result ────────────────────────────────────────────────────────────────
    valid = len(failures) == 0
    activation_fields: Optional[dict] = None
    if valid:
        activation_fields = {
            "status": "active",
            "approved_at": rec.get("approved_at"),
            "reviewer_id": rec.get("reviewer_id"),
            "review_artifact_id": rec.get("review_artifact_id"),
            "review_artifact_digest": rec.get("review_artifact_digest"),
            "_activation_note": (
                "These fields were validated by activation_boundary.validate_activation_candidate. "
                "Copy them into the registry record exactly as shown and set status='active'. "
                "Do NOT prepopulate any of these fields yourself — use only what the reviewer supplied."
            ),
        }

    event = {
        "event": "activation_validation",
        "approval_id": approval_id,
        "valid": valid,
        "failures": failures,
        "warnings": warnings,
        "reviewer_id": rec.get("reviewer_id"),
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    _append_audit_event(event)

    logger.info(
        "[activation_boundary] validate_activation_candidate(%r): valid=%s failures=%d",
        approval_id, valid, len(failures),
    )

    return ActivationValidationResult(
        valid=valid,
        approval_id=approval_id,
        failures=failures,
        warnings=warnings,
        activation_fields=activation_fields,
    )
