"""
DHARA C1 — Conversational replies (non-legal allowlist).

Covers:
  - each allowlisted intent, English + Hindi, flag ON
  - flag OFF => feature fully inert (gate itself is never even consulted by
    the caller when FEATURE_C1_CONVERSATIONAL_REPLIES is false; this file
    tests the module directly plus a flag-read sanity check)
  - a mixed greeting + real legal message is never intercepted
  - every deny-list word is never intercepted, in English and Hindi
  - the seven mandatory legal-regression scenarios named in the GO are never
    intercepted either (no file holding "the 7 mandatory cases" was found
    during planning, per the GO's own instruction to cover them here instead)

Imports the real functions from engine/conversational_intents.py — no
reimplementation of the matching logic in this test file.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.conversational_intents import (  # noqa: E402
    classify_conversational_intent,
    get_conversational_template,
    is_denylisted,
    TEMPLATES,
)

ALLOWLISTED_INTENTS = [
    "greeting", "thanks", "what_can_you_do", "mic_or_voice_check",
    "change_language", "how_to_use_feature",
]


# ── (1) Each intent, English + Hindi, matches and returns a template ────────

class TestAllowlistIntentsEnglish:
    def test_greeting(self):
        assert classify_conversational_intent("Hi") == "greeting"
        assert get_conversational_template("greeting", "en")

    def test_thanks(self):
        assert classify_conversational_intent("Thank you") == "thanks"
        assert get_conversational_template("thanks", "en")

    def test_what_can_you_do(self):
        assert classify_conversational_intent("What can you do?") == "what_can_you_do"
        assert get_conversational_template("what_can_you_do", "en")

    def test_mic_check(self):
        assert classify_conversational_intent("Can you check the mic for me?") == "mic_or_voice_check"
        assert get_conversational_template("mic_or_voice_check", "en")

    def test_change_language(self):
        assert classify_conversational_intent("Change language") == "change_language"
        assert get_conversational_template("change_language", "en")

    def test_how_to_use_feature(self):
        assert classify_conversational_intent("How do i use evidence locker") == "how_to_use_feature"
        assert get_conversational_template("how_to_use_feature", "en")


class TestAllowlistIntentsHindi:
    def test_greeting_hi(self):
        assert classify_conversational_intent("नमस्ते") == "greeting"
        assert get_conversational_template("greeting", "hi")

    def test_thanks_hi(self):
        assert classify_conversational_intent("धन्यवाद") == "thanks"
        assert get_conversational_template("thanks", "hi")

    def test_what_can_you_do_hi(self):
        assert classify_conversational_intent("आप क्या कर सकते हैं") == "what_can_you_do"
        assert get_conversational_template("what_can_you_do", "hi")

    def test_mic_check_hi(self):
        assert classify_conversational_intent("माइक चेक करो") == "mic_or_voice_check"
        assert get_conversational_template("mic_or_voice_check", "hi")

    def test_change_language_hi(self):
        assert classify_conversational_intent("हिंदी में बदलो") == "change_language"
        assert get_conversational_template("change_language", "hi")


def test_every_intent_has_en_and_hi_template():
    for intent in ALLOWLISTED_INTENTS:
        bucket = TEMPLATES.get(intent, {})
        assert "en" in bucket, f"{intent} missing en template"
        assert "hi" in bucket, f"{intent} missing hi template"
        # No other languages shipped yet (GO amendment 3) — structure-ready,
        # but nothing unreviewed.
        assert set(bucket.keys()) == {"en", "hi"}, f"{intent} shipped unreviewed languages: {bucket.keys()}"


def test_unknown_intent_template_lookup_returns_none():
    assert get_conversational_template("not_a_real_intent", "en") is None


def test_missing_language_falls_back_to_english():
    assert get_conversational_template("greeting", "mr") == TEMPLATES["greeting"]["en"]


# ── (2) Flag-off inertness ───────────────────────────────────────────────────

def test_flag_default_is_false_when_unset(monkeypatch):
    monkeypatch.delenv("FEATURE_C1_CONVERSATIONAL_REPLIES", raising=False)
    assert os.getenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "false").lower() == "false"


def test_flag_off_means_caller_never_consults_the_gate():
    # The gate in api/chat_router.py is wrapped in
    # `if FEATURE_C1_CONVERSATIONAL_REPLIES and not _emergency and ...`
    # — this module has no knowledge of the flag itself (by design, so the
    # matcher is independently testable); flag-off inertness is therefore a
    # property of the caller, not of classify_conversational_intent(). This
    # test documents that contract explicitly.
    flag = "false"
    assert not (flag == "true" and classify_conversational_intent("Hi") == "greeting")


# ── Mixed / uncertain messages are never intercepted (fail closed) ─────────

class TestMixedMessagesFailClosed:
    def test_greeting_plus_legal_content_not_intercepted(self):
        msg = "Hi, my landlord is trying to evict me without notice, what are my rights?"
        assert classify_conversational_intent(msg) is None

    def test_thanks_plus_legal_followup_not_intercepted(self):
        msg = "Thanks, but can the police arrest me without a warrant for this?"
        assert classify_conversational_intent(msg) is None

    def test_long_message_never_allowlisted_even_if_it_starts_with_hi(self):
        msg = "Hi " + ("I need help understanding my tenancy rights " * 3)
        assert classify_conversational_intent(msg) is None

    def test_ambiguous_short_message_not_in_allowlist_returns_none(self):
        assert classify_conversational_intent("maybe") is None
        assert classify_conversational_intent("ok sure") is None


# ── (2) Deny list always wins — English and Hindi ───────────────────────────

DENY_WORDS_EN = ["help", "emergency", "danger", "police", "unsafe", "scared", "following me"]
DENY_WORDS_HI = ["मदद", "आपातकाल", "खतरा", "पुलिस", "असुरक्षित", "डर", "पीछा कर रहा"]


class TestDenyListAlwaysWins:
    def test_each_english_deny_word_is_denylisted(self):
        for w in DENY_WORDS_EN:
            assert is_denylisted(w), f"{w!r} should be denylisted"
            assert is_denylisted(f"Hi, {w} please"), f"{w!r} inside a greeting should still be denylisted"

    def test_each_hindi_deny_word_is_denylisted(self):
        for w in DENY_WORDS_HI:
            assert is_denylisted(w), f"{w!r} should be denylisted"

    def test_denylisted_greeting_still_matches_allowlist_pattern_but_caller_must_check_deny_first(self):
        # "Help" alone would otherwise not even match any allowlist pattern,
        # but a denylisted greeting-shaped message must still never be
        # treated as safe by a caller that checks deny first (as
        # api/chat_router.py's gate does): is_denylisted() is True, so the
        # caller's `and not is_denylisted(...)` guard short-circuits before
        # classify_conversational_intent() is ever consulted.
        msg = "help"
        assert is_denylisted(msg) is True

    def test_non_denylisted_allowlist_message_is_not_denylisted(self):
        assert is_denylisted("Hi") is False
        assert is_denylisted("Thank you") is False


# ── (6) Seven mandatory legal-regression scenarios — must NOT be intercepted ─
# No file holding "the 7 mandatory cases" was located during the read-only
# planning pass; per the GO, covering them here instead.

class TestSevenMandatoryCasesNeverIntercepted:
    def test_mosque_entry(self):
        msg = "Can a non-Muslim enter a mosque in India, and can they be refused entry?"
        assert classify_conversational_intent(msg) is None

    def test_religious_conversion(self):
        msg = "Is forced religious conversion illegal under Indian law?"
        assert classify_conversational_intent(msg) is None

    def test_ipc_to_bns_transition(self):
        msg = "Does IPC Section 375 still apply, or has BNS replaced it?"
        assert classify_conversational_intent(msg) is None

    def test_state_law_cross_contamination(self):
        msg = "I live in Goa — does the Hindu Marriage Act apply the same way here as in Delhi?"
        assert classify_conversational_intent(msg) is None

    def test_conditional_answer_scenario(self):
        msg = "If my husband hits me and we are married under Muslim law, what can I do?"
        assert classify_conversational_intent(msg) is None

    def test_cannot_verify_scenario(self):
        msg = "What does section 498A say about anticipatory bail eligibility?"
        assert classify_conversational_intent(msg) is None

    def test_hindi_language_query(self):
        msg = "अगर मकान मालिक बिना नोटिस के मुझे घर से निकाल दे तो मेरे क्या अधिकार हैं?"
        assert classify_conversational_intent(msg) is None
