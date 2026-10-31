"""
DHARA P1 CORRECTION — Steps 5 & 6

Step 5: BNS §199 canonical hash function tests (extended fidelity).
Step 6: Fail-closed test matrix — every failure path must default to
        withheld without crashing.

These tests are ADDITIVE to test_p1_dhara_bns199_fidelity.py (which covers
Steps 1-4 of the original P1 batch).  Nothing here edits the real registry.

Fail-closed scenarios tested (Step 6):
  601 — unauthorized reviewer_id (not in authorized_reviewers list)
  602 — revoked approval (status = "active" but revoked_at set)
  603 — revoked approval (status = "revoked")
  604 — v0 hash mismatch (wrong content_hash stored)
  605 — v1 hash mismatch (canonical_record field changed after hash computed)
  606 — missing registry record entirely
  607 — malformed record (missing required field: approval_id)
  608 — malformed record (missing required field: reviewer_id)
  609 — v1 record present but canonical_record not passed → hash_mismatch
  610 — v1 record: changing offence_text invalidates hash
  611 — v1 record: changing punishment_text invalidates hash
  612 — v1 record: changing target_section invalidates hash

Structural withholding API contract tests (Step 6 integration):
  701 — IPC:302 API result: new_section must be null
  702 — IPC:302 API result: offence must be null
  703 — IPC:302 API result: what_changed must be null
  704 — IPC:302 API result: source_link must be null
  705 — IPC:302 API result: review_status must be "withheld_pending_approval"
  706 — IPC:166A API result (approved): new_section must be non-null
  707 — IPC:166A API result (approved): offence must be non-null
  708 — contract: NotYetApprovedBanner condition (missing_approval) is mutually
        exclusive with non-null new_section in the same result dict
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from engine.approval_evidence import (   # noqa: E402
    ApprovalCheckResult,
    RegistryData,
    _CANONICAL_SCHEMA_VERSION,
    _CANONICAL_V1_REQUIRED_FIELDS,
    _is_reviewer_authorized,
    _load_registry_data,
    check_section_correspondence_approval,
    compute_canonical_record_hash,
    compute_content_hash,
)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers — synthetic registry records
# ─────────────────────────────────────────────────────────────────────────────

_V0_HASH = compute_content_hash("IPC:166A->BNS:199")  # eedb095a...

_CANONICAL_166A_199 = {
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
_V1_HASH = compute_canonical_record_hash(_CANONICAL_166A_199)  # 1787743a...


def _make_v0_record(**overrides) -> dict:
    """Factory for a syntactically valid v0 (string-hash) correspondence record.
    Includes all active-approval required fields (approved_at, artifact)."""
    base = {
        "approval_id":          "SYNTHETIC-V0-166A-199",
        "batch":                "SYNTHETIC",
        "record_type":          "correspondence",
        "subject_key":          "IPC:166A->BNS:199",
        "section_from":         "IPC:166A",
        "section_to":           "BNS:199",
        "content_hash":         _V0_HASH,
        "reviewer_id":          "callistus-moses-founder",
        "status":               "active",
        "revoked":              False,
        "revoked_at":           None,
        "approved_at":          "2026-10-31T00:00:00+00:00",
        "review_artifact_id":   "SYNTH-ART-V0-001",
        "review_artifact_digest": "sha256:000000000000000000000000000000000000000000000000000000000000cafe",
    }
    base.update(overrides)
    return base


def _make_v1_record(**overrides) -> dict:
    """Factory for a syntactically valid v1 (canonical-hash) correspondence record.
    Includes all active-approval required fields (approved_at, artifact)."""
    base = {
        "approval_id":          "SYNTHETIC-V1-166A-199",
        "batch":                "SYNTHETIC",
        "record_type":          "correspondence",
        "subject_key":          "IPC:166A->BNS:199",
        "section_from":         "IPC:166A",
        "section_to":           "BNS:199",
        "schema_version":       "v1",
        "content_hash":         _V1_HASH,
        "reviewer_id":          "callistus-moses-founder",
        "status":               "active",
        "revoked":              False,
        "revoked_at":           None,
        "approved_at":          "2026-10-31T00:00:00+00:00",
        "review_artifact_id":   "SYNTH-ART-V1-001",
        "review_artifact_digest": "sha256:000000000000000000000000000000000000000000000000000000000000cafe",
    }
    base.update(overrides)
    return base


# ─────────────────────────────────────────────────────────────────────────────
# Step 5 — compute_canonical_record_hash() unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestCanonicalRecordHash:
    """compute_canonical_record_hash binds the hash to all seven canonical fields.
    Any single-field change must produce a completely different hash.
    Missing required fields must raise ValueError (fail-closed)."""

    # ── Basic correctness ────────────────────────────────────────────────────

    def test_501_known_hash_value(self):
        """The IPC:166A→BNS:199 canonical hash must match the documented value."""
        result = compute_canonical_record_hash(_CANONICAL_166A_199)
        assert result == "1787743a993d9df1f94c1addad280016fc1b565781d8a790d51fb273068f16f8", (
            f"Known canonical hash drifted: {result}"
        )

    def test_502_deterministic(self):
        """Same input → same output on repeated calls."""
        h1 = compute_canonical_record_hash(_CANONICAL_166A_199)
        h2 = compute_canonical_record_hash(_CANONICAL_166A_199)
        assert h1 == h2, "Hash must be deterministic"

    def test_503_sort_keys_order_independent(self):
        """Dict insertion order must not affect the hash."""
        # Build the same canonical object in reverse field order
        reversed_obj = {k: _CANONICAL_166A_199[k] for k in reversed(list(_CANONICAL_166A_199))}
        assert compute_canonical_record_hash(reversed_obj) == compute_canonical_record_hash(_CANONICAL_166A_199), (
            "Hash must be order-independent (sort_keys=True)"
        )

    def test_504_returns_64_hex_chars(self):
        h = compute_canonical_record_hash(_CANONICAL_166A_199)
        assert len(h) == 64 and all(c in "0123456789abcdef" for c in h), (
            f"Expected 64 hex chars, got: {h!r}"
        )

    # ── Each field change invalidates the hash ───────────────────────────────

    def test_511_offence_text_change_invalidates(self):
        mutated = {**_CANONICAL_166A_199, "offence_text": "MUTATED offence text"}
        assert compute_canonical_record_hash(mutated) != _V1_HASH, (
            "Changing offence_text must change the hash"
        )

    def test_512_punishment_text_change_invalidates(self):
        mutated = {**_CANONICAL_166A_199, "punishment_text": "imprisonment up to one year"}
        assert compute_canonical_record_hash(mutated) != _V1_HASH, (
            "Changing punishment_text must change the hash"
        )

    def test_513_target_section_change_invalidates(self):
        mutated = {**_CANONICAL_166A_199, "target_section": "202"}
        assert compute_canonical_record_hash(mutated) != _V1_HASH, (
            "Changing target_section must change the hash"
        )

    def test_514_source_section_change_invalidates(self):
        mutated = {**_CANONICAL_166A_199, "source_section": "302"}
        assert compute_canonical_record_hash(mutated) != _V1_HASH, (
            "Changing source_section must change the hash"
        )

    def test_515_source_act_change_invalidates(self):
        mutated = {**_CANONICAL_166A_199, "source_act": "CrPC"}
        assert compute_canonical_record_hash(mutated) != _V1_HASH, (
            "Changing source_act must change the hash"
        )

    def test_516_target_act_change_invalidates(self):
        mutated = {**_CANONICAL_166A_199, "target_act": "BNSS"}
        assert compute_canonical_record_hash(mutated) != _V1_HASH, (
            "Changing target_act must change the hash"
        )

    # ── Missing required fields → ValueError (fail-closed) ──────────────────

    def test_521_missing_schema_version_raises(self):
        obj = {k: v for k, v in _CANONICAL_166A_199.items() if k != "schema_version"}
        import pytest
        with pytest.raises(ValueError, match="schema_version"):
            compute_canonical_record_hash(obj)

    def test_522_missing_offence_text_raises(self):
        obj = {k: v for k, v in _CANONICAL_166A_199.items() if k != "offence_text"}
        import pytest
        with pytest.raises(ValueError):
            compute_canonical_record_hash(obj)

    def test_523_missing_punishment_text_raises(self):
        obj = {k: v for k, v in _CANONICAL_166A_199.items() if k != "punishment_text"}
        import pytest
        with pytest.raises(ValueError):
            compute_canonical_record_hash(obj)

    def test_524_wrong_schema_version_raises(self):
        obj = {**_CANONICAL_166A_199, "schema_version": "v0"}
        import pytest
        with pytest.raises(ValueError, match="schema_version"):
            compute_canonical_record_hash(obj)

    def test_525_empty_dict_raises(self):
        import pytest
        with pytest.raises(ValueError):
            compute_canonical_record_hash({})


# ─────────────────────────────────────────────────────────────────────────────
# Step 6 — Fail-closed test matrix
# ─────────────────────────────────────────────────────────────────────────────

class TestFailClosedMatrix:
    """Every failure path must default to withheld (approved=False) without
    crashing. The exact reason string must also match so callers can log
    or surface the appropriate message."""

    # ── 601: Unauthorized reviewer ────────────────────────────────────────────

    def test_601_unknown_reviewer_with_allowlist_fails_closed(self):
        """UNKNOWN_REVIEWER must fail closed when an allowlist is supplied.

        P2 correction: the gate now enforces reviewer identity.  A record that
        carries a reviewer_id not present in the provided authorized_reviewers
        list must return 'unauthorized_reviewer', regardless of hash correctness.
        """
        rec = _make_v0_record(reviewer_id="UNKNOWN_REVIEWER")
        ar = [{"reviewer_id": "callistus-moses-founder", "status": "active", "revoked": False}]
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            registry=[rec],
            authorized_reviewers=ar,
        )
        assert result.approved is False, "UNKNOWN_REVIEWER must fail closed"
        assert result.reason == "unauthorized_reviewer", (
            f"Expected 'unauthorized_reviewer', got {result.reason!r}"
        )

    def test_601b_authorized_reviewer_with_correct_hash_approves(self):
        """A record with an authorized, active reviewer and correct hash must approve."""
        rec = _make_v0_record(reviewer_id="callistus-moses-founder")
        ar = [{"reviewer_id": "callistus-moses-founder", "status": "active", "revoked": False}]
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            registry=[rec],
            authorized_reviewers=ar,
        )
        assert result.approved is True, f"Authorized reviewer must approve: {result}"
        assert result.reason == "approved"

    def test_601c_backward_compat_no_allowlist_param_passes(self):
        """When registry is supplied without authorized_reviewers, reviewer check is
        SKIPPED for backward compatibility.  Pre-P2 callers continue to work."""
        rec = _make_v0_record(reviewer_id="any-string-here")
        # No authorized_reviewers param → reviewer check skipped
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            registry=[rec],
            # authorized_reviewers intentionally omitted
        )
        assert isinstance(result, ApprovalCheckResult), "Must return ApprovalCheckResult"
        # Reviewer check skipped → proceeds to hash check → approved
        assert result.approved is True, (
            f"Backward-compat mode (no AR param) should still approve on hash match: {result}"
        )

    # ── 602: Revoked approval (revoked_at set) ─────────────────────────────

    def test_602_revoked_at_set_fails_closed(self):
        rec = _make_v0_record(revoked_at="2026-10-30T00:00:00Z")
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199", registry=[rec]
        )
        assert result.approved is False, "revoked_at set must fail closed"
        assert result.reason == "revoked_approval", f"Expected 'revoked_approval', got {result.reason!r}"
    # ── 603: Revoked approval (status = "revoked") ─────────────────────────

    def test_603_status_revoked_fails_closed(self):
        rec = _make_v0_record(status="revoked")
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199", registry=[rec]
        )
        assert result.approved is False, "status='revoked' must fail closed"
        assert result.reason == "revoked_approval", f"Expected 'revoked_approval', got {result.reason!r}"
    # ── 604: v0 hash mismatch ─────────────────────────────────────────────

    def test_604_v0_hash_mismatch_fails_closed(self):
        """If the stored content_hash doesn't match SHA-256(subject_key), fail."""
        wrong_hash = "0" * 64   # deliberately wrong
        rec = _make_v0_record(content_hash=wrong_hash)
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199", registry=[rec]
        )
        assert result.approved is False, "Hash mismatch must fail closed"
        assert result.reason == "hash_mismatch", f"Expected 'hash_mismatch', got {result.reason!r}"

    # ── 605: v1 hash mismatch (field changed after hash was computed) ──────

    def test_605_v1_hash_mismatch_field_changed_fails_closed(self):
        """If a canonical record field is altered after the hash was stored, fail."""
        # Hash was computed with original offence_text; pass mutated canonical_record
        mutated_canonical = {**_CANONICAL_166A_199, "offence_text": "ALTERED TEXT"}
        rec = _make_v1_record()  # has hash for ORIGINAL canonical
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            canonical_record=mutated_canonical,
            registry=[rec],
        )
        assert result.approved is False, "Mutated field must cause hash mismatch"
        assert result.reason == "hash_mismatch", f"Expected 'hash_mismatch', got {result.reason!r}"

    # ── 606: Missing registry record ─────────────────────────────────────

    def test_606_missing_record_fails_closed(self):
        """An empty registry must always fail closed."""
        result = check_section_correspondence_approval(
            "IPC:302", "BNS:103", registry=[]
        )
        assert result.approved is False
        assert result.reason == "missing_approval"

    def test_606b_unknown_pair_with_populated_registry_fails_closed(self):
        """An unregistered pair must fail even when other pairs are in the registry."""
        rec = _make_v0_record()   # only covers IPC:166A→BNS:199
        result = check_section_correspondence_approval(
            "IPC:302", "BNS:103", registry=[rec]
        )
        assert result.approved is False
        assert result.reason == "missing_approval"

    # ── 607: Malformed — missing approval_id ─────────────────────────────

    def test_607_malformed_missing_approval_id_fails_closed(self):
        rec = _make_v0_record()
        del rec["approval_id"]
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199", registry=[rec]
        )
        assert result.approved is False
        assert result.reason == "malformed"

    # ── 608: Malformed — missing reviewer_id ─────────────────────────────

    def test_608_malformed_missing_reviewer_id_fails_closed(self):
        rec = _make_v0_record()
        del rec["reviewer_id"]
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199", registry=[rec]
        )
        assert result.approved is False
        assert result.reason == "malformed"

    # ── 609: v1 record present but canonical_record not passed → hash_mismatch

    def test_609_v1_record_no_canonical_record_fails_closed(self):
        """A v1 registry record REQUIRES canonical_record.
        Omitting it must fail closed with hash_mismatch, not crash."""
        rec = _make_v1_record()
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            canonical_record=None,   # explicitly NOT supplied
            registry=[rec],
        )
        assert result.approved is False, (
            "v1 record without canonical_record must fail closed"
        )
        assert result.reason == "hash_mismatch", (
            f"Expected 'hash_mismatch' (fail-closed), got {result.reason!r}"
        )

    # ── 610-612: v1 — each canonical field change invalidates approval ────

    def test_610_v1_offence_text_change_fails_closed(self):
        mutated = {**_CANONICAL_166A_199, "offence_text": "CHANGED TEXT"}
        rec = _make_v1_record()
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            canonical_record=mutated,
            registry=[rec],
        )
        assert result.approved is False
        assert result.reason == "hash_mismatch"

    def test_611_v1_punishment_text_change_fails_closed(self):
        mutated = {**_CANONICAL_166A_199, "punishment_text": "imprisonment for life"}
        rec = _make_v1_record()
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            canonical_record=mutated,
            registry=[rec],
        )
        assert result.approved is False
        assert result.reason == "hash_mismatch"

    def test_612_v1_target_section_change_fails_closed(self):
        mutated = {**_CANONICAL_166A_199, "target_section": "202"}
        rec = _make_v1_record()
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            canonical_record=mutated,
            registry=[rec],
        )
        assert result.approved is False
        assert result.reason == "hash_mismatch"

    # ── Gate return type: never crashes, always returns ApprovalCheckResult

    def test_613_empty_string_section_does_not_crash(self):
        result = check_section_correspondence_approval("", "", registry=[])
        assert isinstance(result, ApprovalCheckResult)
        assert result.approved is False

    def test_614_corrupt_registry_list_does_not_crash(self):
        """Non-dict entries in the registry list must be skipped silently."""
        corrupt_registry = [None, 42, "string", {}, _make_v0_record()]
        result = check_section_correspondence_approval(
            "IPC:166A", "BNS:199", registry=corrupt_registry
        )
        # The valid record is present → should approve
        assert isinstance(result, ApprovalCheckResult)


