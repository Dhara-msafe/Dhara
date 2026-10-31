"""
DHARA P2 — Approval Gate Integrity Test Suite

Tests the reviewer-identity gate introduced in the P2 correction.
Complements test_p1_step5_step6_correction.py (hash / revoked / malformed paths).

Test IDs
--------
A01 — active authorized reviewer, correct hash          → approved
A02 — UNKNOWN_REVIEWER (not in allowlist)               → unauthorized_reviewer
A03 — reviewer absent from allowlist                    → unauthorized_reviewer
A04 — inactive reviewer (status != 'active')            → unauthorized_reviewer
A05 — revoked reviewer (revoked=True)                   → unauthorized_reviewer
A06 — revoked reviewer (status='revoked')               → unauthorized_reviewer
A07 — empty allowlist                                    → unauthorized_reviewer
A08 — allowlist with only malformed entries              → unauthorized_reviewer
A09 — duplicate reviewer entries                         → unauthorized_reviewer
A10 — active approval with inactive reviewer             → unauthorized_reviewer
A11 — active approval with revoked reviewer              → unauthorized_reviewer
A12 — pending_human_review status (correct hash+AR)     → revoked
A13 — revoked approval (authorized reviewer)             → revoked
A14 — correct v1 hash + authorized reviewer              → approved
A15 — incorrect v1 hash + authorized reviewer            → hash_mismatch
A16 — _load_registry_data load_error path               → unauthorized_reviewer

Structural withholding (REGISTRY-001-v1 is pending_human_review):
A17 — IPC:166A new_section withheld (null) via _xref_search
A18 — IPC:166A offence withheld (null)
A19 — IPC:166A what_changed withheld (null)
A20 — IPC:166A review_status = 'withheld_pending_approval'
A21 — IPC:166A correspondence_approval = 'revoked' (not 'approved')
A22 — contract: no pair with non-approved correspondence leaks new_section
A23 — _is_reviewer_authorized unit tests

For each failed case the cross-reference API withholds new_section, offence,
what_changed, punishment (what_changed), judicial_citation, source_link and
successor fields — verified via tests A17-A22.
"""
from __future__ import annotations

import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import hashlib
import json
import unittest.mock as mock

import pytest

from engine.approval_evidence import (  # noqa: E402
    ApprovalCheckResult,
    RegistryData,
    _is_reviewer_authorized,
    _load_registry_data,
    check_section_correspondence_approval,
    compute_canonical_record_hash,
    compute_content_hash,
)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers — synthetic records and authorised-reviewer lists
# ─────────────────────────────────────────────────────────────────────────────

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
_V0_HASH = compute_content_hash("IPC:166A->BNS:199")
_V1_HASH = compute_canonical_record_hash(_CANONICAL_166A_199)

_ACTIVE_REVIEWER = {
    "reviewer_id": "callistus-moses-founder",
    "name": "Callistus Moses",
    "role": "founder-ceo",
    "status": "active",
    "revoked": False,
}

_INACTIVE_REVIEWER = {**_ACTIVE_REVIEWER, "status": "inactive"}
_REVOKED_REVIEWER  = {**_ACTIVE_REVIEWER, "revoked": True}
_STATUS_REVOKED_REVIEWER = {**_ACTIVE_REVIEWER, "status": "revoked"}


def _base_v0_rec(**overrides) -> dict:
    base = {
        "approval_id":  "SYNTH-V0",
        "batch":        "SYNTH",
        "record_type":  "correspondence",
        "subject_key":  "IPC:166A->BNS:199",
        "section_from": "IPC:166A",
        "section_to":   "BNS:199",
        "content_hash": _V0_HASH,
        "reviewer_id":  "callistus-moses-founder",
        "status":       "active",
        "revoked":      False,
        "revoked_at":   None,
    }
    base.update(overrides)
    return base


