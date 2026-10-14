"""Phase 1 hotfix — final output guard + citation-after-answer gating.

Feature-flagged by CITATION_GUARD_ENABLED (chat_router.py reads the flag;
this module is pure and has no flag logic of its own, so it is trivially
testable). Scope, per the approved plan:

  * Runs ONLY on DHARA-authored text — the model's own prose, refusal
    sentences and fixed templates. It must NEVER be run on a citation's
    `official_text` / `citation` fields (quoted corpus text), which are
    separate SSE payloads chat_router.py never passes through here.
  * Repeated small words (the/a/of/to/and) are silently collapsed — never
    a blocking condition.
  * Two different banned-word rules apply, per the approved refinement:
      (a) DHARA's OWN hardcoded strings (refusal constants, section
          headers, templates) — strict, zero-tolerance ban on the 6
          words, enforced by removing them from the source text itself
          (see engine/answer_generator.py, dependencies.py, server.py —
          none of those strings contain a banned word any more).
          `contains_banned_word_strict()` exists for any FUTURE
          dynamically-built DHARA-authored string that needs the same
          zero-tolerance rule at runtime.
      (b) LLM-GENERATED ANSWER TEXT — the only thing actually passed
          through `validate_dhara_text()` at runtime. Ordinary legal
          terms of art ("certified copy", "verified affidavit", "approved
          by the court", "rights guaranteed by the Constitution", "the
          court's verdict") must pass untouched. Only a CLAIM about
          DHARA/its answer/its sources/a draft being verified, certified,
          approved, guaranteed, or "the verdict" (self-attributed, not
          attributed to a court/judge/tribunal) is blocked — plus
          "court-ready" (no legitimate legal-term-of-art sense) and the
          literal "[UNVERIFIED]" marker, both always blocked.
"""
from __future__ import annotations

import re

# Master list — used for the STRICT, zero-tolerance check (rule a, DHARA's
# own hardcoded strings). Kept separate from the answer-text rule (b/c).
BANNED_WORDS: tuple[str, ...] = (
    "verified", "certified", "approved", "court-ready", "guaranteed", "verdict",
)

_UNVERIFIED_MARKER = "[UNVERIFIED]"

_BANNED_WORD_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in BANNED_WORDS) + r")\b",
    re.IGNORECASE,
)

# ── Rule (c): legal terms of art that must NEVER be blocked in answer text,
# even though they contain a banned word. Checked first; any match is
# carved out before the claim-pattern check below runs.
_ALLOWED_LEGAL_TERMS_RE = re.compile(
    r"\bcertified\s+cop(?:y|ies)\b"
    r"|\bverified\s+(?:affidavit|complaint|pleading|petition|statement)s?\b"
    r"|\bverification\b"
    r"|\bapproved\s+by\s+(?:the\s+)?(?:court|government|RBI|scheme|authority|board|ministry|department|regulator|tribunal)\b"
    r"|\b(?:rights?|freedoms?)\s+guaranteed\s+by\s+(?:the\s+)?(?:constitution|part\s+III|article\s+\d+[A-Za-z]?)\b"
    r"|\b(?:the\s+)?(?:court'?s|judge'?s|tribunal'?s)\s+verdict\b",
    re.IGNORECASE,
)

# ── Rule (b): a CLAIM about DHARA / its answer / its sources / a draft —
# this is what actually gets blocked in LLM-generated answer text.
_DHARA_CLAIM_SUBJECT = r"(DHARA|this\s+(?:answer|draft|response|source|information|document|advice)|the\s+(?:answer|draft|response|source|information|document|advice))"
_DHARA_CLAIM_RE = re.compile(
    rf"\b{_DHARA_CLAIM_SUBJECT}\b[^.?!\n]{{0,40}}\b(?:is|has|are|have|was|were)\b[^.?!\n]{{0,20}}\b(?:verified|certified|approved|guaranteed)\b"
    r"|\bcourt-ready\b"
    r"|\bguarantee[sd]?\s+(?:\w+\s+){0,2}(?:result|outcome|win|success)\b"
    r"|\b(?:DHARA'?s?|my|this)\s+verdict\b",
    re.IGNORECASE,
)

