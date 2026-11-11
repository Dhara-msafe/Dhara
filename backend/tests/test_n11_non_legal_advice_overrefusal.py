"""
N-11 (B-49) (P2): chat now also checks the raw message with
is_non_legal_advice (c57b48a) -- could refuse legitimate questions.

ROOT CAUSE: c57b48a added `is_non_legal_advice(body.message)` (the user's
RAW message) alongside the existing `is_non_legal_advice(retrieval_text)`
(the LLM-normalised query) check in chat_router.py, to catch "should I
forgive my husband" surviving the query normaliser's rephrasing into
neutral legal-sounding prose. That fix was correct on its own terms, but
several of NON_LEGAL_ADVICE_KEYWORDS's phrases ("should i marry", "should i
divorce", "should i quit") are also ordinary substrings of genuine, in-scope
LEGAL questions -- and a user's RAW message is far more likely to embed one
of them incidentally inside an otherwise clearly statutory question than a
normalised query is:
  - "Should I marry under the Special Marriage Act or the Hindu Marriage
    Act?" -- a real marriage-law question, not moral advice.
  - "Should I quit without serving my notice period -- what are my legal
    rights?" -- a real labour-law question.
  - "Should I divorce my husband under the Hindu Marriage Act? Who gets
    custody?" -- a real divorce-law question.
Before this fix, all three of the above would have been silently refused as
"not legal advice", exactly the failure mode the register item describes.

FIX (backend/corpus.py): is_non_legal_advice() now has a second check --
if the message ALSO carries a clear statutory/procedural marker (a named
act, "section", "custody", "rights", "notice period", etc. --
LEGAL_CONTEXT_OVERRIDE_KEYWORDS), it is treated as the legal question it
reads as, not personal/moral advice, and is NOT refused.

These tests confirm both halves: the override actually fixes the new false
positives, AND the original true positive this phrase list exists for
("Should I forgive my husband for cheating on me?" -- the exact phrasing
already covered by test_refusal_analytics.py's
test_not_legal_advice_refusal_sets_correct_cause_code, which needs a live
server to run) still refuses correctly with no legal marker present.
"""
import pytest

from corpus import is_non_legal_advice


class TestTruePositivesStillRefuse:
    """These must keep refusing -- genuinely out-of-scope personal/moral
    advice requests, no legal content at all."""

    @pytest.mark.parametrize("message", [
        "Should I forgive my husband for cheating on me?",
        "Should I marry him, I really love him but my parents disagree",
        "Should I divorce her, I just don't feel the same way anymore",
        "Should I quit my job, I'm just not happy there anymore",
        "Can you give me advice, I don't know what to do with my life",
        "I need some moral advice about my situation",
        "What should I do with my life, I feel so lost",
        "I want religious advice on whether this is a sin",
    ])
    def test_pure_personal_advice_is_still_refused(self, message):
        assert is_non_legal_advice(message) is True, message


class TestNewFalsePositivesNowAnswered:
    """N-11's actual bug: these are real legal questions that happen to
    share surface wording with the personal-advice phrase list -- before
    this fix, every one of these was silently refused."""

    @pytest.mark.parametrize("message", [
        "Should I marry under the Special Marriage Act or the Hindu Marriage Act?",
        "Should I quit without serving my notice period? What are my legal rights?",
        "Should I divorce my husband under the Hindu Marriage Act? Who gets custody?",
        "What are the grounds for divorce, and should I divorce under Section 13?",
        "Should I divorce my husband in court, what is the procedure for divorce?",
        "Can you give me advice on filing an RTI application under the RTI Act?",
        "Should I quit without working my notice period, will my employer withhold my PF withdrawal?",
    ])
    def test_legal_questions_with_a_statutory_marker_are_not_refused(self, message):
        assert is_non_legal_advice(message) is False, message


class TestOverrideDoesNotSwallowEverything:
    """Sanity: the override is scoped to messages that actually carry a
    legal/statutory marker -- it must not quietly disable the gate
    entirely."""

    def test_pure_moral_question_with_no_legal_marker_still_refuses(self):
        assert is_non_legal_advice("Should I forgive my husband? He says he's sorry.") is True

    def test_adding_unrelated_words_does_not_trigger_the_override(self):
        # No statutory/procedural marker present; this is just moral-advice
        # phrasing with extra words around it, not a legal question --
        # must still refuse.
        assert is_non_legal_advice("Honestly, should I forgive my husband already, I'm so tired of this") is True


class TestRawMessageCheckStillCatchesTheOriginalC57b48aBug:
    """is_non_legal_advice() is called on BOTH retrieval_text and
    body.message in chat_router.py -- this confirms the function itself
    still correctly flags the raw phrasing c57b48a was written to catch
    (a normaliser-surviving "should I forgive my husband" with no legal
    marker anywhere), i.e. this fix is additive, not a regression on the
    bug c57b48a itself fixed."""

    def test_raw_vocative_phrasing_with_no_legal_marker_is_still_flagged(self):
        assert is_non_legal_advice("yaar should i forgive my husband, idk anymore") is True