def _base_v1_rec(**overrides) -> dict:
    base = {
        "approval_id":    "SYNTH-V1",
        "batch":          "SYNTH",
        "record_type":    "correspondence",
        "subject_key":    "IPC:166A->BNS:199",
        "section_from":   "IPC:166A",
        "section_to":     "BNS:199",
        "schema_version": "v1",
        "content_hash":   _V1_HASH,
        "reviewer_id":    "callistus-moses-founder",
        "status":         "active",
        "revoked":        False,
        "revoked_at":     None,
    }
    base.update(overrides)
    return base


def _gate(rec, ar, **kwargs):
    """Shorthand: call check_section_correspondence_approval with synthetic data."""
    return check_section_correspondence_approval(
        "IPC:166A", "BNS:199",
        registry=[rec],
        authorized_reviewers=ar,
        **kwargs,
    )


# ─────────────────────────────────────────────────────────────────────────────
# A01-A16 — Reviewer identity gate
# ─────────────────────────────────────────────────────────────────────────────

class TestReviewerIdentityGate:
    """All reviewer-identity-related fail-closed and pass paths."""

    # ── A01: authorized, active reviewer + correct hash → approved ────────

    def test_A01_authorized_active_reviewer_approves(self):
        """Active authorized reviewer with correct hash must approve."""
        r = _gate(_base_v0_rec(), [_ACTIVE_REVIEWER])
        assert r.approved is True, f"A01: expected approved, got {r}"
        assert r.reason == "approved"
        assert r.reviewer_id == "callistus-moses-founder"

    # ── A02: UNKNOWN_REVIEWER → unauthorized_reviewer ─────────────────────

    def test_A02_UNKNOWN_REVIEWER_fails_closed(self):
        """reviewer_id='UNKNOWN_REVIEWER' must fail with unauthorized_reviewer."""
        r = _gate(_base_v0_rec(reviewer_id="UNKNOWN_REVIEWER"), [_ACTIVE_REVIEWER])
        assert r.approved is False, "A02: UNKNOWN_REVIEWER must fail closed"
        assert r.reason == "unauthorized_reviewer", (
            f"A02: expected 'unauthorized_reviewer', got {r.reason!r}"
        )

    # ── A03: reviewer absent from allowlist ───────────────────────────────

    def test_A03_reviewer_absent_from_allowlist_fails_closed(self):
        """A reviewer_id present in the record but absent from the allowlist fails."""
        other_ar = [{"reviewer_id": "someone-else", "status": "active", "revoked": False}]
        r = _gate(_base_v0_rec(), other_ar)
        assert r.approved is False, "A03: reviewer not in allowlist must fail"
        assert r.reason == "unauthorized_reviewer"

    # ── A04: inactive reviewer ────────────────────────────────────────────

    def test_A04_inactive_reviewer_fails_closed(self):
        """A reviewer whose status != 'active' must fail."""
        r = _gate(_base_v0_rec(), [_INACTIVE_REVIEWER])
        assert r.approved is False, "A04: inactive reviewer must fail closed"
        assert r.reason == "unauthorized_reviewer"

    # ── A05: revoked reviewer (revoked=True) ──────────────────────────────

    def test_A05_revoked_reviewer_bool_fails_closed(self):
        """A reviewer with revoked=True must fail."""
        r = _gate(_base_v0_rec(), [_REVOKED_REVIEWER])
        assert r.approved is False, "A05: revoked reviewer must fail closed"
        assert r.reason == "unauthorized_reviewer"

    # ── A06: revoked reviewer (status='revoked') ──────────────────────────

    def test_A06_revoked_reviewer_status_fails_closed(self):
        """A reviewer with status='revoked' must fail."""
        r = _gate(_base_v0_rec(), [_STATUS_REVOKED_REVIEWER])
        assert r.approved is False, "A06: reviewer status=revoked must fail"
        assert r.reason == "unauthorized_reviewer"

    # ── A07: empty allowlist → unauthorized_reviewer ──────────────────────

    def test_A07_empty_allowlist_fails_closed(self):
        """An empty authorized_reviewers list must fail closed (no reviewer can authorize)."""
        r = _gate(_base_v0_rec(), [])  # explicitly empty
        assert r.approved is False, "A07: empty allowlist must fail closed"
        assert r.reason == "unauthorized_reviewer"

    # ── A08: allowlist with only malformed entries ────────────────────────

    def test_A08_malformed_allowlist_entries_fail_closed(self):
        """Non-dict entries in the allowlist are skipped; if none match, fail closed."""
        r = _gate(_base_v0_rec(), [None, 42, "string", {"no_reviewer_id": True}])
        assert r.approved is False, "A08: malformed allowlist entries must fail closed"
        assert r.reason == "unauthorized_reviewer"

    # ── A09: duplicate reviewer entries → ambiguous → fail closed ────────

    def test_A09_duplicate_reviewer_id_fails_closed(self):
        """Two entries with the same reviewer_id → ambiguous → unauthorized_reviewer."""
        duplicate_ar = [_ACTIVE_REVIEWER, {**_ACTIVE_REVIEWER}]  # two identical
        r = _gate(_base_v0_rec(), duplicate_ar)
        assert r.approved is False, "A09: duplicate reviewer entries must fail closed"
        assert r.reason == "unauthorized_reviewer"

    # ── A10: active approval + inactive reviewer → unauthorized_reviewer ──

    def test_A10_active_approval_inactive_reviewer_fails_closed(self):
        """Active approval record but inactive reviewer must fail."""
        r = _gate(_base_v0_rec(status="active"), [_INACTIVE_REVIEWER])
        assert r.approved is False, "A10: active approval + inactive reviewer must fail"
        assert r.reason == "unauthorized_reviewer"

    # ── A11: active approval + revoked reviewer → unauthorized_reviewer ───

    def test_A11_active_approval_revoked_reviewer_fails_closed(self):
        """Active approval record but revoked reviewer must fail."""
        r = _gate(_base_v0_rec(status="active"), [_REVOKED_REVIEWER])
        assert r.approved is False, "A11: active approval + revoked reviewer must fail"
        assert r.reason == "unauthorized_reviewer"

    # ── A12: pending status → revoked ─────────────────────────────────────

    def test_A12_pending_human_review_status_fails_closed(self):
        """An approval with status='pending_human_review' must fail closed."""
        r = _gate(_base_v0_rec(status="pending_human_review"), [_ACTIVE_REVIEWER])
        assert r.approved is False, "A12: pending_human_review must fail closed"
        assert r.reason == "revoked", (
            f"A12: expected 'revoked' (status != active), got {r.reason!r}"
        )

    # ── A13: revoked approval (authorized reviewer) → revoked ─────────────

    def test_A13_revoked_approval_authorized_reviewer_fails_closed(self):
        """Even an authorized reviewer's approval that is revoked must fail."""
        r = _gate(_base_v0_rec(status="revoked"), [_ACTIVE_REVIEWER])
        assert r.approved is False, "A13: revoked approval must fail"
        assert r.reason == "revoked"

    # ── A14: correct v1 hash + authorized reviewer → approved ─────────────

    def test_A14_correct_v1_hash_authorized_reviewer_approves(self):
        """A v1 approval with correct canonical hash and authorized reviewer must approve."""
        r = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            canonical_record=_CANONICAL_166A_199,
            registry=[_base_v1_rec()],
            authorized_reviewers=[_ACTIVE_REVIEWER],
        )
        assert r.approved is True, f"A14: v1 correct hash + authorized reviewer must approve: {r}"
        assert r.reason == "approved"

    # ── A15: incorrect v1 hash + authorized reviewer → hash_mismatch ──────

    def test_A15_incorrect_v1_hash_authorized_reviewer_fails_closed(self):
        """A v1 approval with wrong canonical hash fails with hash_mismatch."""
        mutated = {**_CANONICAL_166A_199, "offence_text": "ALTERED TEXT"}
        r = check_section_correspondence_approval(
            "IPC:166A", "BNS:199",
            canonical_record=mutated,
            registry=[_base_v1_rec()],  # stored hash is for ORIGINAL canonical
            authorized_reviewers=[_ACTIVE_REVIEWER],
        )
        assert r.approved is False, "A15: hash mismatch must fail closed"
        assert r.reason == "hash_mismatch", (
            f"A15: expected 'hash_mismatch', got {r.reason!r}"
        )

    # ── A16: registry load_error path → unauthorized_reviewer ─────────────

    def test_A16_registry_load_error_fails_closed(self, monkeypatch):
        """When _load_registry_data() returns a load_error, all checks fail closed."""
        bad_data = RegistryData(
            approvals=[], authorized_reviewers=[], load_error="simulated I/O failure"
        )
        _load_registry_data.cache_clear()
        monkeypatch.setattr(
            "engine.approval_evidence._load_registry_data",
            lambda: bad_data,
        )
        # Call WITHOUT registry override so production path is used
        r = check_section_correspondence_approval("IPC:166A", "BNS:199")
        assert r.approved is False, "A16: load_error must fail closed"
        assert r.reason == "unauthorized_reviewer", (
            f"A16: expected 'unauthorized_reviewer', got {r.reason!r}"
        )
        _load_registry_data.cache_clear()  # restore for subsequent tests


