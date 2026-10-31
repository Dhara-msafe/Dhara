"""
DHARA P1 — BNS §199 / IPC §166A punishment fidelity test suite.

Phase 5 of the GO — DHARA P1 legal-release containment command.

These tests assert that every output surface that may name BNS §199 or
IPC §166A punishment text reproduces all four approved field values exactly
as recorded in REGISTRY-001-IPC166A-BNS199:

  imprisonment_type = rigorous   (never "simple", never "jail")
  minimum_term      = six months (mandatory minimum — must not be omitted)
  maximum_term      = two years  (upper bound)
  fine_mandatory    = True       (fine is AND, not "or both")

Approved canonical text (REGISTRY-001):
  "Rigorous imprisonment of at least six months and up to two years, and fine"

All tests are pure unit tests — no DB, no network, no live server.
Nothing here creates or modifies any real approval record.
"""
from __future__ import annotations

import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from engine.answer_generator import (   # noqa: E402
    _bns_199_fields_satisfied,
    correct_punishment_mismatch,
    _BNS_199_APPROVED_TEXT,
    _BNS_199_FIELDS,
)

# ── Shared test fixtures ───────────────────────────────────────────────────────

_HIT_BNS_199  = {"section_number": "199",  "act_name": "Bharatiya Nyaya Sanhita"}
_HIT_IPC_166A = {"section_number": "166A", "act_name": "Indian Penal Code"}
_HIT_OTHER    = {"section_number": "302",  "act_name": "Bharatiya Nyaya Sanhita"}


# ─────────────────────────────────────────────────────────────────────────────
# 1. Registry-sourced field constants — ensure the module's hardcoded values
#    match the canonical approved text. A drift here would mean the post-
#    processor substitutes a DIFFERENT string than what the registry approved.
# ─────────────────────────────────────────────────────────────────────────────

class TestApprovedTextConstants:
    """The hardcoded punishment constants in answer_generator.py must be
    consistent with the approved text from REGISTRY-001."""

    def test_approved_text_contains_rigorous(self):
        assert "rigorous" in _BNS_199_APPROVED_TEXT.lower(), (
            f"Approved text missing 'rigorous': {_BNS_199_APPROVED_TEXT}"
        )

    def test_approved_text_contains_six_months(self):
        assert "six months" in _BNS_199_APPROVED_TEXT.lower(), (
            f"Approved text missing mandatory minimum 'six months': {_BNS_199_APPROVED_TEXT}"
        )

    def test_approved_text_contains_two_years(self):
        assert "two years" in _BNS_199_APPROVED_TEXT.lower(), (
            f"Approved text missing maximum 'two years': {_BNS_199_APPROVED_TEXT}"
        )

    def test_approved_text_contains_fine(self):
        assert "fine" in _BNS_199_APPROVED_TEXT.lower(), (
            f"Approved text missing mandatory 'fine': {_BNS_199_APPROVED_TEXT}"
        )

    def test_approved_text_does_not_contain_jail(self):
        assert "jail" not in _BNS_199_APPROVED_TEXT.lower(), (
            f"Approved text must not contain 'jail' (use 'rigorous imprisonment'): {_BNS_199_APPROVED_TEXT}"
        )

    def test_approved_text_does_not_say_or_both(self):
        assert "or both" not in _BNS_199_APPROVED_TEXT.lower(), (
            f"Approved text must not say 'or both' — fine is mandatory AND: {_BNS_199_APPROVED_TEXT}"
        )

    def test_fields_dict_imprisonment_type_is_rigorous(self):
        assert _BNS_199_FIELDS["imprisonment_type"] == "rigorous", (
            "imprisonment_type must be 'rigorous', not 'simple' or any other value"
        )

    def test_fields_dict_fine_is_mandatory(self):
        assert _BNS_199_FIELDS["fine_mandatory"] is True, (
            "fine_mandatory must be True — fine is AND, not optional"
        )

    def test_fields_dict_minimum_term_is_six_months(self):
        assert _BNS_199_FIELDS["minimum_term"] == "six months"

    def test_fields_dict_maximum_term_is_two_years(self):
        assert _BNS_199_FIELDS["maximum_term"] == "two years"


# ─────────────────────────────────────────────────────────────────────────────
# 2. _bns_199_fields_satisfied — structural field-presence predicates
# ─────────────────────────────────────────────────────────────────────────────

