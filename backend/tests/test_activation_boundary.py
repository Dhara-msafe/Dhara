"""
DHARA Activation Boundary — Focused Test Suite (Step 4)

Tests validate_activation_candidate() in engine/activation_boundary.py.

Every test exercises one specific prerequisite from the docstring (A–J).
No test issues a real approval, seeds registry data, or writes to the real
approval_evidence_registry.json — all use registry_override / authorized_reviewers_override.

Test IDs: B01–B24
─────────────────────────────────────────────────────────────────────────────
B01 — fully valid pending record → valid=True, activation_fields populated
B02 — approval_id not found in registry → valid=False
B03 — duplicate approval_id in registry → valid=False
B04 — status already active → valid=False
B05 — status revoked → valid=False
B06 — status rejected → valid=False
B07 — missing structural field (record_type) → valid=False
B08 — missing structural field (schema_version) → valid=False
B09 — content_hash mismatch (canonical field altered) → valid=False
B10 — reviewer_id absent → valid=False
B11 — reviewer_id not in authorized_reviewers allowlist → valid=False
B12 — reviewer inactive (status != 'active') → valid=False
B13 — reviewer revoked (revoked=True) → valid=False
B14 — approved_at absent → valid=False
B15 — approved_at without timezone → valid=False
B16 — approved_at in future beyond tolerance → valid=False
B17 — approved_at unparseable string → valid=False
B18 — review_artifact_id absent → valid=False
B19 — review_artifact_digest absent → valid=False
B20 — review_artifact_digest wrong format → valid=False
B21 — active approval already exists for same subject_key → valid=False
B22 — registry load error → valid=False
B23 — non-v1 schema_version → valid=True with warning (hash check skipped)
B24 — activation_fields is None when valid=False (no fields leaked on failure)
─────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from engine.approval_evidence import (   # noqa: E402
    RegistryData,
    compute_canonical_record_hash,
    _load_registry_data,
)
from engine.activation_boundary import (   # noqa: E402
    validate_activation_candidate,
    ActivationValidationResult,
)

# ─────────────────────────────────────────────────────────────────────────────
# Shared fixtures
# ─────────────────────────────────────────────────────────────────────────────

_CANONICAL = {
    "schema_version": "v1",
    "source_act": "IPC",
    "source_section": "166A",
    "target_act": "BNS",
    "target_section": "199",
    "offence_text": "Public servant disobeying direction under law",
    "punishment_text": (
        "Rigorous imprisonment of at least six months and up to two years, and fine"
    ),
}
_V1_HASH = compute_canonical_record_hash(_CANONICAL)

# A past ISO 8601 datetime with explicit timezone (earlier today — well within system date)
_VALID_APPROVED_AT = "2026-10-31T00:00:00+00:00"

# Valid sha256:<64-hex> digest
_VALID_DIGEST = "sha256:" + "a" * 64

_ACTIVE_REVIEWER = {
    "reviewer_id": "callistus-moses-founder",
    "name": "Callistus Moses",
    "role": "founder-ceo",
    "status": "active",
    "revoked": False,
}


def _pending_rec(**overrides) -> dict:
    """Fully populated pending record — passes all checks without overrides."""
    base = {
        "approval_id":            "TEST-PENDING-001",
        "record_type":            "correspondence",
        "subject_key":            "IPC:166A->BNS:199",
        "section_from":           "IPC:166A",
        "section_to":             "BNS:199",
        "schema_version":         "v1",
        "content_hash":           _V1_HASH,
        "reviewer_id":            "callistus-moses-founder",
        "status":                 "pending_human_review",
        "approved_at":            _VALID_APPROVED_AT,
        "review_artifact_id":     "TEST-ART-001",
        "review_artifact_digest": _VALID_DIGEST,
    }
    base.update(overrides)
    return base


def _run(rec=None, canonical=None, ar=None, approval_id="TEST-PENDING-001", **extra_recs):
    """Convenience wrapper: call validate_activation_candidate with synthetic data."""
    registry = [rec] if rec is not None else []
    if extra_recs.get("extra"):
        registry.extend(extra_recs["extra"])
    return validate_activation_candidate(
        approval_id=approval_id,
        canonical_record=canonical if canonical is not None else _CANONICAL,
        registry_override=registry,
        authorized_reviewers_override=ar if ar is not None else [_ACTIVE_REVIEWER],
    )


# ─────────────────────────────────────────────────────────────────────────────
# B01 — Valid pending record → passes all prerequisites
# ─────────────────────────────────────────────────────────────────────────────

class TestB01ValidPendingRecord:
    def test_B01a_valid_is_true(self):
        """A fully populated pending record that satisfies all 10 prerequisites
        must return valid=True."""
        result = _run(_pending_rec())
        assert result.valid is True, (
            f"B01: fully valid pending record must pass; failures={result.failures}"
        )

    def test_B01b_activation_fields_populated(self):
        """When valid=True, activation_fields must be non-None and contain
        the status and reviewer evidence fields."""
        result = _run(_pending_rec())
        assert result.valid is True
        assert result.activation_fields is not None, (
            "B01b: activation_fields must be populated when valid=True"
        )
        assert result.activation_fields.get("status") == "active", (
            "B01b: activation_fields.status must be 'active'"
        )
        assert result.activation_fields.get("reviewer_id") == "callistus-moses-founder"
        assert result.activation_fields.get("review_artifact_id") == "TEST-ART-001"

    def test_B01c_no_failures(self):
        result = _run(_pending_rec())
        assert result.failures == [], (
            f"B01c: no failures expected; got: {result.failures}"
        )

    def test_B01d_approval_id_preserved(self):
        result = _run(_pending_rec())
        assert result.approval_id == "TEST-PENDING-001"


# ─────────────────────────────────────────────────────────────────────────────
# B02 — approval_id not found
# ─────────────────────────────────────────────────────────────────────────────

class TestB02ApprovalIdNotFound:
    def test_B02_approval_id_not_in_registry(self):
        """If approval_id is not present in registry, validation must fail."""
        result = _run(_pending_rec(), approval_id="DOES-NOT-EXIST")
        assert result.valid is False, "B02: missing approval_id must fail"
        assert any("not found" in f for f in result.failures), (
            f"B02: failure must mention 'not found'; failures={result.failures}"
        )

    def test_B02b_empty_registry_fails(self):
        """An empty registry must also fail (no record to validate)."""
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=[],
            authorized_reviewers_override=[_ACTIVE_REVIEWER],
        )
        assert result.valid is False, "B02b: empty registry must fail"


# ─────────────────────────────────────────────────────────────────────────────
# B03 — Duplicate approval_id
# ─────────────────────────────────────────────────────────────────────────────

class TestB03DuplicateApprovalId:
    def test_B03_duplicate_approval_id_fails(self):
        """Two registry entries with the same approval_id must fail validation."""
        dup = [_pending_rec(), _pending_rec()]   # same approval_id twice
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=dup,
            authorized_reviewers_override=[_ACTIVE_REVIEWER],
        )
        assert result.valid is False, "B03: duplicate approval_id must fail"
        assert any("duplicate" in f.lower() for f in result.failures), (
            f"B03: failure must mention 'duplicate'; failures={result.failures}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# B04–B06 — Status not pending_human_review (H)
# ─────────────────────────────────────────────────────────────────────────────

class TestB04StatusAlreadyActive:
    def test_B04_status_active_fails(self):
        """A record already marked 'active' must not pass activation — already done."""
        result = _run(_pending_rec(status="active"))
        assert result.valid is False, "B04: active status must fail (already active)"
        assert any("already active" in f for f in result.failures), (
            f"B04: failure must mention 'already active'; failures={result.failures}"
        )


class TestB05StatusRevoked:
    def test_B05_status_revoked_fails(self):
        result = _run(_pending_rec(status="revoked"))
        assert result.valid is False, "B05: revoked status must fail"
        assert any("revoked" in f for f in result.failures)


class TestB06StatusRejected:
    def test_B06_status_rejected_fails(self):
        result = _run(_pending_rec(status="rejected"))
        assert result.valid is False, "B06: rejected status must fail"
        assert any("rejected" in f or "revoked" in f for f in result.failures)


# ─────────────────────────────────────────────────────────────────────────────
# B07–B08 — Missing structural fields (B)
# ─────────────────────────────────────────────────────────────────────────────

class TestB07MissingStructuralFields:
    def test_B07_missing_record_type_fails(self):
        rec = _pending_rec()
        del rec["record_type"]
        result = _run(rec)
        assert result.valid is False, "B07: missing record_type must fail"
        assert any("record_type" in f for f in result.failures), (
            f"B07: failure must mention 'record_type'; failures={result.failures}"
        )

    def test_B07b_missing_subject_key_fails(self):
        rec = _pending_rec()
        del rec["subject_key"]
        result = _run(rec)
        assert result.valid is False, "B07b: missing subject_key must fail"

    def test_B07c_missing_section_from_fails(self):
        rec = _pending_rec()
        del rec["section_from"]
        result = _run(rec)
        assert result.valid is False, "B07c: missing section_from must fail"

    def test_B07d_missing_section_to_fails(self):
        rec = _pending_rec()
        del rec["section_to"]
        result = _run(rec)
        assert result.valid is False, "B07d: missing section_to must fail"

    def test_B08_missing_schema_version_fails(self):
        """schema_version is a required structural field."""
        rec = _pending_rec()
        del rec["schema_version"]
        result = _run(rec)
        assert result.valid is False, "B08: missing schema_version must fail"
        assert any("schema_version" in f for f in result.failures)


# ─────────────────────────────────────────────────────────────────────────────
# B09 — Content hash mismatch (C)
# ─────────────────────────────────────────────────────────────────────────────

class TestB09ContentHashMismatch:
    def test_B09_altered_canonical_field_fails(self):
        """If offence_text is altered after the hash was stored, validation must fail."""
        mutated = {**_CANONICAL, "offence_text": "ALTERED — hash will not match"}
        result = _run(_pending_rec(), canonical=mutated)
        assert result.valid is False, "B09: hash mismatch must fail"
        assert any("mismatch" in f.lower() or "MISMATCH" in f for f in result.failures), (
            f"B09: failure must mention 'MISMATCH'; failures={result.failures}"
        )

    def test_B09b_stored_hash_wrong_fails(self):
        """A record whose stored content_hash is wrong must fail."""
        result = _run(_pending_rec(content_hash="0" * 64))
        assert result.valid is False, "B09b: wrong stored hash must fail"

    def test_B09c_missing_content_hash_fails(self):
        rec = _pending_rec()
        del rec["content_hash"]
        result = _run(rec)
        assert result.valid is False, "B09c: missing content_hash must fail"


# ─────────────────────────────────────────────────────────────────────────────
# B10–B13 — Reviewer identity (D)
# ─────────────────────────────────────────────────────────────────────────────

class TestB10ReviewerAbsent:
    def test_B10_missing_reviewer_id_fails(self):
        rec = _pending_rec()
        del rec["reviewer_id"]
        result = _run(rec)
        assert result.valid is False, "B10: missing reviewer_id must fail"
        assert any("reviewer" in f.lower() for f in result.failures)


class TestB11UnauthorizedReviewer:
    def test_B11_reviewer_not_in_allowlist_fails(self):
        other_ar = [{"reviewer_id": "someone-else", "status": "active", "revoked": False}]
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=[_pending_rec()],
            authorized_reviewers_override=other_ar,
        )
        assert result.valid is False, "B11: unauthorized reviewer must fail"
        assert any("unauthorized_reviewer" in f or "identity check" in f for f in result.failures)

    def test_B11b_empty_allowlist_fails(self):
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=[_pending_rec()],
            authorized_reviewers_override=[],
        )
        assert result.valid is False, "B11b: empty allowlist must fail"


class TestB12InactiveReviewer:
    def test_B12_inactive_reviewer_fails(self):
        inactive_ar = [{**_ACTIVE_REVIEWER, "status": "inactive"}]
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=[_pending_rec()],
            authorized_reviewers_override=inactive_ar,
        )
        assert result.valid is False, "B12: inactive reviewer must fail"
        assert any("inactive_reviewer" in f for f in result.failures)


class TestB13RevokedReviewer:
    def test_B13_revoked_reviewer_bool_fails(self):
        revoked_ar = [{**_ACTIVE_REVIEWER, "revoked": True}]
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=[_pending_rec()],
            authorized_reviewers_override=revoked_ar,
        )
        assert result.valid is False, "B13: revoked reviewer must fail"
        assert any("revoked_reviewer" in f for f in result.failures)


# ─────────────────────────────────────────────────────────────────────────────
# B14–B17 — approved_at validation (E)
# ─────────────────────────────────────────────────────────────────────────────

class TestB14MissingApprovedAt:
    def test_B14_missing_approved_at_fails(self):
        result = _run(_pending_rec(approved_at=None))
        assert result.valid is False, "B14: missing approved_at must fail"
        assert any("approved_at" in f.lower() or "reviewer must supply" in f for f in result.failures)

    def test_B14b_empty_approved_at_fails(self):
        result = _run(_pending_rec(approved_at=""))
        assert result.valid is False, "B14b: empty approved_at must fail"


class TestB15MissingTimezone:
    def test_B15_approved_at_no_timezone_fails(self):
        """A naive datetime (no offset) must be rejected."""
        result = _run(_pending_rec(approved_at="2026-10-31T00:00:00"))
        assert result.valid is False, "B15: no-timezone approved_at must fail"
        assert any("timezone" in f.lower() or "offset" in f.lower() for f in result.failures), (
            f"B15: failure must mention timezone; failures={result.failures}"
        )

    def test_B15b_approved_at_date_only_fails(self):
        """A date-only string is naive — must fail."""
        result = _run(_pending_rec(approved_at="2026-10-31"))
        assert result.valid is False, "B15b: date-only approved_at must fail"


class TestB16FutureApprovedAt:
    def test_B16_approved_at_far_future_fails(self):
        """A timestamp more than _APPROVED_AT_CLOCK_SKEW_TOLERANCE_MINUTES ahead must fail."""
        future_dt = (
            datetime.now(timezone.utc) + timedelta(hours=2)
        ).isoformat()   # 120 min in future > 60 min tolerance
        result = _run(_pending_rec(approved_at=future_dt))
        assert result.valid is False, "B16: far-future approved_at must fail"
        assert any("future" in f.lower() for f in result.failures), (
            f"B16: failure must mention 'future'; failures={result.failures}"
        )


class TestB17InvalidApprovedAtFormat:
    def test_B17_garbage_string_fails(self):
        result = _run(_pending_rec(approved_at="not-a-datetime"))
        assert result.valid is False, "B17: unparseable approved_at must fail"
        assert any("ISO 8601" in f or "valid" in f.lower() for f in result.failures), (
            f"B17: failure must mention 'ISO 8601'; failures={result.failures}"
        )

    def test_B17b_unix_timestamp_string_fails(self):
        """A Unix timestamp string is not valid ISO 8601."""
        result = _run(_pending_rec(approved_at="1698710400"))
        assert result.valid is False, "B17b: Unix timestamp string must fail"


# ─────────────────────────────────────────────────────────────────────────────
# B18–B20 — Artifact evidence (F, G)
# ─────────────────────────────────────────────────────────────────────────────

class TestB18MissingArtifactId:
    def test_B18_missing_review_artifact_id_fails(self):
        result = _run(_pending_rec(review_artifact_id=None))
        assert result.valid is False, "B18: missing review_artifact_id must fail"
        assert any("review_artifact_id" in f for f in result.failures), (
            f"B18: failure must mention 'review_artifact_id'; failures={result.failures}"
        )

    def test_B18b_empty_review_artifact_id_fails(self):
        result = _run(_pending_rec(review_artifact_id=""))
        assert result.valid is False, "B18b: empty review_artifact_id must fail"


class TestB19MissingArtifactDigest:
    def test_B19_missing_digest_fails(self):
        result = _run(_pending_rec(review_artifact_digest=None))
        assert result.valid is False, "B19: missing digest must fail"
        assert any("review_artifact_digest" in f for f in result.failures), (
            f"B19: failure must mention 'review_artifact_digest'; failures={result.failures}"
        )

    def test_B19b_empty_digest_fails(self):
        result = _run(_pending_rec(review_artifact_digest=""))
        assert result.valid is False, "B19b: empty digest must fail"


class TestB20WrongDigestFormat:
    def test_B20_no_sha256_prefix_fails(self):
        """Digest without 'sha256:' prefix is invalid."""
        result = _run(_pending_rec(review_artifact_digest="a" * 64))
        assert result.valid is False, "B20: digest without sha256: prefix must fail"
        assert any("sha256" in f.lower() for f in result.failures), (
            f"B20: failure must mention 'sha256'; failures={result.failures}"
        )

    def test_B20b_wrong_hex_length_fails(self):
        """sha256: followed by fewer than 64 hex chars is invalid."""
        result = _run(_pending_rec(review_artifact_digest="sha256:" + "a" * 32))
        assert result.valid is False, "B20b: short hex must fail"

    def test_B20c_non_hex_chars_fail(self):
        """sha256: prefix with non-hex characters fails."""
        result = _run(_pending_rec(review_artifact_digest="sha256:" + "g" * 64))
        assert result.valid is False, "B20c: non-hex digest must fail"

    def test_B20d_valid_digest_format_passes(self):
        """sha256:<64 lowercase hex chars> is the only valid format."""
        valid_digest = "sha256:" + "deadbeef" * 8  # 64 hex chars
        result = _run(_pending_rec(review_artifact_digest=valid_digest))
        assert result.valid is True, (
            f"B20d: valid sha256 digest must pass; failures={result.failures}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# B21 — Active conflict for same subject_key (I)
# ─────────────────────────────────────────────────────────────────────────────

class TestB21ActiveConflict:
    def test_B21_active_record_for_same_subject_key_fails(self):
        """If another record with the same subject_key is already active,
        activation must fail — prevents duplicate active approvals."""
        already_active = {
            "approval_id":    "ALREADY-ACTIVE-001",
            "subject_key":    "IPC:166A->BNS:199",
            "status":         "active",
            "record_type":    "correspondence",
        }
        registry = [_pending_rec(), already_active]
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=registry,
            authorized_reviewers_override=[_ACTIVE_REVIEWER],
        )
        assert result.valid is False, "B21: active conflict must fail"
        assert any("active" in f.lower() and "already" in f.lower() for f in result.failures), (
            f"B21: failure must mention existing active approval; failures={result.failures}"
        )

    def test_B21b_revoked_sibling_does_not_block(self):
        """A revoked sibling with the same subject_key must NOT block activation."""
        revoked_sibling = {
            "approval_id": "REVOKED-SIBLING",
            "subject_key": "IPC:166A->BNS:199",
            "status":      "revoked",
            "record_type": "correspondence",
        }
        registry = [_pending_rec(), revoked_sibling]
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=registry,
            authorized_reviewers_override=[_ACTIVE_REVIEWER],
        )
        # A revoked sibling is not an active conflict — should not add failure for I
        active_conflict_failures = [
            f for f in result.failures
            if "active" in f.lower() and ("already" in f.lower() or "conflict" in f.lower() or "existing" in f.lower())
        ]
        assert not active_conflict_failures, (
            f"B21b: revoked sibling must not block activation; failures={result.failures}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# B22 — Registry load error (J)
# ─────────────────────────────────────────────────────────────────────────────

class TestB22RegistryLoadError:
    def test_B22_load_error_fails_closed(self, monkeypatch):
        """When _load_registry_data returns a load_error, activation fails closed."""
        error_data = RegistryData(
            load_error="simulated I/O failure",
            load_error_reason="registry_unavailable",
        )
        _load_registry_data.cache_clear()
        import engine.activation_boundary as _ab
        monkeypatch.setattr(_ab, "_load_registry_data", lambda: error_data)

        result = validate_activation_candidate(
            approval_id="REGISTRY-001-v1-IPC166A-BNS199",
            canonical_record=_CANONICAL,
            # No registry_override → goes to real load path (monkeypatched)
        )
        assert result.valid is False, "B22: registry load error must fail closed"
        assert result.failures, "B22: failures list must be non-empty"
        assert any("registry" in f.lower() for f in result.failures), (
            f"B22: failure must mention registry; failures={result.failures}"
        )
        _load_registry_data.cache_clear()


# ─────────────────────────────────────────────────────────────────────────────
# B23 — Non-v1 schema version (warning, not failure)
# ─────────────────────────────────────────────────────────────────────────────

class TestB23NonV1Schema:
    def test_B23_v0_schema_skips_hash_check_with_warning(self):
        """A v0 record skips the canonical hash check and adds a warning instead.
        If all other checks pass, the record is valid=True (with warning)."""
        result = _run(_pending_rec(schema_version="v0"))
        assert result.valid is True, (
            f"B23: v0 record with all other checks passing must be valid; "
            f"failures={result.failures}"
        )
        assert result.warnings, (
            "B23: v0 record must produce a warning about manual hash verification"
        )
        assert any("v1" in w.lower() or "manual" in w.lower() for w in result.warnings), (
            f"B23: warning must mention v1 or manual; warnings={result.warnings}"
        )

    def test_B23b_v0_schema_does_not_fail_on_hash(self):
        """Hash mismatch for a v0 record should not appear in failures."""
        mutated_canonical = {**_CANONICAL, "offence_text": "DIFFERENT TEXT"}
        result = _run(_pending_rec(schema_version="v0"), canonical=mutated_canonical)
        # Hash mismatch is not checked for v0 — so there should be no hash-related failure
        hash_failures = [f for f in result.failures if "hash" in f.lower() or "mismatch" in f.lower()]
        assert not hash_failures, (
            f"B23b: v0 record must not fail on hash; hash failures={hash_failures}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# B24 — activation_fields is None when valid=False (no data leaked on failure)
# ─────────────────────────────────────────────────────────────────────────────

class TestB24NoActivationFieldsOnFailure:
    def _assert_no_fields(self, result: ActivationValidationResult, label: str):
        assert result.valid is False, f"{label}: expected valid=False"
        assert result.activation_fields is None, (
            f"{label}: activation_fields must be None on failure (data must not leak); "
            f"got: {result.activation_fields}"
        )

    def test_B24a_missing_id_no_fields(self):
        self._assert_no_fields(_run(_pending_rec(), approval_id="MISSING"), "B24a")

    def test_B24b_status_active_no_fields(self):
        self._assert_no_fields(_run(_pending_rec(status="active")), "B24b")

    def test_B24c_hash_mismatch_no_fields(self):
        mutated = {**_CANONICAL, "offence_text": "DIFFERENT"}
        self._assert_no_fields(_run(_pending_rec(), canonical=mutated), "B24c")

    def test_B24d_invalid_digest_no_fields(self):
        self._assert_no_fields(
            _run(_pending_rec(review_artifact_digest="INVALID")),
            "B24d"
        )

    def test_B24e_unauthorized_reviewer_no_fields(self):
        other_ar = [{"reviewer_id": "someone-else", "status": "active", "revoked": False}]
        result = validate_activation_candidate(
            approval_id="TEST-PENDING-001",
            canonical_record=_CANONICAL,
            registry_override=[_pending_rec()],
            authorized_reviewers_override=other_ar,
        )
        self._assert_no_fields(result, "B24e")


# ─────────────────────────────────────────────────────────────────────────────
# Integration: no successor section released on any activation failure
# ─────────────────────────────────────────────────────────────────────────────

class TestNoSuccessorSectionOnFailure:
    """Activation boundary contract: when validation fails, the xref endpoint
    must also withhold the successor section (structural withholding still active).
    This cross-checks the boundary with the gate at query time (defence-in-depth)."""

    @classmethod
    def setup_class(cls):
        import server as _srv
        _load_registry_data.cache_clear()
        cls.srv = _srv

    def test_BS01_ipc166a_new_section_withheld_while_pending(self):
        """As long as REGISTRY-001-v1 is pending_human_review (activation not complete),
        the xref endpoint must return new_section=null for IPC:166A queries."""
        results = self.srv._xref_search(ipc="166A")
        matching = [r for r in results if r.get("old_section") == "166A"]
        assert matching, "IPC:166A must be in the cross-reference data"
        r = matching[0]
        assert r.get("new_section") is None, (
            f"BS01: IPC:166A new_section must be null while activation incomplete; "
            f"got: {r.get('new_section')!r}"
        )
        assert r.get("correspondence_approval") == "pending_human_review", (
            f"BS01: correspondence_approval must be 'pending_human_review'; "
            f"got: {r.get('correspondence_approval')!r}"
        )

    def test_BS02_activation_failure_does_not_release_section(self):
        """Confirm that validate_activation_candidate(REGISTRY-001-v1) fails,
        and independently that the xref endpoint withholds the section.
        These are two independent lines of defence — both must hold."""
        from engine.approval_evidence import _load_registry_data as _lrd
        _lrd.cache_clear()
        # Activation boundary: real registry → should fail (status=pending_human_review)
        val_result = validate_activation_candidate(
            approval_id="REGISTRY-001-v1-IPC166A-BNS199",
            canonical_record=_CANONICAL,
        )
        assert val_result.valid is False, (
            f"BS02: REGISTRY-001-v1 activation must fail (still pending); "
            f"failures={val_result.failures}"
        )
        # Gate at query time: xref → should also withhold
        xref_results = self.srv._xref_search(ipc="166A")
        r = next((x for x in xref_results if x.get("old_section") == "166A"), None)
        assert r is not None
        assert r.get("new_section") is None, (
            "BS02: structural withholding must hold independently of activation boundary"
        )
