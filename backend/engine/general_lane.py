"""
General-question lane for Ask DHARA (26 Nov 2026).

WHY
---
Every chat answer used to go down one path: retrieve law sections, then
write "Answer + What you can do" from those sections ONLY. That fits "my
phone was stolen, what do I do?" but not "what are citizens' rights?" — a
broad question has no single section to retrieve and no real actions, so the
answer came out as filler ("Read about your six fundamental rights"), or as
the no-source refusal.

WHAT THIS ADDS
--------------
A second lane, used only when ALL of these hold:
  * the switch FEATURE_GENERAL_ANSWERS=true is set (default: OFF);
  * the question is confidently a GENERAL, explanatory legal question
    (is_general_question below — when unsure it says no);
  * no earlier gate has already refused, it is not an emergency, and it is
    not advocate mode.

In that lane the model may explain well-settled Indian law in plain words
from its own knowledge, supported by whatever retrieval found, in an
"Answer + Key points" shape. HARD FACTS STAY LOCKED: section/article
numbers are still stripped by sanitize_model_output, and any money amount,
time period or percentage must appear in the retrieved source text or it is
removed (find_unsupported_figures + one rewrite; if that fails the reply
falls back to the same "cannot confirm" text the strict path uses).

ROLLBACK
--------
Unset FEATURE_GENERAL_ANSWERS (or set it to anything but "true") and restart
the backend. With the switch off, none of this module's functions change the
request: the specific-question path is byte-for-byte what it was.

Everything here is pure (no I/O, no LLM call) so it is unit-testable; the
only call sites are in api/chat_router.py.
"""
from __future__ import annotations

import os
import re

ENV_SWITCH = "FEATURE_GENERAL_ANSWERS"


def general_answers_enabled() -> bool:
    """Read at call time so a restart with the variable unset is a full rollback."""
    return os.environ.get(ENV_SWITCH, "false").strip().lower() == "true"


# ── 1. Sorting: general vs specific ─────────────────────────────────────────
# Conservative by design: a question is "general" only when it (a) reads as
# a request for an explanation, (b) names a legal topic, and (c) carries no
# sign of a personal incident, a request for next steps, or a specific
# section. Anything else stays on the strict, sources-only path.

_MAX_WORDS = 25

_GENERAL_OPENER_RE = re.compile(
    r"^\s*(?:please\s+|pls\s+|kindly\s+|can\s+you\s+|could\s+you\s+)?"
    r"(?:"
    r"what\s+(?:is|are|does|do)\b|what'?s\b|whats\b"
    r"|explain\b|describe\b|define\b|tell\s+me\s+(?:about|what)\b"
    r"|i\s+(?:want|wish|need|would\s+like|'d\s+like)\s+to\s+(?:know|understand|learn)\b"
    r"|(?:the\s+)?meaning\s+of\b|(?:the\s+)?difference\s+between\b"
    r"|how\s+(?:does|do)\s+.{2,60}\s+work\b"
    r"|who\s+is\s+an?\b|who\s+are\b"
    r"|(?:types|kinds|basics|overview)\s+of\b"
    r"|(?:information|info|details)\s+(?:about|on)\b"
    r"|(?:give|share)\s+(?:me\s+)?(?:an?\s+)?(?:overview|summary|information|details)\b"
    r")",
    re.IGNORECASE,
)

_LEGAL_TOPIC_RE = re.compile(
    r"\b(?:"
    r"rights?|law|laws|legal|act|acts|constitution\w*|fundamental|dut(?:y|ies)|citizens?"
    r"|courts?|police|fir|bail|arrest\w*|warrants?|summons|custody|remand"
    r"|consumers?|tenants?|landlords?|rent|lease|property|evict\w*"
    r"|divorce|marriage|maintenance|alimony|adoption|guardians?|inherit\w*|succession|wills?"
    r"|contracts?|agreements?|cheques?|affidavits?|notar\w*|stamp\s+duty"
    r"|complaints?|rti|pil|writs?|petitions?|appeals?|tribunals?|lok\s+adalat|legal\s+aid"
    r"|advocates?|lawyers?|judges?|magistrates?"
    r"|labou?r|wages?|employees?|employers?|workplace|gratuity|provident\s+fund"
    r"|dowry|domestic\s+violence|harassment|posh|cyber\w*|fraud|defamation|trespass"
    r"|theft|crimes?|offen[cs]es?|punish\w*|bailable|cognizable|evidence|witness\w*"
    r"|gst|tax(?:es)?|aadhaar|voter\w*|elections?|reservation|juveniles?|minors?"
    r"|human\s+rights|women'?s?|child(?:ren)?|senior\s+citizens?|disabilit\w+|pension"
    r"|insurance|challan|licen[cs]e|passport|privacy|data\s+protection"
    r")\b",
    re.IGNORECASE,
)