class TestBns199FieldsSatisfied:
    """Each of the four approved fields is individually necessary.
    The disqualifiers must each independently block an otherwise-passing text."""

    # ── Approved canonical text passes ───────────────────────────────────────

    def test_canonical_approved_text_passes(self):
        assert _bns_199_fields_satisfied(_BNS_199_APPROVED_TEXT) is True, (
            f"Canonical approved text failed its own field check: {_BNS_199_APPROVED_TEXT}"
        )

    # ── Each required field is individually necessary ────────────────────────

    def test_missing_rigorous_fails(self):
        text = "imprisonment of at least six months and up to two years, and fine"
        assert _bns_199_fields_satisfied(text) is False, (
            "Text without 'rigorous' must fail"
        )

    def test_missing_six_months_fails(self):
        text = "rigorous imprisonment up to two years and fine"
        assert _bns_199_fields_satisfied(text) is False, (
            "Text without mandatory minimum 'six months' must fail"
        )

    def test_missing_two_years_fails(self):
        text = "rigorous imprisonment of at least six months and fine"
        assert _bns_199_fields_satisfied(text) is False, (
            "Text without maximum 'two years' must fail"
        )

    def test_missing_fine_fails(self):
        text = "rigorous imprisonment of at least six months and up to two years"
        assert _bns_199_fields_satisfied(text) is False, (
            "Text without mandatory 'fine' must fail"
        )

    # ── Each disqualifier is individually sufficient to fail ─────────────────

    def test_disqualifier_jail_fails(self):
        text = "rigorous jail term of at least six months and up to two years, and fine"
        assert _bns_199_fields_satisfied(text) is False, (
            "Presence of 'jail' must disqualify even when other fields present"
        )

    def test_disqualifier_or_both_fails(self):
        text = "rigorous imprisonment of at least six months and up to two years, fine or both"
        assert _bns_199_fields_satisfied(text) is False, (
            "Presence of 'or both' after fine must disqualify (fine is mandatory AND)"
        )

    # ── All field variants that must also satisfy ────────────────────────────

    def test_alternate_casing_passes(self):
        text = "RIGOROUS IMPRISONMENT OF AT LEAST SIX MONTHS AND UP TO TWO YEARS, AND FINE"
        assert _bns_199_fields_satisfied(text) is True, (
            "All-caps approved text must pass (predicates are case-insensitive)"
        )

    def test_empty_string_fails(self):
        assert _bns_199_fields_satisfied("") is False


# ─────────────────────────────────────────────────────────────────────────────
# 3. correct_punishment_mismatch — exact output assertions
# ─────────────────────────────────────────────────────────────────────────────

