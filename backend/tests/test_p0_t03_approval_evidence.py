"""
P0 containment test — T03 (DHARA-Team-Delivery-Tracker-2026-10-26.xlsx,
Batch A: legal-release containment).

Direct unit tests of engine.approval_evidence.check_approval() — the
fail-closed gate that must deny missing, revoked, hash-mismatched, and
malformed/unauthorized approval evidence, and only approve a record that
is fully formed, active, unrevoked, and hash-matched to an identified
reviewer. No real approval is ever created by these tests — synthetic
in-memory registries are passed explicitly; the real on-disk registry
(backend/data/approval_evidence_registry.json) is never read or written
by this file except in the one test that confirms it is empty by default.
"""
from __future__ import annotations

import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from engine.approval_evidence import check_approval, compute_content_hash  # noqa: E402


def _valid_record(**overrides) -> dict:
    rec = {
        "approval_id": "A-001",
        "record_type": "historical_applicability",
        "subject_key": "ipc_34",
        "content_hash": compute_content_hash("the exact approved text"),
        "reviewer_id": "adv.jane.doe",
        "status": "active",
    }
    rec.update(overrides)
    return rec


class TestMissingApprovalFailsClosed:
    def test_empty_registry_denies(self):
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("x"), registry=[])
        assert result.approved is False
        assert result.reason == "missing_approval"

    def test_no_matching_subject_key_denies(self):
        registry = [_valid_record(subject_key="ipc_99")]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "missing_approval"

    def test_no_matching_record_type_denies(self):
        registry = [_valid_record(record_type="correspondence")]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "missing_approval"

    def test_real_on_disk_registry_is_empty_by_default(self):
        # Confirms no approvals were seeded by this remediation work.
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("anything"))
        assert result.approved is False
        assert result.reason == "missing_approval"


class TestRevokedApprovalFailsClosed:
    def test_revoked_status_denies(self):
        registry = [_valid_record(status="revoked", revoked_at="2026-10-27T00:00:00Z")]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "revoked"

    def test_revoked_at_present_denies_even_if_status_field_wrong(self):
        registry = [_valid_record(revoked_at="2026-10-27T00:00:00Z")]  # status still says "active"
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "revoked"

    def test_inactive_status_denies(self):
        registry = [_valid_record(status="pending")]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "revoked"


class TestHashMismatchFailsClosed:
    def test_wrong_hash_denies(self):
        registry = [_valid_record()]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("a DIFFERENT text — source changed"), registry=registry)
        assert result.approved is False
        assert result.reason == "hash_mismatch"


class TestMalformedOrUnauthorizedFailsClosed:
    def test_missing_reviewer_id_denies(self):
        registry = [_valid_record(reviewer_id="")]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "malformed"

    def test_missing_approval_id_denies(self):
        registry = [_valid_record(approval_id="")]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "malformed"

    def test_non_dict_entry_in_registry_is_skipped_not_crashed(self):
        registry = ["not-a-dict", _valid_record()]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is True  # the valid record after the junk entry still works


class TestValidApprovalIsGranted:
    def test_fully_valid_record_is_approved_and_identifies_reviewer(self):
        registry = [_valid_record()]
        result = check_approval("historical_applicability", "ipc_34", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is True
        assert result.reason == "approved"
        assert result.reviewer_id == "adv.jane.doe"
        assert result.approval_id == "A-001"

    def test_two_approved_records_for_different_subjects_do_not_cross_approve(self):
        # Two valid, unrelated approvals existing must not imply a
        # relationship/approval between EACH OTHER (future correspondence
        # gating, T05) — each subject_key is checked independently here.
        registry = [_valid_record(approval_id="A-001", subject_key="ipc_34"),
                    _valid_record(approval_id="A-002", subject_key="crpc_41")]
        result = check_approval("historical_applicability", "some_other_key", compute_content_hash("the exact approved text"), registry=registry)
        assert result.approved is False
        assert result.reason == "missing_approval"


class TestContentHashBindsExactVersion:
    def test_hash_changes_when_text_changes(self):
        h1 = compute_content_hash("version one of the text")
        h2 = compute_content_hash("version two of the text")
        assert h1 != h2

    def test_hash_is_stable_for_same_text(self):
        assert compute_content_hash("same text") == compute_content_hash("same text")

    def test_hash_normalizes_surrounding_whitespace_only(self):
        assert compute_content_hash("  same text  ") == compute_content_hash("same text")
