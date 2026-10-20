"""
P0-C regression tests — Multi-Turn Legal Context Preservation.

Scope (per approved P0-C GO):
  * The exact 4-turn regression sequence from the audit.
  * IPC 166 vs 166A vs 166B across turns.
  * IPC 166A vs 166B across turns.
  * Explicit corrections between different Acts.
  * Genuine short clarification answers ("Maharashtra", "2023", "Yes", "No")
    still work and do NOT erase an already-active statute reference.
  * Multiple references in one message (documented actual behaviour).
  * Unknown exact sections (context layer never fabricates — it only
    records what was EXPLICITLY said; content verification is P0-B's job).

IMPORTANT: these tests verify CONTEXT ROUTING ONLY (which Act/section the
pipeline considers "active", and what normalized_query/original_query hold).
They do NOT verify generated legal-answer accuracy — that depends on
retrieval + the LLM answer step, outside this phase's scope.

parse_query() (Layer A's LLM call) is mocked — no LLM calls, no network, no
live DB. engine.pipeline.run_pre_retrieval() is exercised directly.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from engine.models import LegalQuery, Jurisdiction, CaseState  # noqa: E402
from engine import pipeline  # noqa: E402


def _fake_lq(query: str) -> LegalQuery:
    """Approximates what the real LLM query-parser would plausibly return.
    Bare statute citations and meta-questions never describe a conduct
    action/issue -- which is exactly the condition that used to trigger the
    CLARIFICATION_ANSWER misclassification this phase fixes."""
    q = query.strip()
    ql = q.lower()
    jurisdiction = Jurisdiction()
    event_date = None
    actions: list[str] = []
    candidate_issues: list[str] = []

    if ql in ("maharashtra",):
        jurisdiction = Jurisdiction(state="Maharashtra")
    elif ql in ("2023",):
        event_date = "2023"
    elif ql in ("yes.", "yes", "no.", "no"):
        pass  # pure clarification answers, no facts to extract
    elif "assault" in ql or "hit me" in ql:
        actions = ["assault"]
        candidate_issues = ["assault"]

    return LegalQuery(
        original_query=q,
        normalized_query=q,
        jurisdiction=jurisdiction,
        event_date=event_date,
        actions=actions,
        candidate_issues=candidate_issues,
        urgency="standard",
        requested_outcome="unknown",
    )


async def _send(session: dict | None, message: str) -> tuple[LegalQuery, CaseState]:
    """Run one turn through run_pre_retrieval() with parse_query mocked."""
    with patch.object(pipeline, "parse_query", new=AsyncMock(side_effect=lambda **kw: _fake_lq(kw["query"]))):
        lq, classify_result, fact_result, new_state = await pipeline.run_pre_retrieval(
            query=message, language="en", llm_key="", session=session, db=None,
        )
    return lq, new_state


def _session_from(state: CaseState) -> dict:
    return {"id": "s1", "case_state": state.to_mongo()}


# ─────────────────────────────────────────────────────────────────────────
# 1. The exact 4-turn regression sequence from the audit
# ─────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestFourTurnRegression:
    async def test_full_sequence(self):
        session = None

        # Turn 1: "Hey DHARA, check BNS 166A."
        lq1, state1 = await _send(session, "Hey DHARA, check BNS 166A.")
        assert state1.active_statute_ref is not None
        assert state1.active_statute_ref["act"] == "Bharatiya Nyaya Sanhita"
        assert state1.active_statute_ref["section"] == "166A"
        # Context layer records exactly what was said — it does NOT invent
        # or substitute an IPC identity for the BNS one named.
        session = _session_from(state1)

        # Turn 2: "IPC 166A."
        lq2, state2 = await _send(session, "IPC 166A.")
        assert state2.active_statute_ref["act"] == "Indian Penal Code"
        assert state2.active_statute_ref["section"] == "166A"
        # The active reference CHANGED from BNS to IPC — turn 2 is the new subject.
        assert lq2.normalized_query == "IPC 166A."
        session = _session_from(state2)

        # Turn 3: "What is the corresponding BNS section?" — short, no Act
        # name of its own, no actions/issues -> would have been swallowed
        # into CLARIFICATION_ANSWER pre-fix, restoring Turn 1's BNS framing.
        lq3, state3 = await _send(session, "What is the corresponding BNS section?")
        assert state3.active_statute_ref["act"] == "Indian Penal Code"
        assert state3.active_statute_ref["section"] == "166A"
        # Context correctly still points at IPC 166A (Turn 2's subject), NOT
        # Turn 1's "BNS 166A" framing.
        session = _session_from(state3)

        # Turn 4: "Does IPC 166A still apply?"
        lq4, state4 = await _send(session, "Does IPC 166A still apply?")
        assert state4.active_statute_ref["act"] == "Indian Penal Code"
        assert state4.active_statute_ref["section"] == "166A"
        assert lq4.normalized_query == "Does IPC 166A still apply?"


# ─────────────────────────────────────────────────────────────────────────
# 2. Additional required tests
# ─────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestDistinctSiblingSections:
    async def test_166_vs_166a(self):
        session = None
        _, s1 = await _send(session, "IPC 166")
        assert s1.active_statute_ref["section"] == "166"
        _, s2 = await _send(_session_from(s1), "IPC 166A")
        assert s2.active_statute_ref["section"] == "166A"
        assert s2.active_statute_ref["section"] != s1.active_statute_ref["section"]

    async def test_166a_vs_166b(self):
        session = None
        _, s1 = await _send(session, "IPC 166A")
        assert s1.active_statute_ref["section"] == "166A"
        _, s2 = await _send(_session_from(s1), "IPC 166B")
        assert s2.active_statute_ref["section"] == "166B"
        assert s2.active_statute_ref["section"] != s1.active_statute_ref["section"]


@pytest.mark.asyncio
class TestExplicitActCorrection:
    async def test_correction_between_acts(self):
        session = None
        _, s1 = await _send(session, "IPC 166A")
        assert s1.active_statute_ref["act"] == "Indian Penal Code"
        _, s2 = await _send(_session_from(s1), "Actually I meant BNS 199")
        assert s2.active_statute_ref["act"] == "Bharatiya Nyaya Sanhita"
        assert s2.active_statute_ref["section"] == "199"


@pytest.mark.asyncio
class TestGenuineClarificationAnswersStillWork:
    async def test_maharashtra_updates_jurisdiction_and_keeps_statute_ref(self):
        _, s1 = await _send(None, "IPC 166A")
        lq2, s2 = await _send(_session_from(s1), "Maharashtra")
        assert lq2.jurisdiction.state == "Maharashtra"
        # The active statute reference from the PRIOR turn must survive a
        # genuine short clarification answer.
        assert s2.active_statute_ref["act"] == "Indian Penal Code"
        assert s2.active_statute_ref["section"] == "166A"

    async def test_2023_updates_event_date_and_keeps_statute_ref(self):
        _, s1 = await _send(None, "IPC 166A")
        lq2, s2 = await _send(_session_from(s1), "2023")
        assert lq2.event_date == "2023"
        assert s2.active_statute_ref["section"] == "166A"

    @pytest.mark.parametrize("answer", ["Yes.", "No."])
    async def test_yes_no_preserve_statute_ref(self, answer):
        _, s1 = await _send(None, "IPC 166A")
        _, s2 = await _send(_session_from(s1), answer)
        assert s2.active_statute_ref["section"] == "166A"
        assert pipeline.classify_turn(answer, _fake_lq(answer), s1) == "CLARIFICATION_ANSWER"


@pytest.mark.asyncio
class TestMultipleReferencesDocumentedBehaviour:
    async def test_first_reference_wins_when_two_are_present(self):
        # Known limitation (documented, not silently wrong): the underlying
        # extract_exact_statute_ref() returns the FIRST match only. A true
        # "please clarify which section" flow for multi-reference messages
        # is out of this phase's narrow scope.
        _, s1 = await _send(None, "What about IPC 166A and IPC 420?")
        assert s1.active_statute_ref["section"] == "166A"


@pytest.mark.asyncio
class TestUnknownExactSectionNeverFabricated:
    async def test_context_layer_records_exactly_what_was_said(self):
        # "IPC 9999" does not exist in Indian law. The CONTEXT layer must
        # still just record the literal Act+number the user typed — it must
        # NEVER invent/substitute a different, "plausible" section. Whether
        # this is a real section is a P0-B/answer-generation concern.
        # Note: section numbers are capped at 3 digits by design (P0-B) to
        # avoid false-matching 4-digit years like "1860 IPC" -- "IPC 999" is
        # used here (a syntactically valid, almost-certainly-nonexistent
        # section) rather than a 4-digit input.
        _, s1 = await _send(None, "IPC 999")
        assert s1.active_statute_ref == {
            "act": "Indian Penal Code", "section": "999", "subsection": None,
            "source_message": "IPC 999",
        }


@pytest.mark.asyncio
class TestOrdinaryContinuationUnaffected:
    async def test_action_based_continuation_does_not_touch_statute_ref(self):
        """A normal narrative follow-up (no Act name) must not clobber or
        require an active_statute_ref; ordinary flows are unaffected."""
        _, s1 = await _send(None, "My neighbour hit me yesterday")
        assert s1.active_statute_ref is None
        lq2, s2 = await _send(_session_from(s1), "He also threatened me assault again")
        assert s2.active_statute_ref is None  # never set, never crashes