class TestCorrectPunishmentMismatchExactOutput:
    """The post-processor must produce the canonical approved text (or text
    that satisfies all four structural fields) for every known wrong form.
    Tests 3xx complement TestCorrectPunishmentMismatch in test_layer_m_golden.py
    with additional assertions on the EXACT output string where possible."""

    # ── The canonical approved text always survives unchanged ────────────────

    def test_301_canonical_text_is_unchanged(self):
        result = correct_punishment_mismatch(_BNS_199_APPROVED_TEXT, [_HIT_BNS_199])
        assert result == _BNS_199_APPROVED_TEXT, (
            f"Canonical approved text was altered: before={_BNS_199_APPROVED_TEXT!r}, "
            f"after={result!r}"
        )

    # ── All four fields satisfied after correction ────────────────────────────

    def test_302_p1_one_year_confusion_all_fields_satisfied(self):
        wrong  = "up to one year's rigorous imprisonment, or fine, or both"
        result = correct_punishment_mismatch(wrong, [_HIT_BNS_199])
        assert _bns_199_fields_satisfied(result), (
            f"After P1 one-year correction, fields not all satisfied: {result}"
        )

    def test_303_p2_jail_or_both_all_fields_satisfied(self):
        wrong  = "up to two years in jail, a fine, or both"
        result = correct_punishment_mismatch(wrong, [_HIT_BNS_199])
        assert _bns_199_fields_satisfied(result), (
            f"After P2 jail/or-both correction, fields not all satisfied: {result}"
        )

    def test_304_p2_ipc_166a_hit_all_fields_satisfied(self):
        wrong  = "up to two years in jail, a fine, or both"
        result = correct_punishment_mismatch(wrong, [_HIT_IPC_166A])
        assert _bns_199_fields_satisfied(result), (
            f"After correction via IPC 166A hit, fields not all satisfied: {result}"
        )

    # ── Specific disqualifiers confirmed absent after correction ──────────────

    def test_305_jail_absent_after_correction(self):
        wrong  = "jail for up to two years and fine or both"
        result = correct_punishment_mismatch(wrong, [_HIT_BNS_199])
        assert "jail" not in result.lower(), f"'jail' still present: {result}"

    def test_306_or_both_absent_after_correction(self):
        wrong  = "rigorous imprisonment of at least six months and up to two years, fine or both"
        result = correct_punishment_mismatch(wrong, [_HIT_BNS_199])
        assert "or both" not in result.lower(), f"'or both' still present: {result}"

    def test_307_six_months_present_after_correction(self):
        """The mandatory minimum must never be absent from the corrected output."""
        wrong  = "rigorous imprisonment up to two years and fine"
        result = correct_punishment_mismatch(wrong, [_HIT_BNS_199])
        assert "six months" in result.lower(), (
            f"Mandatory minimum 'six months' absent after correction: {result}"
        )

    # ── Scope guard: other sections untouched ────────────────────────────────

    def test_308_scope_guard_other_section_unchanged(self):
        text   = "imprisonment for up to one year"
        result = correct_punishment_mismatch(text, [_HIT_OTHER])
        assert result == text, (
            f"Correction must not alter text for non-199/166A hit. "
            f"Before={text!r}, after={result!r}"
        )

    def test_309_empty_hits_list_unchanged(self):
        text   = "imprisonment for up to one year or fine"
        result = correct_punishment_mismatch(text, [])
        assert result == text, "Empty hits must not trigger correction"

    def test_310_empty_text_unchanged(self):
        assert correct_punishment_mismatch("", [_HIT_BNS_199]) == ""

    def test_311_none_like_hits_unchanged(self):
        text = "up to one year or fine"
        assert correct_punishment_mismatch(text, None) == text


# ─────────────────────────────────────────────────────────────────────────────
# 4. Correspondence gate binding — the approval that authorises BNS §199
#    citations must use the exact canonical hash of the subject_key string.
# ─────────────────────────────────────────────────────────────────────────────

