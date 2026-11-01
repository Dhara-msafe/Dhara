"""
DHARA C1 — Conversational replies (non-legal allowlist).

Deterministic, non-LLM matcher for a small set of non-legal conversational
intents. Returns a fixed, human-written template in the user's language —
never LLM-generated, and this module never touches the legal pipeline,
retrieval, or engine/output_guard.py in any way.

Safety contract (do not weaken without a fresh GO):
  - LANGUAGES_WITH_VERIFIED_DENYLIST is the single source of truth for which
    languages this module serves AT ALL. classify_conversational_intent()
    refuses to match (returns None) for any other language, no matter what
    the message looks like — that language falls through to the normal
    legal pipeline untouched. The app ships ~20 languages (see
    app/language.tsx); only the 10 below have a deny-list this module's
    author has verified (via the test suite) to actually catch help/
    emergency/danger/police/unsafe/scared/following-me in that language.
    Adding a language here REQUIRES adding and testing its deny words first.
  - The deny list ALWAYS wins. is_denylisted() is checked by the caller
    (api/chat_router.py) BEFORE this module's classifier is even consulted,
    and exported here so tests exercise the same definition the caller
    uses. It is deliberately checked across ALL verified languages at once
    (not gated by the message's declared language) — a user can type a
    danger word in any script and it must still be caught.
  - This is an ALLOWLIST, not a keyword scanner: only near-exact / tightly
    bounded patterns qualify. Anything uncertain returns None (fail closed
    into the normal legal pipeline — chat_router.py's existing behaviour,
    unchanged for a None result).
  - A length cap AND a canonical-action veto (reusing query_parser.py's own
    action vocabulary) each independently disqualify a match, on the
    ORIGINAL unstripped message. Both only ever narrow matches.
  - Vocative name-stripping ("good morning Dhara" -> "good morning") is
    applied ONLY for languages where "Dhara"/its transliteration has no
    other meaning: en, ta, te, kn, ml, pa, gu. It is deliberately NOT
    applied for hi, mr, bn — in all three, "धारा"/"ধারা" (dhara) is the
    ordinary legal term for "Section" (e.g. "धारा 302 क्या है?" — "What is
    Section 302?"), so stripping it there risks nudging a real legal
    question toward a false match.
  - The "acknowledgement" intent (bare "ok"/"yes") requested in a later GO
    revision is DELIBERATELY NOT implemented here: this app tracks
    multi-turn matter/case state, and a bare "yes" is far more likely to be
    a reply to the assistant's own pending question than a greeting-style
    utterance. Intercepting it with a canned "Okay!" risks silently
    swallowing a real legal answer, which violates "fail closed when
    uncertain" far more seriously than skipping the intent. This needs its
    own GO with conversation-state awareness, not a stateless regex.
  - TEMPLATE_REVIEW_STATUS records which languages' template WORDING is
    "reviewed" (written directly, not translated) vs "pending_native_review"
    (translated by this module's author, a non-native speaker, without a
    professional/native review pass yet). The deny-list words themselves are
    tested, not merely translated, for every language in
    LANGUAGES_WITH_VERIFIED_DENYLIST regardless of this status.
"""
from __future__ import annotations

import re
from typing import Optional

from engine.query_parser import _CANONICAL_ACTIONS

# ── Tunables ──────────────────────────────────────────────────────────────────

_MAX_LEN = 60  # messages longer than this are never allowlisted

_ACTION_WORDS = [w.strip().replace("_", " ") for w in _CANONICAL_ACTIONS.split(",") if w.strip()]
_ACTION_VETO_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in _ACTION_WORDS) + r")\b", re.I)

# The only languages this module serves. Every other shipped language
# (app/language.tsx has ~20) falls through to the normal legal pipeline,
# by design, until its deny-list is written and tested here.
LANGUAGES_WITH_VERIFIED_DENYLIST = frozenset({"en", "hi", "mr", "ta", "te", "bn", "gu", "kn", "ml", "pa"})

TEMPLATE_REVIEW_STATUS: dict[str, str] = {
    "en": "reviewed",
    "hi": "reviewed",
    "mr": "pending_native_review",
    "ta": "pending_native_review",
    "te": "pending_native_review",
    "bn": "pending_native_review",
    "gu": "pending_native_review",
    "kn": "pending_native_review",
    "ml": "pending_native_review",
    "pa": "pending_native_review",
}

# ── Deny list — overrides the allowlist, always ─────────────────────────────
# Covers help, emergency, danger, police, unsafe, scared, "following me" and
# their equivalents in every verified language. Checked across all of them
# at once, regardless of the message's declared language.
_DENY_WORDS_BY_LANG: dict[str, list[str]] = {
    "en": [r"\bhelp\b", r"\bemergency\b", r"\bdanger\b", r"\bpolice\b", r"\bunsafe\b", r"\bscared\b", r"\bfollowing me\b"],
    "hi": [r"मदद", r"आपातकाल", r"खतरा", r"पुलिस", r"असुरक्षित", r"डर", r"पीछा"],
    "mr": [r"मदत", r"आणीबाणी", r"धोका", r"पोलीस", r"असुरक्षित", r"भीती", r"घाबर", r"पाठलाग"],
    "ta": [r"உதவி", r"அவசரநிலை", r"ஆபத்து", r"போலீஸ்", r"காவல்", r"பாதுகாப்பற்ற", r"பயம்", r"பின்தொடர்"],
    "te": [r"సహాయం", r"అత్యవసర", r"ప్రమాదం", r"పోలీస్", r"అసురక్షిత", r"భయం", r"వెంబడి", r"వెంటాడు"],
    "bn": [r"সাহায্য", r"জরুরি", r"বিপদ", r"পুলিশ", r"অনিরাপদ", r"ভয়", r"অনুসরণ"],
    "gu": [r"મદદ", r"કટોકટી", r"ખતરો", r"પોલીસ", r"અસુરક્ષિત", r"ડર", r"પીછો"],
    "kn": [r"ಸಹಾಯ", r"ತುರ್ತು", r"ಅಪಾಯ", r"ಪೊಲೀಸ್", r"ಅಸುರಕ್ಷಿತ", r"ಭಯ", r"ಹಿಂಬಾಲಿಸು"],
    "ml": [r"സഹായം", r"അടിയന്തര", r"അപകടം", r"പോലീസ്", r"സുരക്ഷിതമല്ല", r"ഭയം", r"പിന്തുടരു"],
    "pa": [r"ਮਦਦ", r"ਐਮਰਜੈਂਸੀ", r"ਖ਼ਤਰਾ", r"ਪੁਲਿਸ", r"ਅਸੁਰੱਖਿਅਤ", r"ਡਰ", r"ਪਿੱਛਾ"],
}
_ALL_DENY_PATTERNS = [p for words in _DENY_WORDS_BY_LANG.values() for p in words]
_DENY_RE = re.compile("|".join(_ALL_DENY_PATTERNS), re.I)


def is_denylisted(message: str) -> bool:
    """True if the message contains any deny-listed help/danger/police word
    in ANY verified language. Deny always wins over the allowlist."""
    return bool(_DENY_RE.search(message or ""))


# ── Bare-distress gate — short exact panic phrases in all 10 languages ──────
# These match ONLY very short bare phrases like "help", "help me", "bachao",
# "உதவி" etc.  The ^…$ anchors mean longer messages with legal context
# (e.g. "help me file an FIR") are NOT caught here and continue to the
# normal legal pipeline unchanged.  This gate runs BEFORE the deny-list in
# chat_router.py because "help" and "bachao" ARE on the deny-list — but a
# user typing only these words is more likely in distress than filing a query,
# and a caring reply with emergency numbers is a far better UX than a
# "cannot confirm from official text" corpus miss.
_BARE_DISTRESS_PHRASES: list[str] = [
    # English
    "help", "help me", "help please", "help me please",
    "please help", "please help me", "need help", "i need help",
    "sos", "mayday",
    "bachao", "bachao mujhe",
    # Hindi
    "मदद", "मदद करो", "मदद चाहिए", "मदद करो मुझे", "बचाओ", "बचाओ मुझे",
    # Marathi
    "मदत", "मदत करा", "मदत हवी", "वाचवा",
    # Tamil
    "உதவி", "உதவி செய்யுங்கள்", "உதவி வேண்டும்",
    # Telugu
    "సహాయం", "సహాయం చేయండి", "సహాయం కావాలి",
    # Bengali
    "সাহায্য", "সাহায্য করুন", "সাহায্য দরকার",
    # Gujarati
    "મદદ", "મદદ કરો", "મદદ જોઈએ",
    # Kannada
    "ಸಹಾಯ", "ಸಹಾಯ ಮಾಡಿ", "ಸಹಾಯ ಬೇಕು",
    # Malayalam
    "സഹായം", "സഹായം ചെയ്യൂ", "സഹായം വേണം",
    # Punjabi
    "ਮਦਦ", "ਮਦਦ ਕਰੋ", "ਮਦਦ ਚਾਹੀਦੀ",
]
_BARE_DISTRESS_RE = re.compile(
    r"^(?:" + "|".join(re.escape(p) for p in _BARE_DISTRESS_PHRASES) + r")[\s!?.,।॥]*$",
    re.IGNORECASE | re.UNICODE,
)


def is_bare_distress(message: str) -> bool:
    """True for very short bare panic/distress phrases only (e.g. "help",
    "help me", "bachao", "உதவி").  Longer messages with context (e.g.
    "help me file an FIR") return False and flow to the legal pipeline
    unchanged.  Internal whitespace is normalised so "help  me" (double
    space) matches the same as "help me".
    """
    normalised = " ".join((message or "").strip().split())
    return bool(_BARE_DISTRESS_RE.match(normalised))


