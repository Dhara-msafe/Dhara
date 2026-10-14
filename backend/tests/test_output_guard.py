"""Phase 1 hotfix — golden tests for engine/output_guard.py.

Pure-python, no LLM calls, no DB — safe to run in CI.

Run:
    cd /app/backend
    python -m pytest tests/test_output_guard.py -v
"""
from __future__ import annotations

from engine.output_guard import (
    validate_dhara_text,
    collapse_repeated_small_words,
    looks_like_refusal,
    contains_banned_word_strict,
    contains_dhara_claim_violation,
    CANNOT_CONFIRM_MESSAGE,
    BANNED_WORDS,
)


class TestLegalTermsOfArtAlwaysPassInAnswerText:
    """Rule (c) — ordinary legal terms must never be blocked, even though
    they contain a banned word."""

    def test_certified_copy_passes(self):
        text = "You can request a certified copy of your FIR from the station."
        clean, blocked, _ = validate_dhara_text(text)
        assert blocked is False
        assert clean == text

    def test_rights_guaranteed_by_constitution_passes(self):
        text = "These are fundamental rights guaranteed by the Constitution."
        clean, blocked, _ = validate_dhara_text(text)
        assert blocked is False
        assert clean == text

    def test_verified_affidavit_passes(self):
        text = "You must file a verified affidavit along with the petition."
        clean, blocked, _ = validate_dhara_text(text)
        assert blocked is False

    def test_approved_by_the_court_passes(self):
        text = "This settlement was approved by the court."
        clean, blocked, _ = validate_dhara_text(text)
        assert blocked is False

    def test_the_courts_verdict_passes(self):
        text = "The matter is pending the court's verdict."
        clean, blocked, _ = validate_dhara_text(text)
        assert blocked is False


class TestDharaClaimsAreBlockedInAnswerText:
    """Rule (b) — a claim about DHARA/its answer/sources/a draft."""

    def test_dhara_has_verified_this_blocks(self):
        _, blocked, _ = validate_dhara_text("DHARA has verified this.")
        assert blocked is True

    def test_court_ready_draft_blocks(self):
        _, blocked, _ = validate_dhara_text("Here is your court-ready draft.")
        assert blocked is True

    def test_this_answer_is_verified_blocks(self):
        _, blocked, _ = validate_dhara_text("This answer is verified and accurate.")
        assert blocked is True

    def test_guaranteed_outcome_blocks(self):
        _, blocked, _ = validate_dhara_text("We guarantee a favourable outcome in court.")
        assert blocked is True

    def test_self_attributed_verdict_blocks(self):
        _, blocked, _ = validate_dhara_text("My verdict is that you are in the right.")
        assert blocked is True

    def test_mixed_legal_term_and_claim_blocks_on_the_claim_only(self):
        """Phase 1 follow-up: a legal term of art and a DHARA-claim in the
        SAME answer. The claim must block the whole answer (fail-closed —
        there is no partial-redaction in Phase 1); the legal term by
        itself must never be the reason it blocks."""
        mixed = "You can request a certified copy of your FIR from the station. This answer is verified and accurate."
        _, blocked, _ = validate_dhara_text(mixed)
        assert blocked is True  # blocked because of the claim sentence
        # Proof the legal term alone was never the trigger: the same legal
        # term, with no claim sentence, must pass on its own.
        term_only = "You can request a certified copy of your FIR from the station."
        _, blocked_term_only, _ = validate_dhara_text(term_only)
        assert blocked_term_only is False

    def test_mixed_rights_guaranteed_and_court_ready_claim(self):
        mixed = "These are fundamental rights guaranteed by the Constitution. Here is your court-ready draft."
        _, blocked, _ = validate_dhara_text(mixed)
        assert blocked is True
        term_only = "These are fundamental rights guaranteed by the Constitution."
        _, blocked_term_only, _ = validate_dhara_text(term_only)
        assert blocked_term_only is False


class TestRepeatedWordsCollapsedNotBlocked:
    def test_the_the_collapsed(self):
        clean, blocked, n = validate_dhara_text(
            "The the law [UNVERIFIED] was replaced in 2023 by the the law [UNVERIFIED]."
        )
        # [UNVERIFIED] present -> this is a BLOCK case, not a collapse case.
        assert blocked is True
        assert clean == "The the law [UNVERIFIED] was replaced in 2023 by the the law [UNVERIFIED]."

    def test_collapse_without_unverified_marker(self):
        clean, n = collapse_repeated_small_words("The the Indian Penal Code was replaced by the the Bharatiya Nyaya Sanhita.")
        assert clean == "The Indian Penal Code was replaced by the Bharatiya Nyaya Sanhita."
        assert n == 2

    def test_collapse_counts_all_five_small_words(self):
        clean, n = collapse_repeated_small_words("a a cat, of of mice, to to go, and and stay, the the end")
        assert clean == "a cat, of mice, to go, and stay, the end"
        assert n == 5

    def test_repeats_never_block(self):
        _, blocked, _ = validate_dhara_text("The the law was replaced.")
        assert blocked is False


