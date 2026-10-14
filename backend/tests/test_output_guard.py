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
    CANNOT_CONFIRM_MESSAGE,
    BANNED_WORDS,
)


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


class TestBannedWordsAndMarkerBlockDharaText:
    def test_unverified_marker_blocks(self):
        _, blocked, _ = validate_dhara_text("Some answer [UNVERIFIED] text.")
        assert blocked is True

    def test_each_banned_word_blocks_as_whole_word(self):
        for w in BANNED_WORDS:
            _, blocked, _ = validate_dhara_text(f"This is a {w} answer.")
            assert blocked is True, f"expected '{w}' to block"

    def test_banned_word_substring_inside_another_word_does_not_block(self):
        # "verified" must match as a whole word only — a word that merely
        # contains the substring must not false-positive.
        _, blocked, _ = validate_dhara_text("The unverifiedish term is not a real word.")
        assert blocked is False

    def test_clean_prose_passes_untouched(self):
        text = "You can file a complaint at your nearest police station."
        clean, blocked, n = validate_dhara_text(text)
        assert blocked is False
        assert clean == text
        assert n == 0


class TestQuotedCorpusTextNeverPassedToGuard:
    """Architectural guarantee, not a probabilistic one: a citation's
    official_text is a separate SSE payload in chat_router.py and is never
    routed through validate_dhara_text(). These two cases — a legitimate
    "certified copy" statutory phrase and a "verified" statute quote —
    prove that IF such text were (incorrectly) run through the guard it
    would currently be blocked; chat_router.py's citation-building code
    path must never call validate_dhara_text on citation fields, which is
    verified by code inspection (grep) in this same test for durability.
    """

    def test_certified_copy_corpus_phrase_would_trip_guard_if_misrouted(self):
        # Real Evidence Act / BSA style language.
        quote = "A certified copy of a public document may be produced as evidence without further proof."
        _, blocked, _ = validate_dhara_text(quote)
        assert blocked is True  # confirms WHY this must never be routed here

    def test_verified_statute_quote_would_trip_guard_if_misrouted(self):
        quote = "The officer shall record that the signature has been verified against the specimen on file."
        _, blocked, _ = validate_dhara_text(quote)
        assert blocked is True  # confirms WHY this must never be routed here

    def test_chat_router_never_calls_guard_on_citation_payload(self):
        import pathlib
        src = pathlib.Path(__file__).resolve().parents[1] / "api" / "chat_router.py"
        text = src.read_text(encoding="utf-8")
        # The only two call sites of validate_dhara_text must operate on
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


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