# ── Vocative name-stripping ("good morning Dhara" -> "good morning") ───────
# Only for languages where the transliterated name has no other legal
# meaning. NOT hi / mr / bn (see module docstring).
_VOCATIVE_RE = re.compile(
    r"\bdhara\b[,!]?\s*"       # English
    r"|தாரா[,!]?\s*"           # Tamil
    r"|ధార[,!]?\s*"            # Telugu
    r"|ಧಾರಾ[,!]?\s*"           # Kannada
    r"|ധാര[,!]?\s*"            # Malayalam
    r"|ਧਾਰਾ[,!]?\s*"           # Punjabi
    r"|ધારા[,!]?\s*",          # Gujarati
    re.I,
)


def _normalize(message: str) -> str:
    raw = (message or "").strip().lower()
    stripped = re.sub(r"\s+", " ", _VOCATIVE_RE.sub(" ", raw)).strip()
    return stripped if stripped else raw


# intent key -> list of near-exact phrase patterns across all 10 languages
_INTENT_PATTERNS: dict[str, list[str]] = {
    "greeting": [
        r"^(hi|hello|hey|hola|namaste|namaskar)[\s!.,]*$",
        r"^good\s*(morning|afternoon|evening)[\s!.,]*$",
        # Combined: salutation + time-of-day — e.g. "hey good evening" which
        # appears after vocative-stripping "hey dhara, good evening" → "hey good evening".
        # The vocative regex removes the name but leaves the leading salutation,
        # so "hey good morning" would never match either bare pattern above.
        r"^(hi|hello|hey|hola|namaste|namaskar)[,\s]+good\s*(morning|afternoon|evening)[\s!.,]*$",
        r"^(नमस्ते|नमस्कार|हाय|हैलो)[\s!।,]*$",
        r"^नमस्कार[\s!।,]*$",
        r"^(வணக்கம்|ஹாய்|ஹலோ)[\s!.,]*$",
        r"^(నమస్కారం|హాయ్|హలో)[\s!.,]*$",
        r"^(নমস্কার|হ্যালো|হাই)[\s!.,]*$",
        r"^(નમસ્તે|નમસ્કાર|હાય|હેલો)[\s!.,]*$",
        r"^(ನಮಸ್ಕಾರ|ಹಾಯ್|ಹಲೋ)[\s!.,]*$",
        r"^(നമസ്കാരം|ഹായ്|ഹലോ)[\s!.,]*$",
        r"^(ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ|ਹੈਲੋ|ਹਾਏ)[\s!.,]*$",
    ],
    "goodbye": [
        r"^(bye|goodbye|bye bye|see you|good night)[\s!.,]*$",
        r"^(अलविदा|फिर मिलेंगे|शुभ रात्रि)[\s!।,]*$",
        r"^(निरोप|पुन्हा भेटू)[\s!।,]*$",
        r"^(போய் வருகிறேன்|பிறகு பார்க்கலாம்)[\s!.,]*$",
        r"^(వెళ్ళొస్తాను|మళ్ళీ కలుద్దాం)[\s!.,]*$",
        r"^(বিদায়|পরে দেখা হবে)[\s!.,]*$",
        r"^(આવજો|પછી મળીએ)[\s!.,]*$",
        r"^(ಬರ್ತೀನಿ|ನಂತರ ಸಿಗೋಣ)[\s!.,]*$",
        r"^(ശരി പോകാം|പിന്നെ കാണാം)[\s!.,]*$",
        r"^(ਅਲਵਿਦਾ|ਫਿਰ ਮਿਲਾਂਗੇ)[\s!.,]*$",
    ],
    "thanks": [
        r"^(thanks?|thank\s*you|thx|ty)[\s!.,]*$",
        r"^(धन्यवाद|शुक्रिया)[\s!।,]*$",
        r"^(आभारी आहे|धन्यवाद)[\s!।,]*$",
        r"^(நன்றி)[\s!.,]*$",
        r"^(ధన్యవాదాలు)[\s!.,]*$",
        r"^(ধন্যবাদ)[\s!.,]*$",
        r"^(આભાર|ધન્યવાદ)[\s!.,]*$",
        r"^(ಧನ್ಯವಾದ)[\s!.,]*$",
        r"^(നന്ദി)[\s!.,]*$",
        r"^(ਧੰਨਵਾਦ)[\s!.,]*$",
    ],
    "how_are_you": [
        r"^how are you[\s?]*$",
        r"^how r u[\s?]*$",
        r"^(आप कैसे हैं|कैसे हो)[\s?।]*$",
        r"^(तुम्ही कसे आहात|कसा आहेस)[\s?।]*$",
        r"^(எப்படி இருக்கிறீர்கள்)[\s?]*$",
        r"^(ఎలా ఉన్నారు)[\s?]*$",
        r"^(কেমন আছেন)[\s?]*$",
        r"^(તમે કેમ છો)[\s?]*$",
        r"^(ಹೇಗಿದ್ದೀರಿ)[\s?]*$",
        r"^(സുഖമാണോ|എങ്ങനെയുണ്ട്)[\s?]*$",
        r"^(ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ)[\s?]*$",
    ],
    "who_are_you": [
        r"^who are you[\s?]*$",
        r"^are you (a |an )?(robot|bot|ai|human)[\s?]*$",
        r"^(तुम कौन हो|आप कौन हैं)[\s?।]*$",
        r"^(क्या तुम रोबोट हो)[\s?।]*$",
        r"^(तू कोण आहेस|तुम्ही कोण आहात)[\s?।]*$",
        r"^(நீங்கள் யார்)[\s?]*$",
        r"^(మీరు ఎవరు)[\s?]*$",
        r"^(আপনি কে)[\s?]*$",
        r"^(તમે કોણ છો)[\s?]*$",
        r"^(ನೀವು ಯಾರು)[\s?]*$",
        r"^(നിങ്ങൾ ആരാണ്)[\s?]*$",
        r"^(ਤੁਸੀਂ ਕੌਣ ਹੋ)[\s?]*$",
    ],
    "are_you_there": [
        r"^(are you (still )?there|you there|hello\?+)[\s?]*$",
        r"^(क्या तुम हो|हैलो\?*)[\s?।]*$",
        r"^(तू आहेस का)[\s?।]*$",
        r"^(இருக்கீங்களா)[\s?]*$",
        r"^(ఉన్నారా)[\s?]*$",
        r"^(আছেন\?*)[\s?]*$",
        r"^(છો\?*)[\s?]*$",
        r"^(ಇದ್ದೀರಾ)[\s?]*$",
        r"^(ഉണ്ടോ)[\s?]*$",
        r"^(ਹੋ\?*)[\s?]*$",
    ],
    "what_can_you_do": [
        r"^what (can|do) you do[\s?]*$",
        r"^what is dhara[\s?]*$",
        r"^(तुम|आप) क्या कर सकते (हो|हैं)[\s?।]*$",
        r"^धारा क्या है[\s?।]*$",
        r"^तू काय करू शकतोस[\s?।]*$",
        r"^(நீங்கள் என்ன செய்ய முடியும்)[\s?]*$",
        r"^(మీరు ఏమి చేయగలరు)[\s?]*$",
        r"^(আপনি কী করতে পারেন)[\s?]*$",
        r"^(તમે શું કરી શકો છો)[\s?]*$",
        r"^(ನೀವು ಏನು ಮಾಡಬಹುದು)[\s?]*$",
        r"^(നിങ്ങൾക്ക് എന്ത് ചെയ്യാൻ കഴിയും)[\s?]*$",
        r"^(ਤੁਸੀਂ ਕੀ ਕਰ ਸਕਦੇ ਹੋ)[\s?]*$",
    ],
    "mic_or_voice_check": [
        r"^(can you )?check (the |my )?mic(rophone)?( for me)?[\s?.,]*$",
        r"^(is )?(my |the )?mic(rophone)? working[\s?.,]*$",
        r"^(mic|voice) test[\s?.,]*$",
        r"^माइक (चेक|टेस्ट) कर(ो|ें)[\s?।,]*$",
        r"^माईक (चेक|टेस्ट) कर[\s?।,]*$",
    ],
    "change_language": [
        r"^(switch|change)( the)? language( to [a-z]+)?[\s?.,]*$",
        r"^(हिंदी|अंग्रेज़ी|अंग्रेजी)( में)? (भाषा )?बदलो[\s?।,]*$",
    ],
    "how_to_use_feature": [
        r"^how (do i|to) use (the |my )?[a-z ]{1,30}[\s?.,]*$",
        r"^[a-z ]{1,30} kaise (use|istemal) kare[\s?.,]*$",
    ],
}

_COMPILED: dict[str, list[re.Pattern]] = {
    k: [re.compile(p, re.I) for p in v] for k, v in _INTENT_PATTERNS.items()
}


