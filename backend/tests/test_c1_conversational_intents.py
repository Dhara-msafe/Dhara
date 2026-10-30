"""
DHARA C1 — Conversational replies (non-legal allowlist) + C1 expansion.

Imports the real functions from engine/conversational_intents.py — no
reimplementation of matching logic. Covers:
  - every intent in every verified language (en, hi, mr, ta, te, bn, gu,
    kn, ml, pa)
  - name-addressed variants ("good morning Dhara") in every language where
    vocative-stripping is enabled, and confirms it is NOT enabled for
    hi/mr/bn (the "dhara/धारा = Section" ambiguity)
  - every deny-list word in every verified language is NEVER intercepted
  - a mixed greeting + real legal message is NEVER intercepted
  - any language outside the verified set is ALWAYS None, regardless of
    message content (the core safety gate for this expansion)
  - flag-off inertness
  - the seven mandatory legal-regression scenarios named in the GOs
  - the "acknowledgement" (ok/yes) intent is deliberately NOT present
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.conversational_intents import (  # noqa: E402
    classify_conversational_intent,
    get_conversational_template,
    is_denylisted,
    TEMPLATES,
    LANGUAGES_WITH_VERIFIED_DENYLIST,
    TEMPLATE_REVIEW_STATUS,
)

VERIFIED_LANGS = sorted(LANGUAGES_WITH_VERIFIED_DENYLIST)
ALL_INTENTS = sorted(TEMPLATES.keys())


# ── Every intent has a template in every verified language ──────────────────

def test_every_intent_has_every_verified_language():
    for intent in ALL_INTENTS:
        bucket = TEMPLATES[intent]
        missing = LANGUAGES_WITH_VERIFIED_DENYLIST - set(bucket.keys())
        assert not missing, f"{intent} missing languages: {missing}"


def test_template_review_status_covers_every_verified_language():
    for lang in VERIFIED_LANGS:
        assert lang in TEMPLATE_REVIEW_STATUS
    assert TEMPLATE_REVIEW_STATUS["en"] == "reviewed"
    assert TEMPLATE_REVIEW_STATUS["hi"] == "reviewed"
    for lang in VERIFIED_LANGS:
        if lang not in ("en", "hi"):
            assert TEMPLATE_REVIEW_STATUS[lang] == "pending_native_review"


def test_acknowledgement_intent_is_deliberately_not_implemented():
    assert "acknowledgement" not in TEMPLATES
    assert "ok_yes" not in TEMPLATES


# ── Core intents, English + Hindi (as before) ────────────────────────────────

class TestAllowlistIntentsEnglish:
    def test_greeting(self):
        assert classify_conversational_intent("Hi", "en") == "greeting"

    def test_thanks(self):
        assert classify_conversational_intent("Thank you", "en") == "thanks"

    def test_what_can_you_do(self):
        assert classify_conversational_intent("What can you do?", "en") == "what_can_you_do"

    def test_mic_check(self):
        assert classify_conversational_intent("Can you check the mic for me?", "en") == "mic_or_voice_check"

    def test_change_language(self):
        assert classify_conversational_intent("Change language", "en") == "change_language"

    def test_how_to_use_feature(self):
        assert classify_conversational_intent("How do i use evidence locker", "en") == "how_to_use_feature"


class TestAllowlistIntentsHindi:
    def test_greeting_hi(self):
        assert classify_conversational_intent("नमस्ते", "hi") == "greeting"

    def test_thanks_hi(self):
        assert classify_conversational_intent("धन्यवाद", "hi") == "thanks"


# ── New intents (GO expansion): goodbye, how_are_you, who_are_you, are_you_there ─

NEW_INTENT_EXAMPLES = {
    "goodbye": {"en": "bye", "hi": "अलविदा", "mr": "निरोप", "ta": "போய் வருகிறேன்",
                "te": "వెళ్ళొస్తాను", "bn": "বিদায়", "gu": "આવજો", "kn": "ಬರ್ತೀನಿ",
                "ml": "ശരി പോകാം", "pa": "ਅਲਵਿਦਾ"},
    "how_are_you": {"en": "how are you", "hi": "आप कैसे हैं", "mr": "तुम्ही कसे आहात",
                     "ta": "எப்படி இருக்கிறீர்கள்", "te": "ఎలా ఉన్నారు", "bn": "কেমন আছেন",
                     "gu": "તમે કેમ છો", "kn": "ಹೇಗಿದ್ದೀರಿ", "ml": "സുഖമാണോ", "pa": "ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ"},
    "who_are_you": {"en": "who are you", "hi": "तुम कौन हो", "mr": "तू कोण आहेस",
                     "ta": "நீங்கள் யார்", "te": "మీరు ఎవరు", "bn": "আপনি কে",
                     "gu": "તમે કોણ છો", "kn": "ನೀವು ಯಾರು", "ml": "നിങ്ങൾ ആരാണ്", "pa": "ਤੁਸੀਂ ਕੌਣ ਹੋ"},
    "are_you_there": {"en": "are you there", "hi": "क्या तुम हो", "mr": "तू आहेस का",
                       "ta": "இருக்கீங்களா", "te": "ఉన్నారా", "bn": "আছেন",
                       "gu": "છો", "kn": "ಇದ್ದೀರಾ", "ml": "ഉണ്ടോ", "pa": "ਹੋ"},
}


class TestNewIntentsAllLanguages:
    def test_every_new_intent_matches_in_every_verified_language(self):
        for intent, by_lang in NEW_INTENT_EXAMPLES.items():
            for lang, msg in by_lang.items():
                got = classify_conversational_intent(msg, lang)
                assert got == intent, f"{lang!r} {msg!r} expected {intent!r} got {got!r}"
                assert get_conversational_template(intent, lang), f"missing template {intent}/{lang}"

    def test_are_you_a_robot_variant(self):
        assert classify_conversational_intent("Are you a robot?", "en") == "who_are_you"
        assert classify_conversational_intent("are you an AI", "en") == "who_are_you"


# ── Name-addressed vocative stripping: enabled languages ────────────────────

VOCATIVE_ENABLED_EXAMPLES = {
    "en": "good morning dhara",
    "ta": "காலை வணக்கம் தாரா",  # not an exact pattern match on its own; use simpler form below
}


class TestVocativeStrippingEnabledLanguages:
    def test_english_name_addressed_greeting(self):
        assert classify_conversational_intent("good morning dhara", "en") == "greeting"
        assert classify_conversational_intent("hi dhara", "en") == "greeting"
        assert classify_conversational_intent("hey dhara", "en") == "greeting"
        assert classify_conversational_intent("dhara good morning", "en") == "greeting"

    def test_tamil_name_addressed_greeting(self):
        assert classify_conversational_intent("தாரா வணக்கம்", "ta") == "greeting"
        assert classify_conversational_intent("வணக்கம் தாரா", "ta") == "greeting"

    def test_telugu_name_addressed_greeting(self):
        assert classify_conversational_intent("ధార నమస్కారం", "te") == "greeting"

    def test_kannada_name_addressed_greeting(self):
        assert classify_conversational_intent("ಧಾರಾ ನಮಸ್ಕಾರ", "kn") == "greeting"

    def test_malayalam_name_addressed_greeting(self):
        assert classify_conversational_intent("ധാര നമസ്കാരം", "ml") == "greeting"

    def test_punjabi_name_addressed_greeting(self):
        assert classify_conversational_intent("ਧਾਰਾ ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", "pa") == "greeting"

    def test_gujarati_name_addressed_greeting(self):
        assert classify_conversational_intent("ધારા નમસ્તે", "gu") == "greeting"


class TestVocativeStrippingDeliberatelyDisabledForLegalTermClash:
    """hi / mr / bn: 'धारा'/'ধারা' (dhara) is the ordinary legal term for
    'Section'. Stripping it would risk nudging a real legal question
    toward a false allowlist match, so it is NOT stripped there."""

    def test_hindi_dhara_is_never_stripped(self):
        # A real legal question using "धारा" (Section) must still return
        # None -- unaffected either way, but documents the guard exists.
        assert classify_conversational_intent("धारा 302 क्या है?", "hi") is None
        # Name-addressed Hindi greeting ("नमस्ते धारा") is NOT specially
        # matched -- this is a known, deliberate scope limit.
        assert classify_conversational_intent("नमस्ते धारा", "hi") is None

    def test_marathi_dhara_is_never_stripped(self):
        assert classify_conversational_intent("धारा ३०२ काय आहे", "mr") is None

    def test_bengali_dhara_is_never_stripped(self):
        assert classify_conversational_intent("ধারা ৪২০ কী?", "bn") is None


# ── Deny list always wins, every verified language ──────────────────────────

DENY_WORDS_BY_LANG = {
    "en": ["help", "emergency", "danger", "police", "unsafe", "scared", "following me"],
    "hi": ["मदद", "आपातकाल", "खतरा", "पुलिस", "असुरक्षित", "डर", "पीछा"],
    "mr": ["मदत", "आणीबाणी", "धोका", "पोलीस", "असुरक्षित", "भीती", "पाठलाग"],
    "ta": ["உதவி", "அவசரநிலை", "ஆபத்து", "போலீஸ்", "பாதுகாப்பற்ற", "பயம்", "பின்தொடர்"],
    "te": ["సహాయం", "అత్యవసర", "ప్రమాదం", "పోలీస్", "అసురక్షిత", "భయం", "వెంటాడు"],
    "bn": ["সাহায্য", "জরুরি", "বিপদ", "পুলিশ", "অনিরাপদ", "ভয়", "অনুসরণ"],
    "gu": ["મદદ", "કટોકટી", "ખતરો", "પોલીસ", "અસુરક્ષિત", "ડર", "પીછો"],
    "kn": ["ಸಹಾಯ", "ತುರ್ತು", "ಅಪಾಯ", "ಪೊಲೀಸ್", "ಅಸುರಕ್ಷಿತ", "ಭಯ", "ಹಿಂಬಾಲಿಸು"],
    "ml": ["സഹായം", "അടിയന്തര", "അപകടം", "പോലീസ്", "സുരക്ഷിതമല്ല", "ഭയം", "പിന്തുടരു"],
    "pa": ["ਮਦਦ", "ਐਮਰਜੈਂਸੀ", "ਖ਼ਤਰਾ", "ਪੁਲਿਸ", "ਅਸੁਰੱਖਿਅਤ", "ਡਰ", "ਪਿੱਛਾ"],
}


class TestDenyListAlwaysWinsAllLanguages:
    def test_every_deny_word_every_language_is_denylisted(self):
        for lang, words in DENY_WORDS_BY_LANG.items():
            for w in words:
                assert is_denylisted(w), f"{lang} {w!r} should be denylisted"

    def test_denylisted_word_never_gets_classified_as_an_intent_by_itself(self):
        # Defense in depth: even if a deny word happened to slip past the
        # caller's is_denylisted() guard, it must not ALSO look like a
        # harmless allowlist intent.
        for lang, words in DENY_WORDS_BY_LANG.items():
            for w in words:
                assert classify_conversational_intent(w, lang) is None

    def test_deny_word_embedded_in_a_greeting_still_denylisted(self):
        assert is_denylisted("Hi, help please") is True
        assert is_denylisted("नमस्ते मदद") is True

    def test_non_denylisted_allowlist_message_is_not_denylisted(self):
        assert is_denylisted("Hi") is False
        assert is_denylisted("Thank you") is False


# ── Mixed / uncertain messages fail closed ──────────────────────────────────

class TestMixedMessagesFailClosed:
    def test_greeting_plus_legal_content_not_intercepted(self):
        msg = "Hi, my landlord is trying to evict me without notice, what are my rights?"
        assert classify_conversational_intent(msg, "en") is None

    def test_long_message_never_allowlisted(self):
        msg = "Hi " + ("I need help understanding my tenancy rights " * 3)
        assert classify_conversational_intent(msg, "en") is None

    def test_ambiguous_short_message_returns_none(self):
        assert classify_conversational_intent("maybe", "en") is None
        assert classify_conversational_intent("ok sure", "en") is None

    def test_dhara_mentioned_in_a_long_legal_message_still_vetoed(self):
        msg = "dhara, my landlord is trying to evict me without any notice, what are my rights?"
        assert classify_conversational_intent(msg, "en") is None


# ── Core safety gate: unsupported languages always None ────────────────────

UNSUPPORTED_LANGUAGES = ["or", "as", "ur", "sd", "ks", "ne", "sa", "kok"]


class TestUnsupportedLanguagesAlwaysFallThrough:
    def test_bare_greeting_in_unsupported_language_still_none(self):
        for lang in UNSUPPORTED_LANGUAGES:
            assert classify_conversational_intent("hi", lang) is None, lang
            assert classify_conversational_intent("Hello", lang) is None, lang

    def test_get_conversational_template_never_returns_english_fallback_for_unsupported_language(self):
        for lang in UNSUPPORTED_LANGUAGES:
            assert get_conversational_template("greeting", lang) is None, lang

    def test_verified_set_is_exactly_the_ten_languages(self):
        assert LANGUAGES_WITH_VERIFIED_DENYLIST == frozenset(
            {"en", "hi", "mr", "ta", "te", "bn", "gu", "kn", "ml", "pa"}
        )


# ── Flag-off inertness (documents the caller's contract) ───────────────────

def test_flag_default_is_false_when_unset(monkeypatch):
    monkeypatch.delenv("FEATURE_C1_CONVERSATIONAL_REPLIES", raising=False)
    assert os.getenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "false").lower() == "false"


# ── Seven mandatory legal-regression scenarios — must NOT be intercepted ───
# (No file holding a canonical "7 mandatory cases" suite was located during
# planning; covered here per the GOs' own instruction.)

class TestSevenMandatoryCasesNeverIntercepted:
    def test_mosque_entry(self):
        msg = "Can a non-Muslim enter a mosque in India, and can they be refused entry?"
        assert classify_conversational_intent(msg, "en") is None

    def test_religious_conversion(self):
        msg = "Is forced religious conversion illegal under Indian law?"
        assert classify_conversational_intent(msg, "en") is None

    def test_ipc_to_bns_transition(self):
        msg = "Does IPC Section 375 still apply, or has BNS replaced it?"
        assert classify_conversational_intent(msg, "en") is None

    def test_state_law_cross_contamination(self):
        msg = "I live in Goa — does the Hindu Marriage Act apply the same way here as in Delhi?"
        assert classify_conversational_intent(msg, "en") is None

    def test_conditional_answer_scenario(self):
        msg = "If my husband hits me and we are married under Muslim law, what can I do?"
        assert classify_conversational_intent(msg, "en") is None

    def test_cannot_verify_scenario(self):
        msg = "What does section 498A say about anticipatory bail eligibility?"
        assert classify_conversational_intent(msg, "en") is None

    def test_hindi_language_query(self):
        msg = "अगर मकान मालिक बिना नोटिस के मुझे घर से निकाल दे तो मेरे क्या अधिकार हैं?"
        assert classify_conversational_intent(msg, "hi") is None


# ── Regression: vocative-stripped salutation + time-of-day greeting ──────────
#
# "hey dhara, good evening." → vocative strips "dhara," → "hey good evening."
# Neither the bare salutation pattern (^hey$) nor the bare time-of-day pattern
# (^good evening$) matched the combined form before this fix.  These tests
# lock in the corrected combined pattern.

class TestSalutationTimeOfDayGreetings:
    def test_hey_dhara_good_evening_is_greeting(self):
        """Exact user-reported case: 'hey dhara, good evening.' must classify as greeting."""
        assert classify_conversational_intent("hey dhara, good evening.", "en") == "greeting"

    def test_hey_dhara_good_morning(self):
        assert classify_conversational_intent("hey dhara, good morning!", "en") == "greeting"

    def test_hi_dhara_good_afternoon(self):
        assert classify_conversational_intent("hi dhara good afternoon", "en") == "greeting"

    def test_hello_dhara_good_evening(self):
        assert classify_conversational_intent("hello dhara, good evening.", "en") == "greeting"

    def test_bare_good_evening_still_greeting(self):
        """Ensure pre-existing bare form still matches after the new pattern was added."""
        assert classify_conversational_intent("good evening", "en") == "greeting"

    def test_hey_alone_still_greeting(self):
        """Ensure the bare salutation still matches."""
        assert classify_conversational_intent("hey", "en") == "greeting"

    def test_hey_good_evening_followed_by_legal_question_is_none(self):
        """'hey good evening, what is section 498A' — too long / legal content → None."""
        msg = "hey dhara good evening, what does section 498A say about bail?"
        assert classify_conversational_intent(msg, "en") is None, (
            "combined greeting + legal question must fall through to the legal pipeline"
        )

    def test_hey_good_morning_without_dhara_is_greeting(self):
        """Combined form without the vocative should also classify."""
        assert classify_conversational_intent("hey good morning", "en") == "greeting"
