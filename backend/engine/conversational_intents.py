"""
DHARA C1 — Conversational replies (non-legal allowlist).

Deterministic, non-LLM matcher for a small set of non-legal conversational
intents (greeting, thanks, "what can you do", mic/voice check, change
language, how to use a feature). Returns a fixed, human-reviewed template in
the user's language — never LLM-generated, and this module never touches
the legal pipeline, retrieval, or engine/output_guard.py in any way.

Safety contract (do not weaken without a fresh GO):
  - The deny list ALWAYS wins. is_denylisted() is checked by the caller
    (api/chat_router.py) BEFORE this module's classifier is even consulted,
    and it is also exported here so tests exercise the same definition the
    caller uses — there is exactly one deny-list, not two to drift apart.
  - This is an ALLOWLIST, not a keyword scanner: only near-exact / tightly
    bounded patterns qualify. Anything uncertain returns None, i.e. fails
    CLOSED into the normal legal pipeline (chat_router.py's existing
    behaviour, completely unchanged for a None result).
  - A length cap AND a canonical-action veto (reusing query_parser.py's own
    action vocabulary — Layer A's existing "this might be a legal action"
    list) each independently disqualify a match. Both only ever narrow
    matches, never widen them.
  - Caller places this gate strictly AFTER the backend immediate-danger
    check (_is_immediate_danger / _emergency in chat_router.py) and after
    the deny-list check — never before. See GO amendment (1)/(2).
  - Only English ("en") and Hindi ("hi") templates are shipped (GO amendment
    3). The TEMPLATES dict is shaped so adding another language later is
    just a new key per intent — but no machine translation is added here
    without its own human-reviewed GO.
"""
from __future__ import annotations

import re
from typing import Optional

from engine.query_parser import _CANONICAL_ACTIONS

# ── Tunables ──────────────────────────────────────────────────────────────────

_MAX_LEN = 60  # messages longer than this are never allowlisted

# Reuses Layer A's own canonical action vocabulary as a built-in veto: if the
# message mentions any of these (enter, arrest, evict, file_fir, ...), it is
# never allowlisted even if it also contains a greeting word. No second
# legal-domain word list to maintain or let drift out of sync.
_ACTION_WORDS = [w.strip().replace("_", " ") for w in _CANONICAL_ACTIONS.split(",") if w.strip()]
_ACTION_VETO_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in _ACTION_WORDS) + r")\b", re.I)

# ── Deny list — overrides the allowlist, always (GO amendment 2) ───────────────
# English + Hindi equivalents only, matching the two shipped template
# languages. A denied message is NEVER given a canned reply — it goes down
# the normal path (where the real safety-phrase check, upstream of this
# module entirely, has already had first say).
_DENY_PATTERNS = [
    r"\bhelp\b", r"\bemergency\b", r"\bdanger\b", r"\bpolice\b",
    r"\bunsafe\b", r"\bscared\b", r"\bfollowing me\b",
    # Hindi equivalents
    r"मदद", r"आपातकाल", r"खतरा", r"पुलिस", r"असुरक्षित", r"डर", r"पीछा",
]
_DENY_RE = re.compile("|".join(_DENY_PATTERNS), re.I)


def is_denylisted(message: str) -> bool:
    """True if the message contains any deny-listed help/danger/police word
    (English or Hindi). Deny always wins over the allowlist."""
    return bool(_DENY_RE.search(message or ""))


def _normalize(message: str) -> str:
    return (message or "").strip().lower()