# The query parser restates the message in English ("The user wants to know
# about ...") and its prefix-stripper can reduce it to a bare topic
# ("citizens' rights."), so both shapes count as an explanatory opener too.
_NORMALIZED_OPENER_RE = re.compile(
    r"^\s*(?:the\s+)?(?:user|person|citizen|individual)\s+"
    r"(?:wants?|wishes|would\s+like|is\s+asking|asks?|seeks?|is\s+seeking|is\s+requesting|requests?|needs?)\s+"
    r"(?:to\s+(?:know|understand|learn)|about|for\s+(?:an?\s+)?(?:information|explanation|overview|details)"
    r"|(?:an?\s+)?(?:information|explanation|overview|details)|what\b)",
    re.IGNORECASE,
)
_BARE_TOPIC_RE = re.compile(
    r"^\s*(?:\S+\s+){0,3}(?:rights?|laws?|acts?|rules?|procedures?|process|duties)\s*[.?!]*\s*$",
    re.IGNORECASE,
)

# A personal incident or a request for next steps → strict path.
_SPECIFIC_RE = re.compile(
    r"\b(?:"
    r"what\s+(?:should|can|do|must|shall)\s+i\s+do|what\s+to\s+do|what\s+next"
    r"|how\s+(?:do|can|should|shall|to)\s+(?:i|we)\b|how\s+to\b"
    r"|(?:can|should|may|must|shall|will|do)\s+(?:i|we)\b|am\s+i\b|is\s+it\s+legal\s+for\s+me"
    r"|help\s+me|my\s+case|my\s+situation|happened|yesterday|today|last\s+(?:night|week|month|year)"
    r"|i\s+(?:was|am|have|had|got|did|lost|paid|signed|received|filed|bought|sold)\b|i'm\b|i've\b"
    r"|(?:he|she|they|someone|somebody)\s+(?:is|are|was|were|has|have|had|did|took|hit|beat)\b"
    r"|my\s+(?:husband|wife|father|mother|son|daughter|brother|sister|landlord|tenant|employer"
    r"|boss|neighbou?r|friend|phone|mobile|money|salary|deposit|land|house|flat|car|bike|account)\b"
    r"|stolen|snatch\w*|robbed|beaten|beat\s+me|hit\s+me|cheated|scammed|fired|terminated|evicted"
    r"|threat\w*|blackmail\w*|refus\w*|denied|not\s+\w+ing|won'?t|doesn'?t|didn'?t|isn'?t|hasn'?t"
    r")\b",
    re.IGNORECASE,
)

# A named section/article → the database path, which can quote it exactly.
_SECTION_REF_RE = re.compile(
    r"(?:\b(?:section|sec\.?|s\.|article|art\.?|rule|order|clause)\s*\d"
    r"|\b\d+[a-z]?\s*(?:ipc|bns|bnss|bsa|crpc|cpc)\b"
    r"|धारा\s*\d|अनुच्छेद\s*\d)",
    re.IGNORECASE,
)


def is_general_question(
    normalized_en: str | None,
    raw: str | None = None,
    informational_hint: bool = False,
) -> bool:
    """True only for a confidently general, explanatory legal question.

    normalized_en      — the query parser's English restatement (or the raw
                         text when the parser fell back).
    raw                — the user's own words.
    informational_hint — the parser marked the message urgency="informational".

    A personal-incident, next-steps or section marker in EITHER text always
    keeps the strict path. Otherwise the message must name a legal topic and
    read as a request for an explanation: by its own opener, by the parser's
    restatement, as a bare topic ("consumer rights"), or by the parser's hint.
    """
    norm = (normalized_en or "").strip()
    user = (raw or "").strip()
    if not norm and not user:
        return False
    if len(norm.split()) > _MAX_WORDS + 5 or len(user.split()) > _MAX_WORDS:
        return False
    both = f"{norm}\n{user}"
    if _SECTION_REF_RE.search(both) or _SPECIFIC_RE.search(both):
        return False
    if not _LEGAL_TOPIC_RE.search(both):
        return False
    return bool(
        _GENERAL_OPENER_RE.search(user)
        or _GENERAL_OPENER_RE.search(norm)
        or _NORMALIZED_OPENER_RE.search(norm)
        or _BARE_TOPIC_RE.search(norm)
        or _BARE_TOPIC_RE.search(user)
        or informational_hint
    )


# ── 2. Instructions for the general lane ────────────────────────────────────