def classify_conversational_intent(message: str, language: str = "en") -> Optional[str]:
    """Return an allowlisted intent key, or None (fail closed).

    Every rule here can only narrow matches, never widen them:
      1. language not in LANGUAGES_WITH_VERIFIED_DENYLIST -> None, always
         (that language has no tested deny-list here, so it must never get
         a template reply, no matter what the message looks like)
      2. empty / over length cap -> None
      3. any canonical legal-action word present -> None
      4. otherwise, first exact pattern match (across all languages) wins
    """
    if language not in LANGUAGES_WITH_VERIFIED_DENYLIST:
        return None
    if not message:
        return None
    raw = message.strip()
    if len(raw) > _MAX_LEN:
        return None
    if _ACTION_VETO_RE.search(raw):
        return None
    norm = _normalize(raw)
    raw_lower = raw.lower()
    for intent, patterns in _COMPILED.items():
        for pat in patterns:
            # Try the vocative-stripped+lowercased form first (primary path),
            # then fall back to the plain-lowercased raw message.  This ensures
            # queries like "what is dhara" are not accidentally broken by the
            # vocative stripper (which removes the word even when it is the
            # OBJECT of the question, not an address).  Both paths are guarded
            # by the same length cap and action-word veto above.
            if pat.match(norm) or pat.match(raw_lower):
                return intent
    return None