# ─────────────────────────────────────────────────────────────────────────────
# Step 6 — Structural withholding API integration contract
# ─────────────────────────────────────────────────────────────────────────────

class TestStructuralWithholdingContract:
    """The /api/advocate/cross-reference endpoint MUST null out all substantive
    BNS mapping fields when correspondence_approval != 'approved'.

    These tests use the server module's _xref_search() directly so they run
    without a live HTTP server.  They verify the data contract that ensures
    NotYetApprovedBanner and non-null new_section are mutually exclusive."""

    @classmethod
    def setup_class(cls):
        import server as _srv
        from engine.approval_evidence import _load_registry_data
        _load_registry_data.cache_clear()  # ensure tests see current registry state
        cls.srv = _srv

    def _get_302_result(self):
        results = self.srv._xref_search(ipc="302")
        matching = [r for r in results if r.get("old_section") == "302"]
        assert matching, "IPC:302 must be in the cross-reference data for this test"
        return matching[0]

    def _get_166a_result(self):
        results = self.srv._xref_search(ipc="166A")
        matching = [r for r in results if r.get("old_section") == "166A"]
        assert matching, "IPC:166A must be in the cross-reference data for this test"
        return matching[0]

    # ── IPC:302 (unapproved) — all substantive fields must be None ─────────

    def test_701_ipc302_new_section_is_null(self):
        r = self._get_302_result()
        assert r.get("new_section") is None, (
            f"Unapproved pair IPC:302 must have new_section=null, "
            f"got: {r.get('new_section')!r}"
        )

    def test_702_ipc302_offence_is_null(self):
        r = self._get_302_result()
        assert r.get("offence") is None, (
            f"Unapproved pair IPC:302 must have offence=null, "
            f"got: {r.get('offence')!r}"
        )

    def test_703_ipc302_what_changed_is_null(self):
        r = self._get_302_result()
        assert r.get("what_changed") is None, (
            f"Unapproved pair IPC:302 must have what_changed=null, "
            f"got: {r.get('what_changed')!r}"
        )

    def test_704_ipc302_source_link_is_null(self):
        r = self._get_302_result()
        assert r.get("source_link") is None, (
            f"Unapproved pair IPC:302 must have source_link=null, "
            f"got: {r.get('source_link')!r}"
        )

    def test_705_ipc302_review_status_is_withheld(self):
        r = self._get_302_result()
        assert r.get("review_status") == "withheld_pending_approval", (
            f"Unapproved pair IPC:302 must have review_status='withheld_pending_approval', "
            f"got: {r.get('review_status')!r}"
        )

    def test_705b_ipc302_judicial_citation_is_null(self):
        r = self._get_302_result()
        assert r.get("judicial_citation") is None, (
            f"Unapproved pair IPC:302 must have judicial_citation=null"
        )

    def test_705c_ipc302_mapping_version_is_null(self):
        r = self._get_302_result()
        assert r.get("mapping_version") is None, (
            f"Unapproved pair IPC:302 must have mapping_version=null"
        )

    def test_705d_ipc302_review_source_is_null(self):
        r = self._get_302_result()
        assert r.get("review_source") is None, (
            f"Unapproved pair IPC:302 must have review_source=null"
        )

    # ── IPC:166A (pending_human_review since P2 correction) ─────────────────
    # REGISTRY-001-v1 status changed to pending_human_review (commit 5709957).
    # The gate now returns 'revoked' (status != 'active'), so IPC:166A is
    # structurally withheld identically to any other unapproved pair.

    def test_706_ipc166a_new_section_is_withheld(self):
        """P2 correction: REGISTRY-001-v1 is pending_human_review.
        IPC:166A new_section must be null (withheld) until real human review."""
        r = self._get_166a_result()
        assert r.get("new_section") is None, (
            f"Pending pair IPC:166A must have new_section=null (withheld), "
            f"got: {r.get('new_section')!r}"
        )

    def test_707_ipc166a_offence_is_withheld(self):
        """P2 correction: IPC:166A offence text must be withheld."""
        r = self._get_166a_result()
        assert r.get("offence") is None, (
            f"Pending pair IPC:166A must have offence=null (withheld), "
            f"got: {r.get('offence')!r}"
        )

    def test_708_correspondence_approval_field_correct_on_both(self):
        r302  = self._get_302_result()
        r166a = self._get_166a_result()
        assert "correspondence_approval" in r302, "IPC:302 result must have correspondence_approval field"
        assert "correspondence_approval" in r166a, "IPC:166A result must have correspondence_approval field"
        assert r302["correspondence_approval"] == "missing_approval", (
            f"IPC:302 must have missing_approval, got {r302['correspondence_approval']!r}"
        )
        # IPC:166A: REGISTRY-001-v1 status = pending_human_review → gate returns "revoked"
        assert r166a["correspondence_approval"] == "pending_human_review", (
            f"IPC:166A must have 'pending_human_review' (pending status), "
            f"got {r166a['correspondence_approval']!r}"
        )

    # ── CONTRACT: NotYetApprovedBanner ↔ non-null new_section are mutually exclusive

    def test_709_contract_banner_exclusive_with_nonnull_new_section(self):
        """The contract invariant: if correspondence_approval != 'approved' (banner condition),
        then new_section MUST be null.  They can never coexist in the same result dict."""
        all_results = self.srv._xref_search(q="murder") + self.srv._xref_search(ipc="302") + \
                      self.srv._xref_search(ipc="166A") + self.srv._xref_search(ipc="420")
        for r in all_results:
            corr = r.get("correspondence_approval")
            new_sec = r.get("new_section")
            if corr and corr not in ("approved", "no_section"):
                # Banner condition: unapproved — new_section MUST be None
                assert new_sec is None, (
                    f"Contract violated: correspondence_approval={corr!r} "
                    f"but new_section={new_sec!r} (non-null).  "
                    f"NotYetApprovedBanner would coexist with leaked BNS section number. "
                    f"old_section={r.get('old_section')!r}"
                )

    def test_710_contract_withheld_pair_has_null_new_section(self):
        """P2 update: IPC:166A is now pending_human_review (withheld).
        Verify the contract: correspondence_approval != 'approved' → new_section null."""
        r = self._get_166a_result()
        corr = r.get("correspondence_approval")
        new_sec = r.get("new_section")
        assert corr != "approved", (
            f"IPC:166A must not be approved (REGISTRY-001-v1 is pending_human_review), got {corr!r}"
        )
        assert new_sec is None, (
            f"Withheld IPC:166A must have new_section=null, got {new_sec!r}"
        )

    # ── v1 hash backward-compat: REGISTRY-001-v1 now pending_human_review ────

    def test_711_registry001_v1_is_pending_not_approved(self):
        """P2 correction: REGISTRY-001-v1 status is now pending_human_review.
        The gate must return approved=False until a human review is completed
        out-of-band and the status is changed to 'active' with a valid approved_at."""
        from engine.approval_evidence import check_section_correspondence_approval as _gate, _load_registry_data
        _load_registry_data.cache_clear()  # ensure fresh load after registry change
        canonical = {
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
        result = _gate("IPC:166A", "BNS:199", canonical_record=canonical)
        assert result.approved is False, (
            f"REGISTRY-001-v1 (pending_human_review) must NOT approve: {result}"
        )
        assert result.reason == "pending_human_review", (
            f"Expected reason='pending_human_review' (status != active), got {result.reason!r}"
        )