def augment_prompt_with_general_lane(system_prompt: str, lang_display: str, has_sources: bool) -> str:
    """Append the general-lane block. It REPLACES the base prompt's rule 6
    (refuse when SOURCES is empty) and its two-part FORMAT for this reply
    only; every other hard rule (no section numbers, no verbatim law, no
    markdown, reply language, the disclaimer line) still applies."""
    sources_line = (
        "A SOURCES block is provided above. Use it first, and prefer it wherever it covers the point."
        if has_sources else
        "No SOURCES block was found for this question. That is expected for a general question: "
        "do NOT refuse for that reason."
    )
    return system_prompt + f"""

GENERAL-QUESTION MODE (this block overrides rule 6 and the FORMAT above, for THIS reply only):
The user is asking a general question to understand the law, not describing their own case.
{sources_line}
You MAY explain well-settled, basic Indian law in your own plain words from general knowledge: what a right, an office, a document or a procedure is, who it protects, and how it broadly works.

LOCKS (still absolute):
a. Never state a money amount, fine, fee, time limit, deadline, age, punishment length or percentage unless that exact figure appears in the SOURCES block. If you have no source for a figure, say it in words without the number (for example "within a time limit set by law") or leave it out.
b. Rules 1 to 5 and rule 7 above still apply: no section, article or clause numbers, no Act short-names like BNS or IPC, no verbatim law, no markdown, no emoji, mention real exceptions.
c. India's criminal laws were replaced in 2024. Do not describe criminal procedure or offences in a way that depends on which Act applies; keep to the plain idea.
d. Only settled basics. If the honest answer depends on facts, on the state, or on a recent change you are not sure of, say that in one plain sentence instead of guessing.
e. If the question is not about Indian law, legal rights, legal procedure or dealing with authorities, reply exactly with the rule 7 sentence and STOP.

FORMAT for this reply (headings written in {lang_display}; nothing else):

<heading meaning "Answer:" in {lang_display}> <the direct answer in AT MOST TWO short sentences.>

<heading meaning "Key points:" in {lang_display}>
- <2 to 4 word label> – <one plain line, under 20 words>
- <label> – <one plain line>
- <label> – <one plain line>
- <optional 4th to 6th points, same shape>

<ONLY if there is a real, useful next step: heading meaning "What you can do:" in {lang_display}, then 1 to 3 short action bullets. Otherwise leave this part out entirely. Never write filler such as "read about your rights".>

Keep the whole reply under 130 words. Then a blank line, then the disclaimer line exactly as instructed above. Ignore any PRO MODE instruction for this reply.
"""


# ── 3. Hard-fact lock: figures must come from the sources ───────────────────

_NUM = r"\d[\d,]*(?:\.\d+)?"
_FIGURE_RE = re.compile(
    r"(?:(?:₹|rs\.?|inr)\s*" + _NUM + r"(?:\s*(?:lakhs?|crores?|thousand|hundred))?"
    r"|" + _NUM + r"\s*(?:rupees?|lakhs?|crores?)"
    r"|" + _NUM + r"\s*(?:%|per\s*cent|percent)"
    r"|" + _NUM + r"\s*-?\s*(?:years?|yrs?|months?|weeks?|days?|hours?|hrs?)"
    r"|" + _NUM + r"\s*(?:साल|वर्ष|महीने|माह|दिन|घंटे|रुपये|रुपए))",
    re.IGNORECASE,
)
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def _norm_figure(s: str) -> str:
    s = s.translate(_DEVANAGARI_DIGITS).lower().replace(",", "")
    s = re.sub(r"\s+|-", "", s)
    s = re.sub(r"^(?:rs\.?|inr)", "₹", s)
    s = re.sub(r"(?:yrs?|years?)$", "year", s)
    s = re.sub(r"months?$", "month", s)
    s = re.sub(r"weeks?$", "week", s)
    s = re.sub(r"days?$", "day", s)
    s = re.sub(r"(?:hrs?|hours?)$", "hour", s)
    s = re.sub(r"(?:percent|percent|per\s*cent)$", "%", s)
    s = re.sub(r"rupees?$", "₹", s)
    return s


def find_unsupported_figures(answer: str | None, source_text: str | None) -> list[str]:
    """Figures (money, time periods, percentages) in *answer* that do not
    appear in *source_text*. Order preserved, duplicates removed. Returns the
    figures as written in the answer — numbers only, never user content."""
    if not answer:
        return []
    allowed = {_norm_figure(m.group(0)) for m in _FIGURE_RE.finditer(source_text or "")}
    out: list[str] = []
    seen: set[str] = set()
    for m in _FIGURE_RE.finditer(answer):
        raw = m.group(0).strip()
        key = _norm_figure(raw)
        if key in allowed or key in seen:
            continue
        seen.add(key)
        out.append(raw)
    return out


def figure_repair_prompt(lang_display: str, figures: list[str]) -> str:
    """System prompt for the single rewrite pass that removes unsupported figures."""
    listed = "; ".join(figures[:12])
    return (
        "You are an editor. Rewrite the text you are given so that it no longer contains these "
        f"figures: {listed}. Replace each with plain words that carry no number (for example "
        "\"a time limit set by law\", \"a fine\", \"a prison term\") or remove the clause. "
        "Do not add any new number, section or article. Keep every heading, every bullet, the "
        f"disclaimer line and the order exactly as they are, and keep the language ({lang_display}). "
        "Output only the rewritten text."
    )