# intent key -> list of near-exact phrase patterns (already anchored ^...$)
_INTENT_PATTERNS: dict[str, list[str]] = {
    "greeting": [
        r"^(hi|hello|hey|hola|namaste|namaskar)[\s!.,]*$",
        r"^good\s*(morning|afternoon|evening)[\s!.,]*$",
        r"^(नमस्ते|नमस्कार|हाय|हैलो)[\s!।,]*$",
    ],
    "thanks": [
        r"^(thanks?|thank\s*you|thx|ty)[\s!.,]*$",
        r"^(धन्यवाद|शुक्रिया)[\s!।,]*$",
    ],
    "what_can_you_do": [
        r"^what (can|do) you do[\s?]*$",
        r"^what is dhara[\s?]*$",
        r"^(तुम|आप) क्या कर सकते (हो|हैं)[\s?।]*$",
        r"^धारा क्या है[\s?।]*$",
    ],
    "mic_or_voice_check": [
        r"^(can you )?check (the |my )?mic(rophone)?( for me)?[\s?.,]*$",
        r"^(is )?(my |the )?mic(rophone)? working[\s?.,]*$",
        r"^(mic|voice) test[\s?.,]*$",
        r"^माइक (चेक|टेस्ट) कर(ो|ें)[\s?।,]*$",
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


def classify_conversational_intent(message: str) -> Optional[str]:
    """Return an allowlisted intent key, or None (fail closed).

    Every rule here can only narrow matches, never widen them:
      1. empty / over length cap -> None
      2. any canonical legal-action word present -> None
      3. otherwise, first exact pattern match wins
    """
    if not message:
        return None
    raw = message.strip()
    if len(raw) > _MAX_LEN:
        return None
    if _ACTION_VETO_RE.search(raw):
        return None
    norm = _normalize(raw)
    for intent, patterns in _COMPILED.items():
        for pat in patterns:
            if pat.match(norm):
                return intent
    return None


# ── Templates — English and Hindi only (GO amendment 3) ────────────────────────
TEMPLATES: dict[str, dict[str, str]] = {
    "greeting": {
        "en": "Hello! I'm DHARA. Ask me about any Indian law question, or tell me what's happening and I'll help you understand your rights.",
        "hi": "नमस्ते! मैं धारा हूं। मुझसे भारतीय कानून से जुड़ा कोई भी सवाल पूछें, या बताइए क्या हुआ है — मैं आपके अधिकार समझने में मदद करूंगी।",
    },
    "thanks": {
        "en": "You're welcome! Let me know if you have another legal question.",
        "hi": "आपका स्वागत है! अगर कोई और कानूनी सवाल हो तो बताइए।",
    },
    "what_can_you_do": {
        "en": "I'm DHARA — I answer Indian legal questions (your rights, what the law says, which section applies) using verified official text. I can also help you draft an FIR, look up a court case, or reach your trusted contacts if you're unsafe.",
        "hi": "मैं धारा हूं — मैं भारतीय कानून से जुड़े सवालों के जवाब सत्यापित आधिकारिक पाठ के आधार पर देती हूं (आपके अधिकार, कानून क्या कहता है, कौन-सी धारा लागू होती है)। मैं FIR लिखने में मदद, कोर्ट केस खोजने, या असुरक्षित होने पर आपके भरोसेमंद संपर्कों तक पहुंचने में भी मदद कर सकती हूं।",
    },
    "mic_or_voice_check": {
        "en": "I can't test your microphone directly from here, but you can try the mic button on the chat screen — if it shows a waveform or a timer while you hold it, it's working.",
        "hi": "मैं यहां से सीधे आपका माइक्रोफ़ोन जांच नहीं सकती, लेकिन आप चैट स्क्रीन पर माइक बटन आज़मा सकते हैं — दबाए रखने पर वेवफ़ॉर्म या टाइमर दिखे तो यह काम कर रहा है।",
    },
    "change_language": {
        "en": "You can change the app's language from the language picker in Settings — your questions and answers will then show in that language.",
        "hi": "आप सेटिंग्स में भाषा चुनने के विकल्प से ऐप की भाषा बदल सकते हैं — उसके बाद आपके सवाल और जवाब उसी भाषा में दिखेंगे।",
    },
    "how_to_use_feature": {
        "en": "I can help with that in general terms, but for step-by-step guidance on a specific screen, please check that screen's own help text or ask me a specific question about it.",
        "hi": "मैं इसमें सामान्य रूप से मदद कर सकती हूं, लेकिन किसी खास स्क्रीन पर चरण-दर-चरण मार्गदर्शन के लिए कृपया उस स्क्रीन का मदद टेक्स्ट देखें या मुझसे उसके बारे में खास सवाल पूछें।",
    },
}


def get_conversational_template(intent: str, language: str) -> Optional[str]:
    bucket = TEMPLATES.get(intent)
    if not bucket:
        return None
    return bucket.get(language) or bucket.get("en")
