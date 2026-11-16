"""B-98: a follow-up question must not have the answer's obligations reframed
onto the wrong party.

Repro reported by the TL on 12 Nov: first turn "landlord not returning my
Rs 50,000 deposit (Bengaluru)" (asking_as_role=tenant), follow-up "How do I
send that legal notice?" -> answer said "You do not send the legal notice -
your landlord does." Wrong for a tenant asking how THEY send a notice.

Root cause (traced in engine/pipeline.py, engine/query_parser.py,
engine/conduct_classifier.py):
  1. engine/pipeline.py's run_pre_retrieval only merges prior turn state into
     a brand-new turn's LegalQuery for CLARIFICATION_ANSWER turns. For a
     CONTINUATION/NEW_SUBQUESTION turn it used the new turn's own parse
     directly -- and a short follow-up like this one rarely restates the
     user's own role, so lq.asking_as_role came back None.
  2. engine/conduct_classifier.extract_actor_conduct only raises
     actor_mismatch when the user's role IS known and conflicts with the
     regulated actor. With asking_as_role lost, the mismatch guard can't
     tell who the user is, and (depending on what Layer A's parse put in
     actor_roles for this turn) the ACTOR-CONDUCT LOCK can end up reframing
     the answer as if the user had asked about the OTHER party's duty.

Fix: engine/pipeline.py now carries prior_lq.asking_as_role forward onto
this turn's lq when the new turn didn't restate one, but ONLY for
CONTINUATION/NEW_SUBQUESTION/NEW_QUERY/AMBIGUOUS turns -- never for
TOPIC_CHANGE or EXPLICIT_STATUTE_REFERENCE, where the user's role in a
genuinely new subject may be entirely different. engine/query_parser.py's
prior-context hint was also relabeled (counterparty_roles vs user_role,
explicitly scoped to "PRIOR TURN CONTEXT ONLY") so the LLM parse itself is
less likely to copy the earlier counterparty role onto a new action the
user performs themself.

These tests exercise engine.pipeline.run_pre_retrieval end-to-end with
Layer A (the only LLM call in the pipeline) monkeypatched to a controlled
stand-in -- classify_turn, classify() and detect_facts() are all pure
code (confirmed by reading engine/pipeline.py's imports and
engine/conduct_classifier.classify / engine/fact_detector.detect, which
are plain sync defs with no LlmChat import), so the rest of the pipeline
runs for real and this needs no live server or API key.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import engine.pipeline as pipeline  # noqa: E402
from engine.models import CaseState, LegalQuery  # noqa: E402


def _session_with_prior(prior_lq: LegalQuery) -> dict:
    state = CaseState(session_id="s1", turn_count=1, legal_query=prior_lq)
    return {"id": "s1", "case_state": state.to_mongo()}


def _patch_parse_query(monkeypatch, returning: LegalQuery):
    """Stand in for Layer A: ignore the LLM entirely, return a fixed LegalQuery
    (as if this were exactly what the real parser produced for this turn)."""
    async def _fake_parse_query(query, language="en", llm_key="", prior_state=None):
        return returning
    monkeypatch.setattr(pipeline, "parse_query", _fake_parse_query)


@pytest.fixture
def prior_tenant_turn() -> LegalQuery:
    return LegalQuery(
        original_query="landlord not returning my Rs 50,000 deposit (Bengaluru)",
        normalized_query="Landlord is withholding a Rs 50,000 security deposit in Bengaluru.",
        actions=["withhold_payment"],
        actor_roles=["landlord"],
        asking_as_role="tenant",
        candidate_issues=["security_deposit_dispute"],
        jurisdiction={"country": "India", "state": "Karnataka", "district": "Bengaluru"},
    )


def test_followup_without_restated_role_inherits_prior_asking_as_role(monkeypatch, prior_tenant_turn):
    """The exact B-98 repro shape: a short CONTINUATION-style follow-up whose
    own Layer A parse comes back with no asking_as_role at all (the realistic
    failure mode -- the message itself never says "I am a tenant")."""
    followup_lq = LegalQuery(
        original_query="How do I send that legal notice?",
        normalized_query="How does the user send a legal notice?",
        actions=["send_notice"],
        actor_roles=["tenant"],   # Layer A got this right this time
        asking_as_role=None,     # ...but didn't restate the user's own role
        candidate_issues=["security_deposit_dispute"],  # same issue -> CONTINUATION
    )
    _patch_parse_query(monkeypatch, followup_lq)

    lq, classify_result, fact_result, new_state = asyncio.run(
        pipeline.run_pre_retrieval(
            query="How do I send that legal notice?",
            language="en",
            llm_key="unused",
            session=_session_with_prior(prior_tenant_turn),
            db=None,
        )
    )

    assert lq.asking_as_role == "tenant", (
        "the follow-up's own role must be filled in from the prior turn "
        "when this turn's message didn't restate it"
    )
    # With the role known and matching actor_roles=["tenant"], the
    # ACTOR-CONDUCT LOCK must NOT fire -- this is the user's own action.
    assert classify_result.actor_mismatch is False
    assert classify_result.regulated_actor == "tenant"


def test_followup_where_layer_a_still_misattributes_actor_roles(monkeypatch, prior_tenant_turn):
    """Even with asking_as_role correctly carried forward, demonstrate the
    second half of the bug: if Layer A's own per-turn parse still copies the
    PRIOR counterparty role onto actor_roles for the new action (the exact
    bias the reworded prior-context hint targets), the mismatch guard is
    working as designed -- this test documents that behaviour rather than
    asserting it's gone, since Layer A's own compliance can't be unit-tested
    without a live LLM call. It exists so a future reader sees the two
    independent fixes aren't redundant: the hint change reduces how often
    this branch is even reached, the carry-forward fix fires regardless."""
    followup_lq = LegalQuery(
        original_query="How do I send that legal notice?",
        normalized_query="How does the user send a legal notice?",
        actions=["send_notice"],
        actor_roles=["landlord"],  # Layer A copied the stale counterparty role
        asking_as_role=None,
        candidate_issues=["security_deposit_dispute"],
    )
    _patch_parse_query(monkeypatch, followup_lq)

    lq, classify_result, _, _ = asyncio.run(
        pipeline.run_pre_retrieval(
            query="How do I send that legal notice?",
            language="en",
            llm_key="unused",
            session=_session_with_prior(prior_tenant_turn),
            db=None,
        )
    )

    assert lq.asking_as_role == "tenant"  # carry-forward still applies
    # Known-residual case: actor_roles itself was wrong coming out of Layer A
    # here, so the mismatch guard correctly flags it as a mismatch given that
    # (wrong) input -- this is a Layer A accuracy problem, not Layer B/C's.
    assert classify_result.actor_mismatch is True
    assert classify_result.regulated_actor == "landlord"


def test_topic_change_does_not_carry_the_old_role_into_a_new_topic(monkeypatch, prior_tenant_turn):
    """A genuine topic change must NOT inherit "tenant" into an unrelated new
    question -- the scoping fix explicitly excludes TOPIC_CHANGE."""
    unrelated_lq = LegalQuery(
        original_query="my employer fired me without notice",
        normalized_query="Employer terminated the user without notice.",
        actions=["terminate"],
        actor_roles=["employer"],
        asking_as_role=None,
        candidate_issues=["wrongful_termination"],  # no overlap with prior issue
    )
    _patch_parse_query(monkeypatch, unrelated_lq)

    lq, classify_result, _, new_state = asyncio.run(
        pipeline.run_pre_retrieval(
            query="my employer fired me without notice",
            language="en",
            llm_key="unused",
            session=_session_with_prior(prior_tenant_turn),
            db=None,
        )
    )

    assert lq.asking_as_role is None, (
        "a real topic change must not drag the old role (tenant) into an "
        "unrelated new topic (employment)"
    )
    assert classify_result.actor_mismatch is False


def test_followup_that_does_restate_its_own_role_is_never_overridden(monkeypatch, prior_tenant_turn):
    """If the follow-up DOES state its own role, the carry-forward must not
    clobber it -- it only fills a gap, never overrides a genuine answer."""
    followup_lq = LegalQuery(
        original_query="Actually I'm the landlord's lawyer, how should they respond?",
        normalized_query="The landlord's lawyer asks how the landlord should respond.",
        actions=["send_notice"],
        actor_roles=["tenant"],
        asking_as_role="advocate",
        candidate_issues=["security_deposit_dispute"],
    )
    _patch_parse_query(monkeypatch, followup_lq)

    lq, _, _, _ = asyncio.run(
        pipeline.run_pre_retrieval(
            query="Actually I'm the landlord's lawyer, how should they respond?",
            language="en",
            llm_key="unused",
            session=_session_with_prior(prior_tenant_turn),
            db=None,
        )
    )

    assert lq.asking_as_role == "advocate"


def test_new_query_with_no_session_is_unaffected(monkeypatch):
    """No prior session at all -> nothing to carry forward, no crash."""
    fresh_lq = LegalQuery(
        original_query="can police enter my house without a warrant",
        normalized_query="Can police enter a home without a warrant?",
        actions=["enter"],
        actor_roles=["police"],
        asking_as_role=None,
        candidate_issues=["unlawful_entry"],
    )
    _patch_parse_query(monkeypatch, fresh_lq)

    lq, classify_result, _, _ = asyncio.run(
        pipeline.run_pre_retrieval(
            query="can police enter my house without a warrant",
            language="en",
            llm_key="unused",
            session=None,
            db=None,
        )
    )
    assert lq.asking_as_role is None
    assert classify_result.actor_mismatch is False
