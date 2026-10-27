"""
P0 containment test — T04 (DHARA-Team-Delivery-Tracker-2026-10-26.xlsx,
Batch A: legal-release containment).

Defect: api/chat_router.py's `_explicit_exact_dead_citation_with_successor()`
used to short-circuit on a stored `dead_with_successor` flag persisted on
CaseState.active_statute_ref across conversation turns — i.e. conversation/
topic memory alone could authorize the "cannot verify" refusal bypass for a
LATER turn, without re-checking that later turn's own retrieval.

Fix: the decision is now made by the pure, importable function
`engine.answer_generator.recheck_dead_with_successor_release()`, which is
called fresh every turn and ALWAYS re-derives the result from that turn's
own retrieved hits — clearing (failing closed) any stale True left by an
earlier turn if the current turn's evidence no longer supports it.

These tests import and exercise the actual production function directly
(no mocked network/DB/LLM calls needed — it is pure).
"""
from __future__ import annotations

import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from engine.answer_generator import recheck_dead_with_successor_release  # noqa: E402


_LEGACY_TO_SUCCESSOR_FAMILY = {
    "indian penal code": "Bharatiya Nyaya Sanhita",
    "code of criminal procedure": "Bharatiya Nagarik Suraksha Sanhita",
    "indian evidence act": "Bharatiya Sakshya Adhiniyam",
}

_IPC_166A_WITH_SUCCESSOR = {
    "act_name": "Indian Penal Code",
    "section_number": "166A",
    "is_dead_law": True,
    "successor_act": "Bharatiya Nyaya Sanhita, Section 199",
}

_UNRELATED_HIT = {
    "act_name": "Motor Vehicles Act",
    "section_number": "184",
    "is_dead_law": False,
}


class TestNoActiveReference:
    def test_none_active_ref_returns_false(self):
        assert recheck_dead_with_successor_release(None, [], _LEGACY_TO_SUCCESSOR_FAMILY) is False

    def test_active_ref_missing_section_returns_false(self):
        ref = {"act": "Indian Penal Code"}
        assert recheck_dead_with_successor_release(ref, [_IPC_166A_WITH_SUCCESSOR], _LEGACY_TO_SUCCESSOR_FAMILY) is False


class TestGenuineMatchGrantsExemption:
    def test_matching_hit_with_successor_sets_flag_and_family(self):
        ref = {"act": "Indian Penal Code", "section": "166A"}
        result = recheck_dead_with_successor_release(
            ref, [_IPC_166A_WITH_SUCCESSOR], _LEGACY_TO_SUCCESSOR_FAMILY,
        )
        assert result is True
        assert ref["dead_with_successor"] is True
        assert ref["successor_act_label"] == "Bharatiya Nyaya Sanhita, Section 199"
        assert ref["successor_act_family"] == "Bharatiya Nyaya Sanhita"

    def test_matching_act_section_but_no_successor_field_does_not_grant(self):
        ref = {"act": "Indian Penal Code", "section": "166A"}
        hit_no_successor = {"act_name": "Indian Penal Code", "section_number": "166A", "is_dead_law": True}
        result = recheck_dead_with_successor_release(ref, [hit_no_successor], _LEGACY_TO_SUCCESSOR_FAMILY)
        assert result is False
        assert ref["dead_with_successor"] is False


class TestStaleStateFailsClosed:
    """Core T04 regression: a True flag from an EARLIER turn must never be
    trusted on a LATER turn whose own retrieval no longer supports it."""

    def test_stale_true_flag_is_cleared_when_this_turns_hits_dont_support_it(self):
        # Simulate persisted CaseState.active_statute_ref carrying forward a
        # True flag set on a prior turn.
        ref = {
            "act": "Indian Penal Code",
            "section": "166A",
            "dead_with_successor": True,  # stale, from an earlier turn
            "successor_act_label": "Bharatiya Nyaya Sanhita, Section 199",
            "successor_act_family": "Bharatiya Nyaya Sanhita",
        }
        # This turn's own retrieval returns nothing relevant (e.g. topic
        # drifted, or the exact dead record simply wasn't re-matched).
        result = recheck_dead_with_successor_release(ref, [_UNRELATED_HIT], _LEGACY_TO_SUCCESSOR_FAMILY)
        assert result is False, "stale conversation memory must not independently authorize the bypass"
        assert ref["dead_with_successor"] is False, "stale True must be cleared, not inherited"

    def test_stale_true_flag_is_cleared_with_no_hits_at_all(self):
        ref = {
            "act": "Indian Penal Code",
            "section": "166A",
            "dead_with_successor": True,
        }
        result = recheck_dead_with_successor_release(ref, [], _LEGACY_TO_SUCCESSOR_FAMILY)
        assert result is False
        assert ref["dead_with_successor"] is False

    def test_legitimate_followup_turn_still_works_when_hit_is_re_retrieved(self):
        # Regression guard: the legitimate "what is the BNS equivalent?"
        # follow-up still works PROVIDED this turn's own retrieval still
        # contains the matching dead-law+successor hit (which chat_router's
        # retrieval-carry-forward of active_statute_ref ensures happens).
        ref = {"act": "Indian Penal Code", "section": "166A", "dead_with_successor": True}
        result = recheck_dead_with_successor_release(
            ref, [_UNRELATED_HIT, _IPC_166A_WITH_SUCCESSOR], _LEGACY_TO_SUCCESSOR_FAMILY,
        )
        assert result is True
        assert ref["dead_with_successor"] is True


class TestSectionAndActNormalizedMatch:
    def test_section_match_is_case_and_whitespace_insensitive(self):
        ref = {"act": "indian penal code", "section": " 166a "}
        result = recheck_dead_with_successor_release(ref, [_IPC_166A_WITH_SUCCESSOR], _LEGACY_TO_SUCCESSOR_FAMILY)
        assert result is True

    def test_section_number_alone_is_not_sufficient_without_matching_act(self):
        # Must match normalized Act AND section, not section number alone.
        ref = {"act": "Motor Vehicles Act", "section": "166A"}
        result = recheck_dead_with_successor_release(ref, [_IPC_166A_WITH_SUCCESSOR], _LEGACY_TO_SUCCESSOR_FAMILY)
        assert result is False