class TestStrictRuleReservedForDharaOwnStrings:
    """Rule (a) — contains_banned_word_strict() is the zero-tolerance
    check for DHARA's OWN hardcoded strings, kept separate from the
    answer-text rule. Not currently wired to any runtime call site
    (those strings are reworded at the source instead — see
    engine/answer_generator.py / dependencies.py / server.py), but
    verified here so the function itself stays correct if ever needed."""

    def test_strict_check_has_no_legal_term_exceptions(self):
        assert contains_banned_word_strict("certified copy") is True
        assert contains_banned_word_strict("rights guaranteed by the Constitution") is True

    def test_each_banned_word_strict_blocks(self):
        for w in BANNED_WORDS:
            assert contains_banned_word_strict(f"This is a {w} answer.") is True

    def test_clean_prose_passes_strict_too(self):
        assert contains_banned_word_strict("You can file a complaint at the police station.") is False


class TestUnverifiedMarkerAlwaysBlocksRegardlessOfContext:
    def test_unverified_marker_blocks(self):
        _, blocked, _ = validate_dhara_text("Some answer [UNVERIFIED] text.")
        assert blocked is True

    def test_clean_prose_passes_untouched(self):
        text = "You can file a complaint at your nearest police station."
        clean, blocked, n = validate_dhara_text(text)
        assert blocked is False
        assert clean == text
        assert n == 0


class TestQuotedCorpusTextNeverPassedToGuard:
    """Architectural guarantee: a citation's official_text is a separate
    SSE payload in chat_router.py and is never routed through
    validate_dhara_text(). Confirmed two ways: (1) these specific
    corpus-style phrases now correctly PASS even when run through the
    answer-text rule directly — proving the Phase 1.1 refinement fixed
    the over-blocking regression found in testing — and (2) a static
    grep confirms the only real call site uses the model's own prose.
    """

    def test_certified_copy_corpus_phrase_passes_even_if_misrouted(self):
        quote = "A certified copy of a public document may be produced as evidence without further proof."
        _, blocked, _ = validate_dhara_text(quote)
        assert blocked is False

    def test_verified_against_specimen_corpus_phrase_passes_even_if_misrouted(self):
        quote = "The officer shall record that the signature has been verified against the specimen on file."
        _, blocked, _ = validate_dhara_text(quote)
        assert blocked is False

    def test_chat_router_never_calls_guard_on_citation_payload(self):
        import pathlib
        src = pathlib.Path(__file__).resolve().parents[1] / "api" / "chat_router.py"
        text = src.read_text(encoding="utf-8")
        # The only call site of validate_dhara_text must operate on
        # `_candidate` (derived from `sanitized`/`full`, the model's own
        # prose) — never on `official_text` or a citation dict.
        assert "validate_dhara_text(_candidate)" in text
        assert "validate_dhara_text(hit" not in text
        assert "validate_dhara_text(official" not in text
        assert "validate_dhara_text(citation" not in text


class TestRefusalDetectionOnlyGatesCitations:
    def test_known_refusal_phrasing_detected(self):
        assert looks_like_refusal("I don't have a verified source for this. Please consult an advocate.") is True
        assert looks_like_refusal("I cannot confirm this from the official text.") is True

    def test_substantive_answer_not_flagged(self):
        assert looks_like_refusal("You can file a complaint at your nearest police station.") is False

    def test_cannot_confirm_message_constant_itself_is_detected_as_refusal(self):
        # So that if the guard substitutes CANNOT_CONFIRM_MESSAGE, a
        # downstream re-check would still correctly suppress citations.
        assert looks_like_refusal(CANNOT_CONFIRM_MESSAGE) is True


class TestAdvocateBadgeRenamedToReviewed:
    """F4 — Phase 1: the 'Advocate Verified' badge label is renamed to
    'Advocate Reviewed' so the label itself can never collide with
    BANNED_WORDS (which includes 'verified'). corpus_db._badge() is the
    single source of this string; this is a golden test for that rename,
    not a new feature test."""

    def test_badge_function_returns_reviewed_not_verified(self):
        from corpus_db import _badge
        doc = {"verify_tier": 1, "verified_by": "adv_123"}
        assert _badge(doc) == "Advocate Reviewed"
        assert _badge(doc) != "Advocate Verified"

    def test_standard_badge_unchanged(self):
        from corpus_db import _badge
        assert _badge({}) == "Sourced from Government of India"

    def test_old_badge_string_would_have_tripped_strict_guard(self):
        # Proves WHY the rename matters: the old label is a zero-tolerance
        # banned-word hit on its own.
        assert contains_banned_word_strict("Advocate Verified") is True

    def test_new_badge_string_passes_strict_guard(self):
        assert contains_banned_word_strict("Advocate Reviewed") is False


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