# Collapse ONLY these five small words when immediately repeated
# ("The the law" -> "The law"). Case-insensitive; keeps the first casing.
_SMALL_WORDS = ("the", "a", "of", "to", "and")
_REPEAT_RE = re.compile(
    r"\b(" + "|".join(_SMALL_WORDS) + r")\b(\s+)\1\b",
    re.IGNORECASE,
)

CANNOT_CONFIRM_MESSAGE = "I cannot confirm this from the official text."

# Heuristic markers that identify a model-authored refusal / "cannot
# confirm" answer, used ONLY to decide whether to suppress citations —
# narrow by design to avoid false positives on a substantive answer that
# merely contains the word "confirm".
_REFUSAL_MARKERS = re.compile(
    r"(don'?t have a verified source|do not have a verified source|"
    r"cannot confirm this|could not find an active|no verified source|"
    r"not have an? active .*law|could not verify)",
    re.IGNORECASE,
)


def contains_banned_word_strict(text: str) -> bool:
    """Zero-tolerance whole-word check — rule (a), DHARA's OWN hardcoded
    strings only (labels, refusal constants, templates). Not used on
    LLM-generated answer text — see contains_dhara_claim_violation()."""
    return bool(text) and bool(_BANNED_WORD_RE.search(text))


def contains_dhara_claim_violation(text: str) -> bool:
    """Rule (b)+(c) — for LLM-GENERATED ANSWER TEXT only.

    True only when the text makes a CLAIM about DHARA/its answer/its
    sources/a draft being verified/certified/approved/guaranteed, or a
    self-attributed "verdict", or says "court-ready". Ordinary legal terms
    of art (certified copy, verified affidavit, approved by the court,
    rights guaranteed by the Constitution, the court's verdict) are
    carved out first and never trigger this.
    """
    if not text:
        return False
    stripped = _ALLOWED_LEGAL_TERMS_RE.sub(" ", text)
    return bool(_DHARA_CLAIM_RE.search(stripped))


def collapse_repeated_small_words(text: str) -> tuple[str, int]:
    """Collapse immediate repeats of the/a/of/to/and. Never blocks output.

    Returns (clean_text, number_of_repeats_collapsed) — the count is for
    reason-code-style logging only (never the text itself).
    """
    if not text:
        return text, 0
    count = 0
    prev = None
    out = text
    while prev != out:
        prev = out
        out, n = _REPEAT_RE.subn(r"\1", out)
        count += n
    return out, count


def looks_like_refusal(text: str) -> bool:
    """True when DHARA-authored text reads as a 'cannot confirm' answer.

    Used only to decide whether retrieved citations should be shown
    alongside this answer — never used to alter the text itself.
    """
    return bool(text) and bool(_REFUSAL_MARKERS.search(text))


def validate_dhara_text(text: str) -> tuple[str, bool, int]:
    """Clean + validate LLM-GENERATED ANSWER TEXT (rule b/c — the only
    runtime call site today; see chat_router.py's `_candidate`).

    Returns (clean_text, blocked, repeats_collapsed).
      blocked=False -> clean_text is safe to show (small-word repeats
        collapsed; legal terms of art like "certified copy" or "rights
        guaranteed by the Constitution" are left exactly as written).
      blocked=True  -> the ORIGINAL text contained "[UNVERIFIED]" or made
        a claim about DHARA/its answer/sources/a draft being verified,
        certified, approved, guaranteed, "court-ready", or a self-
        attributed "verdict". Caller must substitute CANNOT_CONFIRM_MESSAGE
        instead of showing clean_text (repeats_collapsed is 0 in this
        case — no point collapsing text that will be discarded).
    """
    if not text:
        return text, False, 0
    if _UNVERIFIED_MARKER in text or contains_dhara_claim_violation(text):
        return text, True, 0
    clean, count = collapse_repeated_small_words(text)
    return clean, False, count