class TestRegistry001CorrespondenceGateBinding:
    """The active v1 approval (REGISTRY-001-v1-IPC166A-BNS199) must grant
    approval for IPC:166A → BNS:199 using the real on-disk registry.
    v0 record (REGISTRY-001-IPC166A-BNS199) was revoked on 2026-10-31;
    the v1 record requires canonical_record to be supplied.
    Every other pair and every mutation must fail closed."""

    # v1 canonical record for IPC:166A → BNS:199 (must match ipc_bns_mapping.json entry)
    _CR = {
        "schema_version":  "v1",
        "source_act":      "IPC",
        "source_section":  "166A",
        "target_act":      "BNS",
        "target_section":  "199",
        "offence_text":    "Public servant disobeying direction under law",
        "punishment_text": "Rigorous imprisonment of at least six months and up to two years, and fine",
    }

    def test_401_ipc_166a_bns_199_approved_from_real_registry(self):
        from engine.approval_evidence import check_section_correspondence_approval as _gate
        result = _gate("IPC:166A", "BNS:199", canonical_record=self._CR)
        assert result.approved is True, (
            f"REGISTRY-001-v1 must approve IPC:166A→BNS:199 with canonical_record: {result}"
        )
        assert result.reviewer_id == "callistus-moses-founder", (
            f"Reviewer ID mismatch: {result.reviewer_id}"
        )
        assert result.approval_id == "REGISTRY-001-v1-IPC166A-BNS199", (
            f"Unexpected approval_id (v0 was revoked): {result.approval_id}"
        )

    def test_402_ipc_166a_bns_199_reason_is_approved(self):
        from engine.approval_evidence import check_section_correspondence_approval as _gate
        assert _gate("IPC:166A", "BNS:199", canonical_record=self._CR).reason == "approved"

    def test_403_unregistered_pair_fails_closed(self):
        from engine.approval_evidence import check_section_correspondence_approval as _gate
        result = _gate("IPC:302", "BNS:103")
        assert result.approved is False, (
            "An unregistered IPC:302→BNS:103 pair must fail closed"
        )
        assert result.reason == "missing_approval"

    def test_404_swapped_pair_fails_closed(self):
        """BNS:199 → IPC:166A (reversed) is NOT the same claim as IPC:166A → BNS:199."""
        from engine.approval_evidence import check_section_correspondence_approval as _gate
        result = _gate("BNS:199", "IPC:166A")
        assert result.approved is False, (
            "Reversed pair (BNS:199→IPC:166A) must fail closed — it has no registry record"
        )

    def test_405_hash_is_bound_to_subject_key_string(self):
        """SHA-256 of the canonical subject_key must match the stored registry hash."""
        from engine.approval_evidence import compute_content_hash
        subject_key = "IPC:166A->BNS:199"
        expected    = compute_content_hash(subject_key)
        stored      = "eedb095a3250ac8ca0c5929c4fabe4076c9ef43342801683ee88b64db8ee401b"
        assert expected == stored, (
            f"Hash drift detected — real registry hash {stored!r} no longer "
            f"matches compute_content_hash({subject_key!r}) = {expected!r}. "
            "This means the canonical subject_key string changed without a new GO."
        )

    def test_406_subject_key_mutation_fails_closed(self):
        """If anyone altered the subject_key in the registry, hash no longer matches."""
        from engine.approval_evidence import check_section_correspondence_approval as _gate, compute_content_hash
        # Simulate a record whose subject_key string has drifted
        tampered_rec = {
            "approval_id":   "REGISTRY-001-IPC166A-BNS199-TAMPERED",
            "record_type":   "correspondence",
            "subject_key":   "IPC:166A->BNS:199-TAMPERED",   # drifted
            "section_from":  "IPC:166A",
            "section_to":    "BNS:199",
            "content_hash":  compute_content_hash("IPC:166A->BNS:199"),   # still old hash
            "reviewer_id":   "callistus-moses-founder",
            "status":        "active",
        }
        result = _gate("IPC:166A", "BNS:199", registry=[tampered_rec])
        assert result.approved is False, (
            "A record whose subject_key was altered after hash was computed must fail closed"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 5. Cross-reference endpoint integration — the _normalise() function must
#    attach correspondence_approval to each result and the value for
#    IPC:166A must be "approved".
# ─────────────────────────────────────────────────────────────────────────────

class TestCrossReferenceEndpointApprovalField:
    """Verifies that the /advocate/cross-reference route's _normalise() helper
    annotates each result with the correct correspondence_approval value.
    Uses the server module's internal function — no live HTTP call needed."""

    def test_501_ipc_166a_result_has_approved_status(self):
        """When IPC:166A is searched, the BNS:199 result must carry
        correspondence_approval == 'approved'."""
        import importlib, sys as _sys
        # Reload server module with path already set
        if "server" not in _sys.modules:
            import server  # noqa: F401
        import server as _srv  # noqa: F811
        results = _srv._xref_search(ipc="166A")
        matching = [r for r in results if r.get("old_section") == "166A"]
        assert matching, "IPC:166A must be in the cross-reference data"
        r = matching[0]
        assert "correspondence_approval" in r, (
            "correspondence_approval field missing from result"
        )
        assert r["correspondence_approval"] == "approved", (
            f"IPC:166A→BNS:199 should be 'approved' in the registry, "
            f"got: {r['correspondence_approval']!r}"
        )

    def test_502_unregistered_pair_has_missing_approval_status(self):
        """Any section pair that is NOT in the registry must carry
        correspondence_approval == 'missing_approval' (never a blank)."""
        import server as _srv
        # IPC:302 (murder) → BNS:103: in the dataset but NOT in the approval registry
        results = _srv._xref_search(ipc="302")
        matching = [
            r for r in results
            if r.get("old_section") == "302" and hasBnsEquivalent_py(r.get("new_section"))
        ]
        if not matching:
            import pytest
            pytest.skip("IPC:302 not in cross-reference data — skip, not a failure")
        for r in matching:
            assert r.get("correspondence_approval") in (
                "missing_approval", "no_section"
            ), (
                f"Unregistered pair must carry missing_approval, "
                f"got: {r.get('correspondence_approval')!r}"
            )


def hasBnsEquivalent_py(ns) -> bool:
    """Python equivalent of the frontend hasBnsEquivalent guard."""
    if not ns:
        return False
    s = str(ns).strip()
    return s not in ("", "—", "null", "none", "None")
