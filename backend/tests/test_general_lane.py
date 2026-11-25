"""General-question lane (engine/general_lane.py) — pure unit tests.

No database, no network, no LLM: the module is pure, and these tests pin
the three things that keep the lane safe:
  1. the switch is OFF unless FEATURE_GENERAL_ANSWERS is exactly "true";
  2. the sorter says "general" only for explanatory legal questions, and
     never for a personal incident, a next-steps request or a named section;
  3. figures (money, time periods, percentages) not present in the retrieved
     source text are detected.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.general_lane import (  # noqa: E402
    ENV_SWITCH,
    augment_prompt_with_general_lane,
    figure_repair_prompt,
    find_unsupported_figures,
    general_answers_enabled,
    is_general_question,
)


# ── 1. Switch ────────────────────────────────────────────────────────────────

class TestSwitch:
    def test_off_by_default(self, monkeypatch):
        monkeypatch.delenv(ENV_SWITCH, raising=False)
        assert general_answers_enabled() is False

    @pytest.mark.parametrize("value", ["true", "TRUE", " True "])
    def test_on_only_for_true(self, monkeypatch, value):
        monkeypatch.setenv(ENV_SWITCH, value)
        assert general_answers_enabled() is True

    @pytest.mark.parametrize("value", ["", "false", "0", "1", "yes", "on"])
    def test_anything_else_is_off(self, monkeypatch, value):
        monkeypatch.setenv(ENV_SWITCH, value)
        assert general_answers_enabled() is False


# ── 2. Sorter ────────────────────────────────────────────────────────────────

GENERAL = [
    "I want to know about citizens' rights.",
    "What are fundamental rights?",
    "what is an FIR",
    "Explain bail",
    "Tell me about consumer rights",
    "What is the difference between bail and parole?",
    "What are the rights of a tenant?",
    "What are my rights as a consumer?",
    "Please explain what legal aid is",
    "consumer rights",
    "What is domestic violence under the law?",
]

SPECIFIC = [
    "My phone was stolen yesterday, what should I do?",
    "My landlord is not returning my deposit",
    "How do I file an FIR?",
    "Can I get bail if I was arrested last night?",
    "What should I do if police refuse to register my complaint?",
    "What is the punishment under Section 303 of BNS?",
    "What is Article 21?",
    "what does 420 IPC say",
    "He hit me and took my money",
    "I was fired without notice, what are my rights?",
    "My husband threatens me, what is the law?",
    "धारा 302 क्या है",
]

NOT_LEGAL = [
    "What is photosynthesis?",
    "Tell me about cricket",
    "Explain how to cook rice",
    "What is the weather today?",
]


class TestSorter:
    @pytest.mark.parametrize("q", GENERAL)
    def test_general_questions(self, q):
        assert is_general_question(q, q) is True

    @pytest.mark.parametrize("q", SPECIFIC)
    def test_specific_questions_stay_on_strict_path(self, q):
        assert is_general_question(q, q) is False
        # Even if the parser called it informational, the markers win.
        assert is_general_question(q, q, informational_hint=True) is False

    @pytest.mark.parametrize("q", NOT_LEGAL)
    def test_non_legal_topics_are_never_general(self, q):
        assert is_general_question(q, q) is False
        assert is_general_question(q, q, informational_hint=True) is False

    def test_parser_stripped_prefix_still_sorts_as_general(self):
        # The parser's prefix-stripper turns the raw message into a bare topic.
        assert is_general_question("citizens' rights.", "I want to know about citizens' rights.") is True

    def test_parser_english_restatement_sorts_as_general(self):
        # A Hindi question restated in English by the parser.
        assert is_general_question(
            "The user wants to know about the rights of consumers in India.",
            "उपभोक्ता के अधिकार क्या हैं",
        ) is True

    def test_personal_marker_in_raw_text_wins_over_a_general_restatement(self):
        assert is_general_question(
            "What are the rights of a tenant?",
            "My landlord threw my things out, what are tenant rights",
        ) is False

    def test_informational_hint_admits_a_plain_legal_yes_no_question(self):
        q = "Is dowry illegal in India?"
        assert is_general_question(q, q) is False            # no opener on its own
        assert is_general_question(q, q, informational_hint=True) is True

    def test_long_messages_stay_on_strict_path(self):
        q = "What are the rights of a tenant " + "and also of a landlord " * 8
        assert is_general_question(q, q) is False

    @pytest.mark.parametrize("empty", [None, "", "   "])
    def test_empty_is_not_general(self, empty):
        assert is_general_question(empty, empty) is False


# ── 3. Instructions ──────────────────────────────────────────────────────────

class TestPrompt:
    BASE = "BASE PROMPT\n6. If your SOURCES block is empty or missing, reply exactly: X and STOP."

    def test_appends_and_never_removes_the_base_prompt(self):
        out = augment_prompt_with_general_lane(self.BASE, "English", has_sources=True)
        assert out.startswith(self.BASE)
        assert "GENERAL-QUESTION MODE" in out

    def test_tells_the_model_not_to_refuse_when_there_are_no_sources(self):
        out = augment_prompt_with_general_lane(self.BASE, "English", has_sources=False)
        assert "do NOT refuse for that reason" in out

    def test_keeps_the_hard_locks(self):
        out = augment_prompt_with_general_lane(self.BASE, "Hindi (हिन्दी)", has_sources=False)
        assert "Never state a money amount" in out
        assert "no section, article or clause numbers" in out
        assert "replaced in 2024" in out
        assert "Hindi (हिन्दी)" in out


# ── 4. Figure lock ───────────────────────────────────────────────────────────

class TestFigureLock:
    def test_clean_answer_has_no_violations(self):
        ans = "Answer:\nEvery citizen has six basic rights.\n\nKey points:\n- Equality – same law for all."
        assert find_unsupported_figures(ans, "") == []

    def test_money_time_and_percent_without_a_source_are_flagged(self):
        ans = "The fine is Rs 5,000 or ₹10000. Police must act within 24 hours. Interest is 18% for 3 years."
        assert find_unsupported_figures(ans, "") == ["Rs 5,000", "₹10000", "24 hours", "18%", "3 years"]

    def test_figures_present_in_the_sources_are_allowed(self):
        src = "…shall be produced before a Magistrate within twenty-four hours (24 hours)… fine of Rs. 5000…"
        ans = "Police must produce you within 24 hours. The fine can be ₹5,000."
        assert find_unsupported_figures(ans, src) == []

    def test_same_figure_written_differently_still_matches_the_source(self):
        assert find_unsupported_figures("up to 7 yrs in prison", "imprisonment up to 7 years") == []

    def test_a_different_number_is_flagged_even_if_the_unit_matches(self):
        assert find_unsupported_figures("up to 10 years", "imprisonment up to 7 years") == ["10 years"]

    def test_plain_counts_are_not_figures(self):
        assert find_unsupported_figures("There are 6 fundamental rights and 3 kinds of courts.", "") == []

    def test_hindi_units_and_digits(self):
        assert find_unsupported_figures("पुलिस को २४ घंटे के भीतर पेश करना होगा", "") == ["२४ घंटे"]
        assert find_unsupported_figures("पुलिस को २४ घंटे के भीतर", "within 24 घंटे") == []

    def test_duplicates_reported_once(self):
        assert find_unsupported_figures("24 hours … again 24 hours", "") == ["24 hours"]

    @pytest.mark.parametrize("empty", [None, ""])
    def test_empty_answer(self, empty):
        assert find_unsupported_figures(empty, "anything") == []

    def test_repair_prompt_names_the_figures_and_language(self):
        p = figure_repair_prompt("English", ["24 hours", "Rs 5,000"])
        assert "24 hours" in p and "Rs 5,000" in p and "English" in p
        assert "Do not add any new number" in p
