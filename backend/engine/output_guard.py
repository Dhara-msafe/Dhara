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
  * Blocking conditions are narrow: the literal "[UNVERIFIED]" marker, or
    one of the 6 banned words as a WHOLE WORD. A real statute quote that
    happens to use "certified" (e.g. "certified copy") is quoted corpus
    text, not DHARA-authored prose, so it is out of scope for this guard
    by construction — never passed in here.
"""
from __future__ import annotations

import re

# Pilot's banned-word list (mirrors frontend src/voice/core/voicePolicy.ts
# BANNED_WORDS — kept in sync intentionally, not imported, since this is a
# separate backend-only Python module with no frontend dependency).
BANNED_WORDS: tuple[str, ...] = (
    "verified", "certified", "approved", "court-ready", "guaranteed", "verdict",
)

_UNVERIFIED_MARKER = "[UNVERIFIED]"

_BANNED_WORD_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in BANNED_WORDS) + r")\b",
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
    """Clean + validate text DHARA itself wrote.

    Returns (clean_text, blocked, repeats_collapsed).
      blocked=False -> clean_text is safe to show (small-word repeats
        collapsed; nothing else changed).
      blocked=True  -> the ORIGINAL text contained "[UNVERIFIED]" or a
        banned word; caller must substitute CANNOT_CONFIRM_MESSAGE instead
        of showing clean_text (repeats_collapsed is 0 in this case — no
        point collapsing text that will be discarded).

    MUST be called only on DHARA-authored prose (model answer, refusal
    sentence, fixed templates) — never on a citation's official_text.
    """
    if not text:
        return text, False, 0
    if _UNVERIFIED_MARKER in text or _BANNED_WORD_RE.search(text):
        return text, True, 0
    clean, count = collapse_repeated_small_words(text)
    return clean, False, count