# ── Templates ────────────────────────────────────────────────────────────────
# en/hi: written directly (TEMPLATE_REVIEW_STATUS = "reviewed").
# mr/ta/te/bn/gu/kn/ml/pa: machine-translated by this module's author (not a
# native speaker) — TEMPLATE_REVIEW_STATUS = "pending_native_review". Short,
# plain, non-legal sentences only; never LLM-generated.
TEMPLATES: dict[str, dict[str, str]] = {
    "greeting": {
        "en": "Hello! I'm DHARA. Ask me about any Indian law question, or tell me what's happening and I'll help you understand your rights.",
        "hi": "नमस्ते! मैं धारा हूं। मुझसे भारतीय कानून से जुड़ा कोई भी सवाल पूछें, या बताइए क्या हुआ है — मैं आपके अधिकार समझने में मदद करूंगी।",
        "mr": "नमस्कार! मी धारा आहे. मला भारतीय कायद्याबद्दल कोणताही प्रश्न विचारा, किंवा काय झाले ते सांगा — मी तुम्हाला तुमचे हक्क समजून घेण्यास मदत करेन.",
        "ta": "வணக்கம்! நான் தாரா. இந்திய சட்டம் பற்றிய எந்த கேள்வியையும் கேளுங்கள், அல்லது என்ன நடந்தது என்று சொல்லுங்கள் — உங்கள் உரிமைகளை புரிந்துகொள்ள உதவுகிறேன்.",
        "te": "నమస్కారం! నేను ధార. భారత చట్టానికి సంబంధించిన ఏ ప్రశ్నైనా అడగండి, లేదా ఏమి జరిగిందో చెప్పండి — మీ హక్కులను అర్థం చేసుకోవడంలో సహాయం చేస్తాను.",
        "bn": "নমস্কার! আমি ধারা। ভারতীয় আইন সম্পর্কে যেকোনো প্রশ্ন জিজ্ঞাসা করুন, বা কী হয়েছে বলুন — আপনার অধিকার বুঝতে সাহায্য করব।",
        "gu": "નમસ્તે! હું ધારા છું. ભારતીય કાયદા વિશે કોઈપણ પ્રશ્ન પૂછો, અથવા શું થયું તે જણાવો — હું તમારા અધિકારો સમજવામાં મદદ કરીશ.",
        "kn": "ನಮಸ್ಕಾರ! ನಾನು ಧಾರಾ. ಭಾರತೀಯ ಕಾನೂನಿನ ಬಗ್ಗೆ ಯಾವುದೇ ಪ್ರಶ್ನೆ ಕೇಳಿ, ಅಥವಾ ಏನಾಯಿತು ಎಂದು ಹೇಳಿ — ನಿಮ್ಮ ಹಕ್ಕುಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲು ಸಹಾಯ ಮಾಡುತ್ತೇನೆ.",
        "ml": "നമസ്കാരം! ഞാൻ ധാര. ഇന്ത്യൻ നിയമത്തെക്കുറിച്ച് എന്ത് ചോദ്യവും ചോദിക്കൂ, അല്ലെങ്കിൽ എന്താണ് സംഭവിച്ചതെന്ന് പറയൂ — നിങ്ങളുടെ അവകാശങ്ങൾ മനസ്സിലാക്കാൻ ഞാൻ സഹായിക്കാം.",
        "pa": "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਧਾਰਾ ਹਾਂ। ਭਾਰਤੀ ਕਾਨੂੰਨ ਬਾਰੇ ਕੋਈ ਵੀ ਸਵਾਲ ਪੁੱਛੋ, ਜਾਂ ਦੱਸੋ ਕੀ ਹੋਇਆ — ਮੈਂ ਤੁਹਾਡੇ ਅਧਿਕਾਰ ਸਮਝਣ ਵਿੱਚ ਮਦਦ ਕਰਾਂਗੀ।",
    },
    "goodbye": {
        "en": "Goodbye! Come back anytime you have a legal question.",
        "hi": "अलविदा! जब भी कोई कानूनी सवाल हो, वापस आइए।",
        "mr": "निरोप! जेव्हा कधी कायदेशीर प्रश्न असेल तेव्हा परत या.",
        "ta": "போய் வருகிறேன்! சட்டம் தொடர்பான கேள்வி இருந்தால் மீண்டும் வாருங்கள்.",
        "te": "వెళ్ళొస్తాను! చట్టపరమైన ప్రశ్న ఉన్నప్పుడు మళ్ళీ రండి.",
        "bn": "বিদায়! আইনি প্রশ্ন থাকলে আবার আসবেন।",
        "gu": "આવજો! કાનૂની પ્રશ્ન હોય ત્યારે ફરી આવો.",
        "kn": "ಬರ್ತೀನಿ! ಕಾನೂನು ಪ್ರಶ್ನೆ ಇದ್ದಾಗ ಮತ್ತೆ ಬನ್ನಿ.",
        "ml": "ശരി, പോകാം! നിയമപരമായ ചോദ്യം ഉള്ളപ്പോൾ വീണ്ടും വരൂ.",
        "pa": "ਅਲਵਿਦਾ! ਜਦੋਂ ਵੀ ਕੋਈ ਕਾਨੂੰਨੀ ਸਵਾਲ ਹੋਵੇ, ਵਾਪਸ ਆਓ।",
    },
    "thanks": {
        "en": "You're welcome! Let me know if you have another legal question.",
        "hi": "आपका स्वागत है! अगर कोई और कानूनी सवाल हो तो बताइए।",
        "mr": "स्वागत आहे! आणखी कायदेशीर प्रश्न असल्यास सांगा.",
        "ta": "பரவாயில்லை! இன்னொரு சட்டம் தொடர்பான கேள்வி இருந்தால் சொல்லுங்கள்.",
        "te": "మీకు స్వాగతం! మరో చట్టపరమైన ప్రశ్న ఉంటే చెప్పండి.",
        "bn": "স্বাগতম! আরেকটি আইনি প্রশ্ন থাকলে জানান।",
        "gu": "આપનું સ્વાગત છે! બીજો કોઈ કાનૂની પ્રશ્ન હોય તો જણાવો.",
        "kn": "ಸ್ವಾಗತ! ಇನ್ನೊಂದು ಕಾನೂನು ಪ್ರಶ್ನೆ ಇದ್ದರೆ ತಿಳಿಸಿ.",
        "ml": "സ്വാഗതം! മറ്റൊരു നിയമപരമായ ചോദ്യമുണ്ടെങ്കിൽ പറയൂ.",
        "pa": "ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ! ਜੇ ਕੋਈ ਹੋਰ ਕਾਨੂੰਨੀ ਸਵਾਲ ਹੋਵੇ ਤਾਂ ਦੱਸੋ।",
    },
    "how_are_you": {
        "en": "I'm doing well, thank you! How can I help with a legal question today?",
        "hi": "मैं ठीक हूं, धन्यवाद! आज किस कानूनी सवाल में मदद करूं?",
        "mr": "मी ठीक आहे, धन्यवाद! आज कोणत्या कायदेशीर प्रश्नात मदत करू?",
        "ta": "நான் நலமாக இருக்கிறேன், நன்றி! இன்று எந்த சட்டப் பிரச்சினையில் உதவலாம்?",
        "te": "నేను బాగున్నాను, ధన్యవాదాలు! ఈరోజు ఏ చట్టపరమైన ప్రశ్నలో సహాయం చేయమంటారు?",
        "bn": "আমি ভালো আছি, ধন্যবাদ! আজ কোন আইনি প্রশ্নে সাহায্য করব?",
        "gu": "હું સારી છું, આભાર! આજે કયા કાનૂની પ્રશ્નમાં મદદ કરું?",
        "kn": "ನಾನು ಚೆನ್ನಾಗಿದ್ದೇನೆ, ಧನ್ಯವಾದ! ಇಂದು ಯಾವ ಕಾನೂನು ಪ್ರಶ್ನೆಯಲ್ಲಿ ಸಹಾಯ ಮಾಡಲಿ?",
        "ml": "എനിക്ക് സുഖമാണ്, നന്ദി! ഇന്ന് ഏത് നിയമപരമായ ചോദ്യത്തിൽ സഹായിക്കണം?",
        "pa": "ਮੈਂ ਠੀਕ ਹਾਂ, ਧੰਨਵਾਦ! ਅੱਜ ਕਿਸ ਕਾਨੂੰਨੀ ਸਵਾਲ ਵਿੱਚ ਮਦਦ ਕਰਾਂ?",
    },
    "who_are_you": {
        "en": "I'm DHARA, an AI assistant that answers Indian legal questions using verified official text — not a human lawyer, and not a replacement for one.",
        "hi": "मैं धारा हूं, एक AI सहायक जो सत्यापित आधिकारिक पाठ के आधार पर भारतीय कानूनी सवालों के जवाब देती है — न कि कोई इंसान वकील, और न ही वकील की जगह।",
        "mr": "मी धारा आहे, एक AI सहाय्यक जी सत्यापित अधिकृत मजकुराच्या आधारे भारतीय कायदेशीर प्रश्नांची उत्तरे देते — मी मानवी वकील नाही, आणि वकिलाची जागा घेत नाही.",
        "ta": "நான் தாரா, சரிபார்க்கப்பட்ட அதிகாரப்பூர்வ உரையைப் பயன்படுத்தி இந்திய சட்டக் கேள்விகளுக்கு பதிலளிக்கும் AI உதவியாளர் — மனித வழக்கறிஞர் அல்ல.",
        "te": "నేను ధార, ధృవీకరించిన అధికారిక పాఠ్యం ఆధారంగా భారతీయ న్యాయపరమైన ప్రశ్నలకు సమాధానమిచ్చే AI సహాయకురాలిని — నేను మానవ న్యాయవాదిని కాదు.",
        "bn": "আমি ধারা, একটি AI সহায়ক যা যাচাইকৃত সরকারি পাঠ্য ব্যবহার করে ভারতীয় আইনি প্রশ্নের উত্তর দেয় — আমি মানব আইনজীবী নই।",
        "gu": "હું ધારા છું, એક AI સહાયક જે ચકાસેલા સત્તાવાર લખાણના આધારે ભારતીય કાનૂની પ્રશ્નોના જવાબ આપે છે — હું માનવ વકીલ નથી.",
        "kn": "ನಾನು ಧಾರಾ, ಪರಿಶೀಲಿಸಿದ ಅಧಿಕೃತ ಪಠ್ಯವನ್ನು ಬಳಸಿ ಭಾರತೀಯ ಕಾನೂನು ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸುವ AI ಸಹಾಯಕಿ — ನಾನು ಮಾನವ ವಕೀಲೆ ಅಲ್ಲ.",
        "ml": "ഞാൻ ധാര, സ്ഥിരീകരിച്ച ഔദ്യോഗിക വാചകം ഉപയോഗിച്ച് ഇന്ത്യൻ നിയമപരമായ ചോദ്യങ്ങൾക്ക് ഉത്തരം നൽകുന്ന AI സഹായി — ഞാൻ ഒരു മനുഷ്യ അഭിഭാഷക അല്ല.",
        "pa": "ਮੈਂ ਧਾਰਾ ਹਾਂ, ਇੱਕ AI ਸਹਾਇਕ ਜੋ ਪ੍ਰਮਾਣਿਤ ਸਰਕਾਰੀ ਪਾਠ ਦੀ ਵਰਤੋਂ ਕਰਕੇ ਭਾਰਤੀ ਕਾਨੂੰਨੀ ਸਵਾਲਾਂ ਦੇ ਜਵਾਬ ਦਿੰਦੀ ਹਾਂ — ਮੈਂ ਇਨਸਾਨ ਵਕੀਲ ਨਹੀਂ ਹਾਂ।",
    },
    "are_you_there": {
        "en": "Yes, I'm here! What legal question can I help with?",
        "hi": "हां, मैं यहां हूं! किस कानूनी सवाल में मदद करूं?",
        "mr": "होय, मी इथे आहे! कोणत्या कायदेशीर प्रश्नात मदत करू?",
        "ta": "ஆம், நான் இருக்கிறேன்! எந்த சட்டக் கேள்வியில் உதவலாம்?",
        "te": "అవును, నేను ఇక్కడ ఉన్నాను! ఏ చట్టపరమైన ప్రశ్నలో సహాయం చేయాలి?",
        "bn": "হ্যাঁ, আমি এখানে আছি! কোন আইনি প্রশ্নে সাহায্য করব?",
        "gu": "હા, હું અહીં છું! કયા કાનૂની પ્રશ્નમાં મદદ કરું?",
        "kn": "ಹೌದು, ನಾನು ಇಲ್ಲಿದ್ದೇನೆ! ಯಾವ ಕಾನೂನು ಪ್ರಶ್ನೆಯಲ್ಲಿ ಸಹಾಯ ಮಾಡಲಿ?",
        "ml": "അതെ, ഞാൻ ഇവിടെയുണ്ട്! ഏത് നിയമപരമായ ചോദ്യത്തിൽ സഹായിക്കണം?",
        "pa": "ਹਾਂ, ਮੈਂ ਇੱਥੇ ਹਾਂ! ਕਿਸ ਕਾਨੂੰਨੀ ਸਵਾਲ ਵਿੱਚ ਮਦਦ ਕਰਾਂ?",
    },
    "what_can_you_do": {
        "en": "I'm DHARA — I answer Indian legal questions (your rights, what the law says, which section applies) using verified official text. I can also help you draft an FIR, look up a court case, or reach your trusted contacts if you're unsafe.",
        "hi": "मैं धारा हूं — मैं भारतीय कानून से जुड़े सवालों के जवाब सत्यापित आधिकारिक पाठ के आधार पर देती हूं (आपके अधिकार, कानून क्या कहता है, कौन-सी धारा लागू होती है)। मैं FIR लिखने में मदद, कोर्ट केस खोजने, या असुरक्षित होने पर आपके भरोसेमंद संपर्कों तक पहुंचने में भी मदद कर सकती हूं।",
        "mr": "मी धारा आहे — मी भारतीय कायद्याशी संबंधित प्रश्नांची उत्तरे सत्यापित अधिकृत मजकुराच्या आधारे देते (तुमचे हक्क, कायदा काय म्हणतो). मी FIR लिहिण्यास मदत, कोर्ट केस शोधणे, किंवा असुरक्षित वाटल्यास विश्वासू संपर्कांपर्यंत पोहोचण्यास मदत करू शकते.",
        "ta": "நான் தாரா — உங்கள் உரிமைகள், சட்டம் என்ன சொல்கிறது என்பதை சரிபார்க்கப்பட்ட அதிகாரப்பூர்வ உரையின் அடிப்படையில் பதிலளிக்கிறேன். FIR எழுத உதவுதல், நீதிமன்ற வழக்கைத் தேடுதல், அல்லது பாதுகாப்பின்மை இருந்தால் நம்பகமான தொடர்புகளை அடைய உதவுதல் ஆகியவற்றிலும் உதவ முடியும்.",
        "te": "నేను ధార — మీ హక్కులు, చట్టం ఏమి చెబుతుంది అనే ప్రశ్నలకు ధృవీకరించిన అధికారిక పాఠ్యం ఆధారంగా సమాధానం ఇస్తాను. FIR రాయడంలో సహాయం, కోర్టు కేసు వెతకడం, లేదా అసురక్షితంగా అనిపిస్తే మీ నమ్మకమైన సంప్రదింపులను చేరుకోవడంలో కూడా సహాయం చేయగలను.",
        "bn": "আমি ধারা — আপনার অধিকার, আইন কী বলে তার উত্তর যাচাইকৃত সরকারি পাঠ্যের ভিত্তিতে দিই। FIR লিখতে সাহায্য, আদালতের মামলা খোঁজা, বা অনিরাপদ বোধ করলে বিশ্বস্ত পরিচিতিদের কাছে পৌঁছাতেও সাহায্য করতে পারি।",
        "gu": "હું ધારા છું — તમારા અધિકારો, કાયદો શું કહે છે તેના જવાબ ચકાસેલા સત્તાવાર લખાણના આધારે આપું છું. FIR લખવામાં મદદ, કોર્ટ કેસ શોધવો, અથવા અસુરક્ષિત લાગે ત્યારે વિશ્વાસુ સંપર્કો સુધી પહોંચવામાં પણ મદદ કરી શકું છું.",
        "kn": "ನಾನು ಧಾರಾ — ನಿಮ್ಮ ಹಕ್ಕುಗಳು, ಕಾನೂನು ಏನು ಹೇಳುತ್ತದೆ ಎಂಬುದಕ್ಕೆ ಪರಿಶೀಲಿಸಿದ ಅಧಿಕೃತ ಪಠ್ಯದ ಆಧಾರದ ಮೇಲೆ ಉತ್ತರಿಸುತ್ತೇನೆ. FIR ಬರೆಯಲು ಸಹಾಯ, ಕೋರ್ಟ್ ಕೇಸ್ ಹುಡುಕುವುದು, ಅಥವಾ ಅಸುರಕ್ಷಿತ ಎನಿಸಿದರೆ ನಿಮ್ಮ ವಿಶ್ವಾಸಾರ್ಹ ಸಂಪರ್ಕಗಳನ್ನು ತಲುಪಲು ಸಹ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ.",
        "ml": "ഞാൻ ധാര — നിങ്ങളുടെ അവകാശങ്ങൾ, നിയമം എന്താണ് പറയുന്നത് എന്നതിന് സ്ഥിരീകരിച്ച ഔദ്യോഗിക വാചകത്തിന്റെ അടിസ്ഥാനത്തിൽ ഉത്തരം നൽകുന്നു. FIR എഴുതാൻ സഹായം, കോടതി കേസ് തിരയൽ, അല്ലെങ്കിൽ സുരക്ഷിതമല്ലെന്ന് തോന്നിയാൽ വിശ്വസ്ത ബന്ധങ്ങളിലെത്താനും സഹായിക്കാം.",
        "pa": "ਮੈਂ ਧਾਰਾ ਹਾਂ — ਤੁਹਾਡੇ ਅਧਿਕਾਰ, ਕਾਨੂੰਨ ਕੀ ਕਹਿੰਦਾ ਹੈ ਇਸ ਦੇ ਜਵਾਬ ਪ੍ਰਮਾਣਿਤ ਸਰਕਾਰੀ ਪਾਠ ਦੇ ਆਧਾਰ ਤੇ ਦਿੰਦੀ ਹਾਂ। FIR ਲਿਖਣ ਵਿੱਚ ਮਦਦ, ਅਦਾਲਤੀ ਕੇਸ ਲੱਭਣਾ, ਜਾਂ ਅਸੁਰੱਖਿਅਤ ਮਹਿਸੂਸ ਹੋਣ ਤੇ ਭਰੋਸੇਯੋਗ ਸੰਪਰਕਾਂ ਤੱਕ ਪਹੁੰਚਣ ਵਿੱਚ ਵੀ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ।",
    },
    "mic_or_voice_check": {
        "en": "I can't test your microphone directly from here, but you can try the mic button on the chat screen — if it shows a waveform or a timer while you hold it, it's working.",
        "hi": "मैं यहां से सीधे आपका माइक्रोफ़ोन जांच नहीं सकती, लेकिन आप चैट स्क्रीन पर माइक बटन आज़मा सकते हैं — दबाए रखने पर वेवफ़ॉर्म या टाइमर दिखे तो यह काम कर रहा है।",
        "mr": "मी इथून थेट तुमचा मायक्रोफोन तपासू शकत नाही, पण तुम्ही चॅट स्क्रीनवरील माईक बटण वापरून पाहू शकता — दाबून ठेवल्यावर वेव्हफॉर्म किंवा टायमर दिसल्यास तो काम करत आहे.",
        "ta": "இங்கிருந்து உங்கள் மைக்ரோஃபோனை நேரடியாக சோதிக்க முடியாது, ஆனால் அரட்டை திரையில் உள்ள மைக் பொத்தானை முயற்சிக்கலாம் — அழுத்தி வைக்கும்போது அலைவடிவம் அல்லது நேரங்காட்டி தெரிந்தால் அது வேலை செய்கிறது.",
        "te": "ఇక్కడ నుండి నేరుగా మీ మైక్రోఫోన్‌ను పరీక్షించలేను, కానీ చాట్ స్క్రీన్‌లోని మైక్ బటన్‌ను ప్రయత్నించండి — నొక్కి ఉంచినప్పుడు వేవ్‌ఫారమ్ లేదా టైమర్ కనిపిస్తే అది పనిచేస్తోంది.",
        "bn": "আমি এখান থেকে সরাসরি আপনার মাইক্রোফোন পরীক্ষা করতে পারি না, তবে চ্যাট স্ক্রিনের মাইক বোতাম চেষ্টা করুন — ধরে রাখলে ওয়েভফর্ম বা টাইমার দেখালে এটি কাজ করছে।",
        "gu": "હું અહીંથી સીધી તમારો માઇક્રોફોન ચકાસી શકતી નથી, પણ ચેટ સ્ક્રીન પરનું માઇક બટન અજમાવો — દબાવી રાખો ત્યારે વેવફોર્મ અથવા ટાઈમર દેખાય તો તે કામ કરે છે.",
        "kn": "ಇಲ್ಲಿಂದ ನೇರವಾಗಿ ನಿಮ್ಮ ಮೈಕ್ರೊಫೋನ್ ಪರೀಕ್ಷಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ, ಆದರೆ ಚಾಟ್ ಪರದೆಯಲ್ಲಿರುವ ಮೈಕ್ ಬಟನ್ ಪ್ರಯತ್ನಿಸಿ — ಒತ್ತಿ ಹಿಡಿದಾಗ ವೇವ್‌ಫಾರ್ಮ್ ಅಥವಾ ಟೈಮರ್ ಕಂಡರೆ ಅದು ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತಿದೆ.",
        "ml": "ഇവിടെ നിന്ന് നേരിട്ട് നിങ്ങളുടെ മൈക്രോഫോൺ പരിശോധിക്കാനാകില്ല, എന്നാൽ ചാറ്റ് സ്ക്രീനിലെ മൈക്ക് ബട്ടൺ പരീക്ഷിക്കൂ — അമർത്തിപ്പിടിക്കുമ്പോൾ തരംഗരൂപമോ ടൈമറോ കാണിച്ചാൽ അത് പ്രവർത്തിക്കുന്നു.",
        "pa": "ਮੈਂ ਇੱਥੋਂ ਸਿੱਧਾ ਤੁਹਾਡਾ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਜਾਂਚ ਨਹੀਂ ਸਕਦੀ, ਪਰ ਤੁਸੀਂ ਚੈਟ ਸਕ੍ਰੀਨ ਤੇ ਮਾਈਕ ਬਟਨ ਅਜ਼ਮਾ ਸਕਦੇ ਹੋ — ਦਬਾ ਕੇ ਰੱਖਣ ਤੇ ਵੇਵਫਾਰਮ ਜਾਂ ਟਾਈਮਰ ਦਿਖੇ ਤਾਂ ਇਹ ਕੰਮ ਕਰ ਰਿਹਾ ਹੈ।",
    },
    "change_language": {
        "en": "You can change the app's language from the language picker in Settings — your questions and answers will then show in that language.",
        "hi": "आप सेटिंग्स में भाषा चुनने के विकल्प से ऐप की भाषा बदल सकते हैं — उसके बाद आपके सवाल और जवाब उसी भाषा में दिखेंगे।",
        "mr": "तुम्ही सेटिंग्जमधील भाषा निवडीवरून अॅपची भाषा बदलू शकता — त्यानंतर तुमचे प्रश्न आणि उत्तरे त्याच भाषेत दिसतील.",
        "ta": "அமைப்புகளில் உள்ள மொழி தேர்வு மூலம் பயன்பாட்டின் மொழியை மாற்றலாம் — பிறகு உங்கள் கேள்விகளும் பதில்களும் அந்த மொழியில் காட்டப்படும்.",
        "te": "సెట్టింగ్‌లలోని భాషా ఎంపిక ద్వారా యాప్ భాషను మార్చవచ్చు — ఆ తర్వాత మీ ప్రశ్నలు మరియు సమాధానాలు ఆ భాషలో కనిపిస్తాయి.",
        "bn": "সেটিংসে ভাষা নির্বাচক থেকে অ্যাপের ভাষা পরিবর্তন করতে পারেন — তারপর আপনার প্রশ্ন ও উত্তর সেই ভাষায় দেখাবে।",
        "gu": "તમે સેટિંગ્સમાંના ભાષા પસંદગીકારથી એપની ભાષા બદલી શકો છો — પછી તમારા પ્રશ્નો અને જવાબો તે ભાષામાં દેખાશે.",
        "kn": "ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿನ ಭಾಷಾ ಆಯ್ಕೆಯಿಂದ ಆ್ಯಪ್‌ನ ಭಾಷೆ ಬದಲಾಯಿಸಬಹುದು — ನಂತರ ನಿಮ್ಮ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಉತ್ತರಗಳು ಆ ಭಾಷೆಯಲ್ಲಿ ಕಾಣುತ್ತವೆ.",
        "ml": "ക്രമീകരണങ്ങളിലെ ഭാഷാ തിരഞ്ഞെടുപ്പിൽ നിന്ന് ആപ്പിന്റെ ഭാഷ മാറ്റാം — പിന്നീട് നിങ്ങളുടെ ചോദ്യങ്ങളും ഉത്തരങ്ങളും ആ ഭാഷയിൽ കാണിക്കും.",
        "pa": "ਤੁਸੀਂ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਭਾਸ਼ਾ ਚੋਣਕਾਰ ਤੋਂ ਐਪ ਦੀ ਭਾਸ਼ਾ ਬਦਲ ਸਕਦੇ ਹੋ — ਫਿਰ ਤੁਹਾਡੇ ਸਵਾਲ ਅਤੇ ਜਵਾਬ ਉਸੇ ਭਾਸ਼ਾ ਵਿੱਚ ਦਿਖਣਗੇ।",
    },
    "how_to_use_feature": {
        "en": "I can help with that in general terms, but for step-by-step guidance on a specific screen, please check that screen's own help text or ask me a specific question about it.",
        "hi": "मैं इसमें सामान्य रूप से मदद कर सकती हूं, लेकिन किसी खास स्क्रीन पर चरण-दर-चरण मार्गदर्शन के लिए कृपया उस स्क्रीन का मदद टेक्स्ट देखें या मुझसे उसके बारे में खास सवाल पूछें।",
        "mr": "मी याबाबत सर्वसाधारणपणे मदत करू शकते, पण एखाद्या विशिष्ट स्क्रीनवर टप्प्याटप्प्याने मार्गदर्शनासाठी कृपया त्या स्क्रीनचा मदत मजकूर पहा किंवा मला त्याबद्दल विशिष्ट प्रश्न विचारा.",
        "ta": "இதில் பொதுவான அளவில் உதவ முடியும், ஆனால் ஒரு குறிப்பிட்ட திரையில் படிப்படியான வழிகாட்டலுக்கு அந்த திரையின் உதவி உரையைப் பார்க்கவும் அல்லது அதைப் பற்றி குறிப்பிட்ட கேள்வி கேளுங்கள்.",
        "te": "దీనిలో సాధారణంగా సహాయం చేయగలను, కానీ నిర్దిష్ట స్క్రీన్‌పై దశల వారీ మార్గదర్శకత్వం కోసం దయచేసి ఆ స్క్రీన్ యొక్క సహాయ వచనాన్ని చూడండి లేదా దాని గురించి నిర్దిష్ట ప్రశ్న అడగండి.",
        "bn": "আমি সাধারণভাবে সাহায্য করতে পারি, তবে কোনো নির্দিষ্ট স্ক্রিনে ধাপে ধাপে নির্দেশনার জন্য দয়া করে সেই স্ক্রিনের নিজস্ব সাহায্য লেখা দেখুন বা আমাকে এ সম্পর্কে নির্দিষ্ট প্রশ্ন জিজ্ঞাসা করুন।",
        "gu": "હું આ બાબતે સામાન્ય રીતે મદદ કરી શકું છું, પણ કોઈ ચોક્કસ સ્ક્રીન પર પગલું-દર-પગલું માર્ગદર્શન માટે કૃપા કરી તે સ્ક્રીનનું મદદ લખાણ જુઓ અથવા મને તેના વિશે ચોક્કસ પ્રશ્ન પૂછો.",
        "kn": "ಇದರಲ್ಲಿ ಸಾಮಾನ್ಯವಾಗಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ, ಆದರೆ ನಿರ್ದಿಷ್ಟ ಪರದೆಯಲ್ಲಿ ಹಂತ-ಹಂತದ ಮಾರ್ಗದರ್ಶನಕ್ಕಾಗಿ ದಯವಿಟ್ಟು ಆ ಪರದೆಯ ಸಹಾಯ ಪಠ್ಯವನ್ನು ನೋಡಿ ಅಥವಾ ಅದರ ಬಗ್ಗೆ ನಿರ್ದಿಷ್ಟ ಪ್ರಶ್ನೆ ಕೇಳಿ.",
        "ml": "ഇതിൽ പൊതുവായി സഹായിക്കാൻ കഴിയും, എന്നാൽ ഒരു നിർദ്ദിഷ്ട സ്ക്രീനിൽ ഘട്ടം ഘട്ടമായുള്ള മാർഗ്ഗനിർദ്ദേശത്തിന് ആ സ്ക്രീനിന്റെ സഹായ വാചകം കാണുകയോ അതിനെക്കുറിച്ച് നിർദ്ദിഷ്ട ചോദ്യം ചോദിക്കുകയോ ചെയ്യുക.",
        "pa": "ਮੈਂ ਇਸ ਵਿੱਚ ਆਮ ਤੌਰ ਤੇ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ, ਪਰ ਕਿਸੇ ਖਾਸ ਸਕ੍ਰੀਨ ਤੇ ਕਦਮ-ਦਰ-ਕਦਮ ਮਾਰਗਦਰਸ਼ਨ ਲਈ ਕਿਰਪਾ ਕਰਕੇ ਉਸ ਸਕ੍ਰੀਨ ਦਾ ਮਦਦ ਟੈਕਸਟ ਦੇਖੋ ਜਾਂ ਮੈਨੂੰ ਇਸ ਬਾਰੇ ਖਾਸ ਸਵਾਲ ਪੁੱਛੋ।",
    },
    # ── Distress SOS ──────────────────────────────────────────────────────────
    # Triggered BEFORE the deny-list by bare short panic phrases ("help",
    # "help me", "bachao", "மடத்தை" …).  Longer messages with legal context
    # ("help me file an FIR") do NOT match _BARE_DISTRESS_RE and continue
    # unchanged to the legal pipeline.
    "distress_sos": {
        "en": (
            "You're not alone. \U0001f64f\n\n"
            "If you're in immediate danger, call now:\n"
            "\u2022 112 \u2014 Emergency (Police / Ambulance)\n"
            "\u2022 100 \u2014 Police\n"
            "\u2022 1091 \u2014 Women\u2019s helpline (24 h)\n"
            "\u2022 181 \u2014 Women\u2019s helpdesk\n"
            "\u2022 1930 \u2014 Cyber crime helpline\n\n"
            "Tell me what\u2019s happening and I\u2019ll guide you through your legal options."
        ),
        "hi": (
            "\u0906\u092a \u0905\u0915\u0947\u0932\u0947 \u0928\u0939\u0940\u0902 \u0939\u0948\u0902\u0964 \U0001f64f\n\n"
            "\u0924\u0941\u0930\u0902\u0924 \u0916\u0924\u0930\u0947 \u092e\u0947\u0902 \u0939\u094b\u0902 \u0924\u094b \u0905\u092d\u0940 \u0915\u0949\u0932 \u0915\u0930\u0947\u0902:\n"
            "\u2022 112 \u2014 \u0907\u092e\u0930\u091c\u0947\u0902\u0938\u0940 (\u092a\u0941\u0932\u093f\u0938 / \u090f\u0902\u092c\u0941\u0932\u0947\u0902\u0938)\n"
            "\u2022 100 \u2014 \u092a\u0941\u0932\u093f\u0938\n"
            "\u2022 1091 \u2014 \u092e\u0939\u093f\u0932\u093e \u0939\u0947\u0932\u094d\u092a\u0932\u093e\u0907\u0928 (24 \u0918\u0902\u091f\u0947)\n"
            "\u2022 181 \u2014 \u092e\u0939\u093f\u0932\u093e \u0939\u0947\u0932\u094d\u092a\u0921\u0947\u0938\u094d\u0915\n"
            "\u2022 1930 \u2014 \u0938\u093e\u0907\u092c\u0930 \u0915\u094d\u0930\u093e\u0907\u092e \u0939\u0947\u0932\u094d\u092a\u0932\u093e\u0907\u0928\n\n"
            "\u092e\u0941\u091d\u0947 \u092c\u0924\u093e\u090f\u0902 \u0915\u094d\u092f\u093e \u0939\u094b \u0930\u0939\u093e \u0939\u0948 \u2014 \u092e\u0948\u0902 \u0906\u092a\u0915\u094b \u0915\u093e\u0928\u0942\u0928\u0940 \u0935\u093f\u0915\u0932\u094d\u092a \u092c\u0924\u093e\u0909\u0902\u0917\u0940\u0964"
        ),
        "mr": (
            "तुम्ही एकटे नाही. \U0001f64f\n\n"
            "\u0932\u0917\u0947\u091a \u0927\u094b\u0915\u093e \u0905\u0938\u0947\u0932 \u0924\u0930 \u0906\u0924\u093e \u092b\u094b\u0928 \u0915\u0930\u093e:\n"
            "\u2022 112 \u2014 \u0907\u092e\u0930\u094d\u091c\u0928\u094d\u0938\u0940 (\u092a\u094b\u0932\u0940\u0938 / \u0930\u0941\u0917\u094d\u0923\u0935\u093e\u0939\u093f\u0915\u093e)\n"
            "\u2022 100 \u2014 \u092a\u094b\u0932\u0940\u0938\n"
            "\u2022 1091 \u2014 \u092e\u0939\u093f\u0932\u093e \u0939\u0947\u0932\u094d\u092a\u0932\u093e\u0907\u0928 (24 \u0924\u093e\u0938)\n"
            "\u2022 181 \u2014 \u092e\u0939\u093f\u0932\u093e \u0939\u0947\u0932\u094d\u092a\u0921\u0947\u0938\u094d\u0915\n"
            "\u2022 1930 \u2014 \u0938\u093e\u092f\u092c\u0930 \u0917\u0941\u0928\u094d\u0939\u0947 \u0939\u0947\u0932\u094d\u092a\u0932\u093e\u0907\u0928\n\n"
            "\u092e\u0932\u093e \u0938\u093e\u0902\u0917\u093e \u0915\u093e\u092f \u091d\u093e\u0932\u0947 \u2014 \u092e\u0940 \u0924\u0941\u092e\u094d\u0939\u093e\u0932\u093e \u0915\u093e\u092f\u0926\u0947\u0936\u0940\u0930 \u092a\u0930\u094d\u092f\u093e\u092f \u0938\u093e\u0902\u0917\u0947\u0928."
        ),
        "ta": (
            "\u0ba8\u0bc0\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0ba4\u0ba9\u0bbf\u0baf\u0bbe\u0b95 \u0b87\u0bb2\u0bcd\u0bb2\u0bc8. \U0001f64f\n\n"
            "\u0b89\u0b9f\u0ba9\u0b9f\u0bbf \u0b86\u0baa\u0ba4\u0bcd\u0ba4\u0bbf\u0bb2\u0bcd \u0b87\u0bb0\u0bc1\u0ba8\u0bcd\u0ba4\u0bbe\u0bb2\u0bcd \u0b87\u0baa\u0bcd\u0baa\u0bcb\u0ba4\u0bc7 \u0b85\u0bb4\u0bc8\u0b95\u0bcd\u0b95\u0bb5\u0bc1\u0bae\u0bcd:\n"
            "\u2022 112 \u2014 \u0b85\u0bb5\u0b9a\u0bb0\u0b95\u0bbe\u0bb2\u0bae\u0bcd (\u0b95\u0bbe\u0bb5\u0bb2\u0bcd / \u0b86\u0bae\u0bcd\u0baa\u0bc1\u0bb2\u0ba9\u0bcd\u0b9a\u0bcd)\n"
            "\u2022 100 \u2014 \u0b95\u0bbe\u0bb5\u0bb2\u0bcd \u0ba4\u0bc1\u0bb1\u0bc8\n"
            "\u2022 1091 \u2014 \u0baa\u0bc6\u0ba3\u0bcd\u0b95\u0bb3\u0bcd \u0b89\u0ba4\u0bb5\u0bbf \u0b8e\u0ba3\u0bcd (24 \u0bae\u0ba3\u0bbf)\n"
            "\u2022 181 \u2014 \u0baa\u0bc6\u0ba3\u0bcd\u0b95\u0bb3\u0bcd \u0b89\u0ba4\u0bb5\u0bbf \u0bae\u0bc8\u0baf\u0bae\u0bcd\n"
            "\u2022 1930 \u2014 \u0b87\u0ba3\u0bc8\u0baf\u0b95\u0bcd \u0b95\u0bc1\u0bb1\u0bcd\u0bb1 \u0b89\u0ba4\u0bb5\u0bbf \u0b8e\u0ba3\u0bcd\n\n"
            "\u0b8e\u0ba9\u0bcd\u0ba9 \u0ba8\u0b9f\u0b95\u0bcd\u0b95\u0bbf\u0bb1\u0ba4\u0bc1 \u0b8e\u0ba9\u0bcd\u0bb1\u0bc1 \u0b9a\u0bcb\u0bb2\u0bcd\u0bb2\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u2014 \u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b9a\u0b9f\u0bcd\u0b9f\u0baa\u0bcd\u0baa\u0bc2\u0bb0\u0bcd\u0bb5 \u0bb5\u0bb4\u0bbf\u0b95\u0bb3\u0bc8 \u0bb5\u0bb4\u0bbf\u0b95\u0bbe\u0b9f\u0bcd\u0b9f\u0bc1\u0b95\u0bbf\u0bb1\u0bc7\u0ba9\u0bcd."
        ),
        "te": (
            "\u0c2e\u0c40\u0c30\u0c41 \u0c12\u0c02\u0c1f\u0c30\u0c3f\u0c17\u0c3e \u0c32\u0c47\u0c30\u0c41. \U0001f64f\n\n"
            "\u0c35\u0c46\u0c02\u0c1f\u0c28\u0c47 \u0c2a\u0c4d\u0c30\u0c2e\u0c3e\u0c26\u0c02\u0c32\u0c4b \u0c09\u0c02\u0c1f\u0c47 \u0c07\u0c2a\u0c4d\u0c2a\u0c41\u0c21\u0c47 \u0c15\u0c3e\u0c32\u0c4d \u0c1a\u0c47\u0c2f\u0c02\u0c21\u0c3f:\n"
            "\u2022 112 \u2014 \u0c05\u0c24\u0c4d\u0c2f\u0c35\u0c38\u0c30 (\u0c2a\u0c4b\u0c32\u0c40\u0c38\u0c41 / \u0c06\u0c02\u0c2c\u0c41\u0c32\u0c46\u0c28\u0c4d\u0c38\u0c4d)\n"
            "\u2022 100 \u2014 \u0c2a\u0c4b\u0c32\u0c40\u0c38\u0c41\n"
            "\u2022 1091 \u2014 \u0c2e\u0c39\u0c3f\u0c33\u0c3e \u0c39\u0c46\u0c32\u0c4d\u0c2a\u0c4d \u0c32\u0c48\u0c28\u0c4d (24 \u0c17\u0c02\u0c1f\u0c32\u0c41)\n"
            "\u2022 181 \u2014 \u0c2e\u0c39\u0c3f\u0c33\u0c3e \u0c39\u0c46\u0c32\u0c4d\u0c2a\u0c4d \u0c21\u0c46\u0c38\u0c4d\u0c15\u0c4d\n"
            "\u2022 1930 \u2014 \u0c38\u0c48\u0c2c\u0c30\u0c4d \u0c28\u0c47\u0c30 \u0c39\u0c46\u0c32\u0c4d\u0c2a\u0c4d \u0c32\u0c48\u0c28\u0c4d\n\n"
            "\u0c0f\u0c2e\u0c3f \u0c1c\u0c30\u0c41\u0c17\u0c41\u0c24\u0c41\u0c02\u0c26\u0c4b \u0c1a\u0c46\u0c2a\u0c4d\u0c2a\u0c02\u0c21\u0c3f \u2014 \u0c2e\u0c40\u0c15\u0c41 \u0c28\u0c4d\u0c2f\u0c3e\u0c2f \u0c35\u0c3f\u0c15\u0c32\u0c4d\u0c2a\u0c3e\u0c32\u0c41 \u0c2e\u0c3e\u0c30\u0c4d\u0c17\u0c28\u0c3f\u0c30\u0c4d\u0c26\u0c47\u0c36\u0c02 \u0c1a\u0c47\u0c38\u0c4d\u0c24\u0c3e\u0c28\u0c41."
        ),
        "bn": (
            "\u0986\u09aa\u09a8\u09bf \u098f\u0995\u09be \u09a8\u09a8\u0964 \U0001f64f\n\n"
            "\u09a4\u09be\u09ce\u0995\u09cd\u09b7\u09a3\u09bf\u0995 \u09ac\u09bf\u09aa\u09a6\u09c7 \u09a5\u09be\u0995\u09b2\u09c7 \u098f\u0996\u09a8\u0987 \u0995\u09b2 \u0995\u09b0\u09c1\u09a8:\n"
            "\u2022 112 \u2014 \u099c\u09b0\u09c1\u09b0\u09bf (\u09aa\u09c1\u09b2\u09bf\u09b6 / \u0985\u09cd\u09af\u09be\u09ae\u09cd\u09ac\u09c1\u09b2\u09c7\u09a8\u09cd\u09b8)\n"
            "\u2022 100 \u2014 \u09aa\u09c1\u09b2\u09bf\u09b6\n"
            "\u2022 1091 \u2014 \u09a8\u09be\u09b0\u09c0 \u09b9\u09c7\u09b2\u09cd\u09aa\u09b2\u09be\u0987\u09a8 (\u09e8\u09ea \u0998\u09a3\u09cd\u099f\u09be)\n"
            "\u2022 181 \u2014 \u09a8\u09be\u09b0\u09c0 \u09b9\u09c7\u09b2\u09cd\u09aa\u09a1\u09c7\u09b8\u09cd\u0995\n"
            "\u2022 1930 \u2014 \u09b8\u09be\u0987\u09ac\u09be\u09b0 \u0995\u09cd\u09b0\u09be\u0987\u09ae \u09b9\u09c7\u09b2\u09cd\u09aa\u09b2\u09be\u0987\u09a8\n\n"
            "\u0995\u09c0 \u09b9\u099a\u09cd\u099b\u09c7 \u09ac\u09b2\u09c1\u09a8 \u2014 \u0986\u09ae\u09bf \u0986\u09aa\u09a8\u09be\u0995\u09c7 \u0986\u0987\u09a8\u09bf \u09ac\u09bf\u0995\u09b2\u09cd\u09aa \u099c\u09be\u09a8\u09be\u09ac\u0964"
        ),
        "gu": (
            "\u0aa4\u0aae\u0ac7 \u0a8f\u0a95\u0ab2\u0abe \u0aa8\u0aa5\u0ac0. \U0001f64f\n\n"
            "\u0aa4\u0abe\u0aa4\u0acd\u0a95\u0abe\u0ab2\u0abf\u0a95 \u0a96\u0aa4\u0ab0\u0acb \u0ab9\u0acb\u0aaf \u0aa4\u0acb \u0a85\u0aa4\u0acd\u0acd\u0aaf\u0abe\u0ab0\u0ac7 \u0aab\u0acb\u0aa8 \u0a95\u0ab0\u0acb:\n"
            "\u2022 112 \u2014 \u0a87\u0aae\u0ab0\u0acd\u0a9c\u0aa8\u0acd\u0ab8\u0ac0 (\u0aaa\u0acb\u0ab2\u0ac0\u0ab8 / \u0a8f\u0aae\u0acd\u0aac\u0acd\u0aaf\u0ac1\u0ab2\u0aa8\u0acd\u0ab8)\n"
            "\u2022 100 \u2014 \u0aaa\u0acb\u0ab2\u0ac0\u0ab8\n"
            "\u2022 1091 \u2014 \u0aae\u0ab9\u0abf\u0ab2\u0abe \u0ab9\u0ac7\u0ab2\u0acd\u0aaa\u0ab2\u0abe\u0a87\u0aa8 (24 \u0a95\u0ab2\u0abe\u0a15)\n"
            "\u2022 181 \u2014 \u0aae\u0ab9\u0abf\u0ab2\u0abe \u0ab9\u0ac7\u0ab2\u0acd\u0aaa\u0aa1\u0ac7\u0ab8\u0acd\u0a95\n"
            "\u2022 1930 \u2014 \u0ab8\u0abe\u0a87\u0aac\u0ab0 \u0a95\u0acd\u0ab0\u0abe\u0a87\u0aae \u0ab9\u0ac7\u0ab2\u0acd\u0aaa\u0ab2\u0abe\u0a87\u0aa8\n\n"
            "\u0aae\u0aa8\u0ac7 \u0a9c\u0aa3\u0abe\u0ab5\u0acb \u0ab6\u0ac1\u0a82 \u0aa5\u0a88 \u0ab0\u0ab9\u0acd\u0aaf\u0ac1\u0a82 \u0a9b\u0ac7 \u2014 \u0ab9\u0ac1\u0a82 \u0aa4\u0aae\u0aa8\u0ac7 \u0a95\u0abe\u0aaf\u0aa6\u0abe\u0a95\u0ac0\u0aaf \u0ab5\u0abf\u0a95\u0ab2\u0acd\u0aaa\u0acb \u0a9c\u0aa3\u0abe\u0ab5\u0ac0\u0ab6."
        ),
        "kn": (
            "\u0ca8\u0cc0\u0cb5\u0cc1 \u0c92\u0c82\u0c9f\u0cbf\u0caf\u0cbe\u0c97\u0cbf\u0cb2\u0ccd\u0cb2. \U0001f64f\n\n"
            "\u0ca4\u0c95\u0ccd\u0cb7\u0ca3 \u0c85\u0caa\u0cbe\u0caf\u0ca6\u0cb2\u0ccd\u0cb2\u0cbf\u0ca6\u0ccd\u0ca6\u0cb0\u0cc6 \u0c88\u0c97\u0cb2\u0cc7 \u0c95\u0cb0\u0cc6 \u0cae\u0cbe\u0ca1\u0cbf:\n"
            "\u2022 112 \u2014 \u0ca4\u0cc1\u0cb0\u0ccd\u0ca4\u0cc1 (\u0caa\u0cca\u0cb2\u0cc0\u0cb8\u0ccd / \u0c86\u0ccd\u0caf\u0c82\u0ccd\u0cac\u0ccd\u0caf\u0cc1\u0cb2\u0cc6\u0ca8\u0ccd\u0cb8\u0ccd)\n"
            "\u2022 100 \u2014 \u0caa\u0cca\u0cb2\u0cc0\u0cb8\u0ccd\n"
            "\u2022 1091 \u2014 \u0cae\u0cb9\u0cbf\u0cb3\u0cbe \u0cb9\u0cc6\u0cb2\u0ccd\u0caa\u0ccd\u200c\u0cb2\u0cc8\u0ca8\u0ccd (24 \u0c97\u0c82)\n"
            "\u2022 181 \u2014 \u0cae\u0cb9\u0cbf\u0cb3\u0cbe \u0cb9\u0cc6\u0cb2\u0ccd\u0caa\u0ccd\u200c\u0ca1\u0cc6\u0cb8\u0ccd\u0c95\u0ccd\n"
            "\u2022 1930 \u2014 \u0cb8\u0cc8\u0cac\u0cb0\u0ccd \u0c85\u0caa\u0cb0\u0cbe\u0ca7 \u0cb9\u0cc6\u0cb2\u0ccd\u0caa\u0ccd\u200c\u0cb2\u0cc8\u0ca8\u0ccd\n\n"
            "\u0c8f\u0ca8\u0cbe\u0c97\u0cc1\u0ca4\u0ccd\u0ca4\u0cbf\u0ca6\u0cc6 \u0c8e\u0c82\u0ca6\u0cc1 \u0cb9\u0cc7\u0cb3\u0cbf \u2014 \u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0c95\u0cbe\u0ca8\u0cc2\u0ca8\u0cc1 \u0c86\u0caf\u0ccd\u0c95\u0cc6\u0c97\u0cb3\u0ca8\u0ccd\u0ca8\u0cc1 \u0ca8\u0cbe\u0ca8\u0cc1 \u0cae\u0cbe\u0cb0\u0ccd\u0c97\u0ca6\u0cb0\u0ccd\u0cb6\u0cbf\u0cb8\u0cc1\u0ca4\u0ccd\u0ca4\u0cc7\u0ca8\u0cc6."
        ),
        "ml": (
            "\u0d28\u0d3f\u0d19\u0d4d\u0d19\u0d33\u0d4d\u200d \u0d12\u0d31\u0d4d\u0d31\u0d15\u0d4d\u0d15\u0d32\u0d4d\u0d32. \U0001f64f\n\n"
            "\u0d09\u0d1f\u0d28\u0d1f\u0d3f \u0d05\u0d2a\u0d15\u0d1f\u0d24\u0d4d\u0d24\u0d3f\u0d32\u0d3e\u0d23\u0d46\u0d19\u0d4d\u0d15\u0d3f\u0d32\u0d4d\u200d \u0d07\u0d2a\u0d4d\u0d2a\u0d4b\u0d33\u0d4d\u200d \u0d35\u0d3f\u0d33\u0d3f\u0d15\u0d4d\u0d15\u0d42:\n"
            "\u2022 112 \u2014 \u0d05\u0d1f\u0d3f\u0d2f\u0d28\u0d4d\u0d24\u0d30 (\u0d2a\u0d4b\u0d32\u0d40\u0d38\u0d4d / \u0d06\u0d02\u0d2c\u0d41\u0d32\u0d7b\u0d38\u0d4d)\n"
            "\u2022 100 \u2014 \u0d2a\u0d4b\u0d32\u0d40\u0d38\u0d4d\n"
            "\u2022 1091 \u2014 \u0d35\u0d28\u0d3f\u0d24\u0d3e \u0d39\u0d46\u0d7d\u0d2a\u0d4d\u200c\u0d32\u0d48\u0d7b (24 \u0d2e\u0d23\u0d3f\u0d15\u0d4d\u0d15\u0d42\u0d7c)\n"
            "\u2022 181 \u2014 \u0d35\u0d28\u0d3f\u0d24\u0d3e \u0d39\u0d46\u0d7d\u0d2a\u0d4d\u200c\u0d21\u0d46\u0d38\u0d4d\u0d15\u0d4d\n"
            "\u2022 1930 \u2014 \u0d38\u0d48\u0d2c\u0d7c \u0d15\u0d4d\u0d30\u0d48\u0d02 \u0d39\u0d46\u0d7d\u0d2a\u0d4d\u200c\u0d32\u0d48\u0d7b\n\n"
            "\u0d0e\u0d28\u0d4d\u0d24\u0d4d \u0d38\u0d02\u0d2d\u0d35\u0d3f\u0d15\u0d4d\u0d15\u0d41\u0d28\u0d4d\u0d28\u0d41\u0d35\u0d46\u0d28\u0d4d\u0d28\u0d4d \u0d2a\u0d31\u0d2f\u0d42 \u2014 \u0d1e\u0d3e\u0d7b \u0d28\u0d3f\u0d19\u0d4d\u0d19\u0d33\u0d46 \u0d28\u0d3f\u0d2f\u0d2e \u0d13\u0d2a\u0d4d\u0d37\u0d28\u0d41\u0d15\u0d33\u0d4d\u200d \u0d35\u0d34\u0d3f \u0d28\u0d2f\u0d3f\u0d15\u0d4d\u0d15\u0d3e\u0d02."
        ),
        "pa": (
            "\u0a24\u0a41\u0a38\u0a40\u0a02 \u0a07\u0a15\u0a71\u0a32\u0a47 \u0a28\u0a39\u0a40\u0a02 \u0a39\u0a4b. \U0001f64f\n\n"
            "\u0a24\u0a41\u0a30\u0a70\u0a24 \u0a16\u0a3c\u0a24\u0a30\u0a47 \u0a35\u0a3f\u0a71\u0a1a \u0a39\u0a4b\u0a35\u0a4b \u0a24\u0a3e\u0a02 \u0a39\u0a41\u0a23\u0a47 \u0a15\u0a3e\u0a32 \u0a15\u0a30\u0a4b:\n"
            "\u2022 112 \u2014 \u0a10\u0a2e\u0a30\u0a1c\u0a48\u0a02\u0a38\u0a40 (\u0a2a\u0a41\u0a32\u0a3f\u0a38 / \u0a10\u0a02\u0a2c\u0a42\u0a32\u0a48\u0a02\u0a38)\n"
            "\u2022 100 \u2014 \u0a2a\u0a41\u0a32\u0a3f\u0a38\n"
            "\u2022 1091 \u2014 \u0a14\u0a30\u0a24\u0a3e\u0a02 \u0a26\u0a40 \u0a39\u0a48\u0a32\u0a2a\u0a32\u0a3e\u0a08\u0a28 (24 \u0a18\u0a70)\n"
            "\u2022 181 \u2014 \u0a14\u0a30\u0a24\u0a3e\u0a02 \u0a26\u0a40 \u0a39\u0a48\u0a32\u0a2a\u0a21\u0a48\u0a38\u0a15\n"
            "\u2022 1930 \u2014 \u0a38\u0a3e\u0a08\u0a2c\u0a30 \u0a15\u0a4d\u0a30\u0a3e\u0a08\u0a2e \u0a39\u0a48\u0a32\u0a2a\u0a32\u0a3e\u0a08\u0a28\n\n"
            "\u0a26\u0a71\u0a38\u0a4b \u0a15\u0a40 \u0a39\u0a4b \u0a30\u0a3f\u0a39\u0a3e \u0a39\u0a48 \u2014 \u0a2e\u0a48\u0a02 \u0a24\u0a41\u0a39\u0a3e\u0a28\u0a42\u0a70 \u0a15\u0a3e\u0a28\u0a42\u0a70\u0a28\u0a40 \u0a35\u0a3f\u0a15\u0a32\u0a2a \u0a26\u0a71\u0a38\u0a3e\u0a02\u0a17\u0a40."
        ),
    },
}


def get_conversational_template(intent: str, language: str) -> Optional[str]:
    """Returns None (never an English fallback) for any language outside
    LANGUAGES_WITH_VERIFIED_DENYLIST — the caller must then fall through to
    the normal legal pipeline, per the safety contract above."""
    if language not in LANGUAGES_WITH_VERIFIED_DENYLIST:
        return None
    bucket = TEMPLATES.get(intent)
    if not bucket:
        return None
    return bucket.get(language) or bucket.get("en")