# ─────────────────────────────────────────────────────────────────────────────
# A17-A22 — Structural withholding after REGISTRY-001-v1 marked pending
# ─────────────────────────────────────────────────────────────────────────────

class TestStructuralWithholdingPending:
    """IPC:166A is pending_human_review.  All substantive fields must be null."""

    @classmethod
    def setup_class(cls):
        import server as _srv
        from engine.approval_evidence import _load_registry_data
        _load_registry_data.cache_clear()
        cls.srv = _srv

    def _166a(self):
        results = self.srv._xref_search(ipc="166A")
        matching = [r for r in results if r.get("old_section") == "166A"]
        assert matching, "IPC:166A must be present in the mapping data"
        return matching[0]

    def test_A17_ipc166a_new_section_withheld(self):
        """A17: IPC:166A new_section must be null (pending_human_review)."""
        r = self._166a()
        assert r.get("new_section") is None, (
            f"A17: IPC:166A new_section must be null (withheld), got {r.get('new_section')!r}"
        )

    def test_A18_ipc166a_offence_withheld(self):
        """A18: IPC:166A offence must be null."""
        r = self._166a()
        assert r.get("offence") is None, (
            f"A18: IPC:166A offence must be null (withheld), got {r.get('offence')!r}"
        )

    def test_A19_ipc166a_what_changed_withheld(self):
        """A19: IPC:166A what_changed (punishment/correction text) must be null."""
        r = self._166a()
        assert r.get("what_changed") is None, (
            f"A19: IPC:166A what_changed must be null (withheld), got {r.get('what_changed')!r}"
        )

    def test_A20_ipc166a_review_status_withheld_label(self):
        """A20: review_status must be 'withheld_pending_approval', not the raw status."""
        r = self._166a()
        assert r.get("review_status") == "withheld_pending_approval", (
            f"A20: expected 'withheld_pending_approval', got {r.get('review_status')!r}"
        )

    def test_A21_ipc166a_correspondence_approval_is_revoked(self):
        """A21: correspondence_approval must be 'revoked' (status=pending_human_review)."""
        r = self._166a()
        ca = r.get("correspondence_approval")
        assert ca == "revoked", (
            f"A21: expected 'revoked', got {ca!r}"
        )

    def test_A22_contract_no_unapproved_pair_leaks_new_section(self):
        """A22: For every result across common queries, if correspondence_approval is
        not 'approved', new_section MUST be null.  A failure label alongside
        disclosed section data is a test failure."""
        all_results = (
            self.srv._xref_search(ipc="302") +
            self.srv._xref_search(ipc="166A") +
            self.srv._xref_search(ipc="420") +
            self.srv._xref_search(q="murder") +
            self.srv._xref_search(q="public servant")
        )
        violations = []
        for r in all_results:
            corr = r.get("correspondence_approval")
            new_sec = r.get("new_section")
            if corr and corr not in ("approved", "no_section"):
                if new_sec is not None:
                    violations.append(
                        f"old_section={r.get('old_section')!r} "
                        f"correspondence_approval={corr!r} "
                        f"new_section={new_sec!r} (LEAKED)"
                    )
        assert not violations, (
            f"A22: Contract violated — {len(violations)} result(s) disclose new_section "
            f"alongside a non-approved correspondence_approval:\n" +
            "\n".join(violations)
        )

    def test_A22b_judicial_citation_withheld_for_ipc166a(self):
        r = self._166a()
        assert r.get("judicial_citation") is None, (
            f"A22b: judicial_citation must be withheld, got {r.get('judicial_citation')!r}"
        )

    def test_A22c_source_link_withheld_for_ipc166a(self):
        r = self._166a()
        assert r.get("source_link") is None, (
            f"A22c: source_link must be withheld, got {r.get('source_link')!r}"
        )

    def test_A22d_new_subsection_withheld_for_ipc166a(self):
        r = self._166a()
        assert r.get("new_subsection") is None, (
            f"A22d: new_subsection must be withheld, got {r.get('new_subsection')!r}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# A23 — _is_reviewer_authorized unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestIsReviewerAuthorized:
    """Unit tests for the _is_reviewer_authorized helper."""

    def test_A23a_empty_reviewer_id_fails(self):
        assert _is_reviewer_authorized("", [_ACTIVE_REVIEWER]) is False

    def test_A23b_none_reviewer_id_fails(self):
        assert _is_reviewer_authorized(None, [_ACTIVE_REVIEWER]) is False

    def test_A23c_empty_allowlist_fails(self):
        assert _is_reviewer_authorized("callistus-moses-founder", []) is False

    def test_A23d_none_allowlist_fails(self):
        # _is_reviewer_authorized only receives lists; None not a list
        # Verify it doesn't crash on non-iterable — wrap defensively
        try:
            result = _is_reviewer_authorized("callistus-moses-founder", None)
            assert result is False, "None allowlist must fail closed"
        except TypeError:
            pass  # also acceptable — no crash that returns True

    def test_A23e_unknown_reviewer_fails(self):
        assert _is_reviewer_authorized("nobody", [_ACTIVE_REVIEWER]) is False

    def test_A23f_active_authorized_reviewer_passes(self):
        assert _is_reviewer_authorized("callistus-moses-founder", [_ACTIVE_REVIEWER]) is True

    def test_A23g_inactive_reviewer_fails(self):
        assert _is_reviewer_authorized("callistus-moses-founder", [_INACTIVE_REVIEWER]) is False

    def test_A23h_revoked_reviewer_bool_fails(self):
        assert _is_reviewer_authorized("callistus-moses-founder", [_REVOKED_REVIEWER]) is False

    def test_A23i_revoked_reviewer_status_fails(self):
        assert _is_reviewer_authorized("callistus-moses-founder", [_STATUS_REVOKED_REVIEWER]) is False

    def test_A23j_duplicate_entries_fail(self):
        dupes = [_ACTIVE_REVIEWER, {**_ACTIVE_REVIEWER}]
        assert _is_reviewer_authorized("callistus-moses-founder", dupes) is False

    def test_A23k_malformed_allowlist_entries_skipped(self):
        mixed = [None, 42, "string", _ACTIVE_REVIEWER]
        assert _is_reviewer_authorized("callistus-moses-founder", mixed) is True
