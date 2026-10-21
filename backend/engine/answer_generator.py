"""Layer M — Answer Generator hardening.

The existing `build_system_prompt` in dependencies.py already enforces most
of the sprint-brief's anti-hallucination rules (no verbatim law, no section
numbers, refuse when corpus is empty). This module supplements that with:

  1.  build_cannot_verify_response(lq, language) — used when Layer S filters
      the entire retrieved set down to REPEALED / SUPERSEDED provisions.
      Returns a deterministic string (no LLM call needed) that tells the
      user "we could not verify an active law for this specific fact set".

  2.  all_provisions_dead(hits) — the trigger predicate.

  3.  augment_prompt_with_status_guard(prompt, hits) — appends a plain-language
      instruction to the LLM prompt when at least one cited provision has been
      flagged as SUPERSEDED or REPEALED by Layer S. Prevents the model from
      answering as if the law were still in force.

  4.  strip_leaked_citations(text) — a defence-in-depth post-processor that
      pairs with corpus.sanitize_model_output; called from chat_router.

Every function here is pure (except the class docstring) — no I/O, no DB
access — so it is trivial to test.
"""
from __future__ import annotations

import re
from typing import Iterable, List, Optional

from engine.models import LegalQuery


# ── Public predicates ─────────────────────────────────────────────────────────

def all_provisions_dead(hits: Iterable[dict]) -> bool:
    """True when every retrieved provision has been annotated as dead/superseded
    by Layer S (Law Status Guard). An empty iterable returns False — that is
    the 'no corpus match' case handled elsewhere by REFUSAL_NO_CORPUS.
    """
    hits = list(hits or [])
    if not hits:
        return False
    for h in hits:
        # Layer S annotations, plus MongoDB-corpus is_dead_law flag.
        if h.get("is_dead_law"):
            continue
        status = (h.get("status") or "").upper()
        if status in _DEAD_STATUSES:
            continue
        if (h.get("dead_warning") or "").strip():
            continue
        return False   # This one is alive → not all dead.
    return True


_DEAD_STATUSES = {
    "REPEALED",
    "SUPERSEDED",
    "STRUCK_DOWN",
    "NOT_YET_IN_FORCE",
    "PARTIALLY_REPEALED",   # Conservative: treat as dead for cannot-verify UX.
}


# ── Public builders ───────────────────────────────────────────────────────────

def build_cannot_verify_response(
    lq: Optional[LegalQuery],
    language: str = "en",
    *,
    dead_hits: Optional[List[dict]] = None,
) -> str:
    """Deterministic 'we cannot verify an active law for this' response.

    Format (per sprint brief §Layer M):
      ANSWER      : one honest sentence
      WHY         : plain reason (all retrieved laws are dead)
      WHAT YOU CAN DO: practical next steps
      VERIFIED SOURCES: list of dead sources with their status

    Kept short and factual — never invents a section number or claim.
    """
    subject = _subject_phrase(lq)
    dead_lines: list[str] = []
    for h in (dead_hits or [])[:5]:
        act = h.get("act_name") or h.get("short_label") or "This provision"
        sec = h.get("section_number")
        status = (h.get("status") or "SUPERSEDED").upper()
        successor = h.get("successor_act") or h.get("successor_act_id")
        line = f"- {act}"
        if sec:
            line += f", Section {sec}"
        line += f" — status: {status}"
        if successor:
            line += f" (replaced by {successor})"
        dead_lines.append(line)
    sources_block = "\n".join(dead_lines) if dead_lines else "- (No active statutory source located for this exact fact set.)"

    body = (
        f"ANSWER\n"
        f"I could not find an ACTIVE Indian law that clearly settles {subject} for the facts you gave.\n\n"
        f"WHY\n"
        f"The provisions our corpus surfaced for this question have been REPEALED or "
        f"SUPERSEDED by newer legislation (for example IPC → BNS from 1 July 2024). I will not "
        f"quote a dead law as if it were still in force.\n\n"
        f"WHAT YOU CAN DO\n"
        f"- Rephrase with the event date, state, and the exact action taken — that often unlocks a "
        f"matching current statute.\n"
        f"- Consult a licensed advocate for the current position, especially if the incident is "
        f"post-July 2024 (BNS / BNSS / BSA era).\n"
        f"- If this is urgent, dial 112; women in distress can dial 1091.\n\n"
        f"SOURCES (status shown transparently)\n"
        f"{sources_block}\n\n"
        f"⚠️ Legal information, not legal advice. Consult an advocate. © Callistus Moses · MSafe Solutions."
    )
    # If the user's language is not English, keep the English fallback but tag
    # it so an upstream translator (langpolicy.repair_prompt) can convert if
    # needed. This is safer than emitting broken machine translation here.
    if language and language.lower() != "en":
        return body + f"\n\n[lang_hint:{language}]"
    return body


def build_bns_identifier_hypothesis_response(act_hint: str, section_hint: str, hypothesis: dict) -> str:
    """Deterministic, hedged response for a well-formed BNS/BNSS/BSA reference
    whose exact record is absent AND whose number is not confirmed to exist
    in the verified correspondence index, but DOES match a former IPC/CrPC/
    Evidence-Act number.

    Never asserts the section doesn't exist — only that this is unconfirmed —
    and OFFERS the old-law correspondence as a possible intended reference,
    never a silent substitution. Deterministic/template, not LLM-authored, so
    it can never invent a punishment or statutory claim.
    """
    bns_sec = hypothesis.get("bns_section", "")
    return (
        f"I don't have a verified record confirming that {act_hint} has a Section "
        f"{section_hint}. I also can't independently confirm it does NOT exist \u2014 this is "
        f"only a gap in what I can verify right now, not a ruling on the section itself.\n\n"
        f"You may be thinking of the former IPC Section {section_hint}, which under the "
        f"IPC\u2192BNS renumbering corresponds to BNS Section {bns_sec}. I haven't "
        f"independently re-verified this beyond that correspondence table, so please confirm "
        f"with a licensed advocate before relying on it.\n\n"
        f"\u26a0\ufe0f Legal information, not legal advice."
    )


def augment_prompt_with_status_guard(prompt: str, hits: Iterable[dict]) -> str:
    """Append a plain-language instruction reminding the LLM to flag dead laws.

    Only appends the instruction when at least one hit is dead — otherwise
    the prompt stays untouched (no wasted tokens).
    """
    dead = [h for h in (hits or []) if _is_dead(h)]
    if not dead:
        return prompt
    names = []
    for h in dead[:3]:
        act = h.get("act_name") or h.get("short_label") or "a cited provision"
        sec = h.get("section_number")
        names.append(f"{act}" + (f" §{sec}" if sec else ""))
    guard = (
        "\n\nSTATUS-GUARD NOTICE (Layer S):\n"
        f"The corpus flagged these as dead/superseded: {', '.join(names)}. "
        "In your reply, do NOT describe these as if they were currently enforceable. "
        "If the question is answered by the successor law (e.g. BNS in place of IPC), "
        "answer using the CITIZEN-LEVEL description of the successor rule; if no "
        "successor is available in the SOURCES above, tell the user plainly that "
        "the older law no longer applies and ask them to consult an advocate."
    )
    return prompt + guard


# ── ACTOR-CONDUCT LOCK (structural invariant — see README_DEPLOYMENT.md) ─────
# Primary defence: a prompt-level instruction (same pattern as the Layer S
# status-guard above). Only fires when engine.conduct_classifier.classify()
# (Layer B) has already determined, from positive evidence in the query, that
# the user is asking about an actor OTHER than themselves.

_OBLIGATION_TOKENS = re.compile(
    r"\b(must|required to|is liable|are liable|liable|responsible|duty|shall|cannot)\b",
    re.IGNORECASE,
)
# Conservative, high-precision, per-phrase replacements — only the clearest
# "duty imposed directly on the addressee" phrasings. Deliberately excludes
# "you cannot ..." from auto-reframing: that phrasing is frequently a RIGHT
# correctly addressed to the user (e.g. "you cannot be denied an FIR"), and a
# blind actor-swap would corrupt it into nonsense. "cannot" still counts
# toward has_obligation_language() for observability, just not auto-rewritten.
_DIRECT_OBLIGATION_REPLACEMENTS = [
    (re.compile(r"\byou must\b", re.IGNORECASE), "the {actor} must"),
    (re.compile(r"\byou shall\b", re.IGNORECASE), "the {actor} shall"),
    (re.compile(r"\byou are required to\b", re.IGNORECASE), "the {actor} is required to"),
    (re.compile(r"\byou are liable\b", re.IGNORECASE), "the {actor} is liable"),
    (re.compile(r"\byou are responsible\b", re.IGNORECASE), "the {actor} is responsible"),
    (re.compile(r"\byour duty is\b", re.IGNORECASE), "the {actor}'s duty is"),
]
_DIRECT_OBLIGATION_TO_USER = re.compile(
    "|".join(p.pattern for p, _ in _DIRECT_OBLIGATION_REPLACEMENTS), re.IGNORECASE,
)


def augment_prompt_with_actor_conduct_lock(prompt: str, classify_result) -> str:
    """ACTOR-CONDUCT LOCK — append a reframing instruction when Layer B found
    a mismatch between who the user says they are and who is actually
    regulated by the conduct in question. No-op when there is no mismatch.
    """
    if not getattr(classify_result, "actor_mismatch", False):
        return prompt
    regulated_actor = classify_result.regulated_actor or "the other party"
    regulated_conduct = classify_result.regulated_conduct or "this matter"
    user_role = classify_result.user_role or "the user"
    guard = (
        "\n\nACTOR-CONDUCT LOCK NOTICE:\n"
        f"The user identifies as a '{user_role}', NOT as the '{regulated_actor}' who is "
        f"legally regulated regarding '{regulated_conduct}'. Do NOT phrase any obligation, "
        f"duty, liability, or must/required/shall language as applying TO the user. "
        f"Reframe the answer around the '{user_role}''s OWN rights and remedies — what "
        f"they can do or demand if the '{regulated_actor}' fails to comply — and never "
        f"present the '{regulated_actor}''s legal duty as if it were the user's own obligation."
    )
    return prompt + guard


def has_obligation_language(text: str) -> bool:
    """Pure predicate — true if obligation-language tokens are present."""
    return bool(_OBLIGATION_TOKENS.search(text or ""))


def reframe_misdirected_obligations(text: str, classify_result) -> str:
    """ACTOR-CONDUCT LOCK — defence-in-depth post-processor.

    If Layer B flagged an actor mismatch AND the generated text still
    directly addresses the user with obligation language ("You must...",
    "your duty is..."), soften/reframe it toward the regulated actor. Runs
    alongside (not instead of) the prompt-level instruction above — the
    same belt-and-braces pattern as strip_leaked_citations for citations.

    Deliberately does NOT touch "you cannot ..." — that phrasing is
    frequently a RIGHT correctly addressed to the user (e.g. "you cannot be
    denied an FIR"), and a blind actor-swap would corrupt it into nonsense.
    """
    if not getattr(classify_result, "actor_mismatch", False) or not text:
        return text
    if not has_obligation_language(text):
        return text
    if not _DIRECT_OBLIGATION_TO_USER.search(text):
        return text
    regulated_actor = classify_result.regulated_actor or "the other party"
    for pattern, template in _DIRECT_OBLIGATION_REPLACEMENTS:
        text = pattern.sub(template.format(actor=regulated_actor), text)
    return text


# ── Post-processor ────────────────────────────────────────────────────────────

# Includes both acronyms AND the spelled-out "(Indian) Evidence Act" — the
# pre-existing regex only ever recognised the acronyms, so a leaked
# "Evidence Act Section 27" (real, common phrasing since BSA replaced it)
# was never scrubbed by either ordering. Longer alternative listed first so
# the regex engine doesn't stop at a partial word-boundary match.
_ACT_NAMES = r"(?:(?:Indian\s+)?Evidence\s+Act|BNS|BNSS|BSA|IPC|CrPC|PWDVA|POSH|RTI|MV|MVA|DPDP)"

# Forward order — "IPC Section 302", "IPC 420", "BNS Sec. 318(2)".
_LEAK_SECTION_FWD = re.compile(
    rf"\b{_ACT_NAMES}\s*(?:Section|Sec\.?)?\s*\d+[A-Za-z]?(?:\(\d+\))?",
    re.IGNORECASE,
)
# Reverse order — "Section 302 of the IPC", "u/s 420 IPC", "under Section 154 CrPC".
# This is the phrasing gap real-world LLM leaks most often use, since it
# reads more naturally in English than the forward "IPC Section 302" form.
# NOTE: "under" is deliberately NOT one of the leading keywords here — when
# it precedes a bare number ("punishable under 376 IPC") it must survive the
# substitution so "under the law" still reads correctly; that bare case is
# caught separately by _LEAK_BARE_NUM_ACT below, which never consumes "under".
_LEAK_SECTION_REV = re.compile(
    rf"\b(?:u/s\.?|Section|Sec\.?)\s*\d+[A-Za-z]?(?:\(\d+\))?"
    rf"\s*(?:of\s+the\s+|of\s+|under\s+the\s+|under\s+)?{_ACT_NAMES}\b",
    re.IGNORECASE,
)
# Bare number immediately followed by the act name, no keyword at all —
# "376 IPC", "420 BNS", "punishable under 376 IPC" (only "376 IPC" matches,
# "under" is left intact). Digit run capped at 3 (plus an optional letter
# suffix like "304B") so 4-digit years ("1860 IPC was enacted") are not
# mistaken for a section number.
_LEAK_BARE_NUM_ACT = re.compile(
    rf"\b\d{{1,3}}[A-Za-z]?\b\s*{_ACT_NAMES}\b",
    re.IGNORECASE,
)
_LEAK_ARTICLE = re.compile(r"\bArticle\s+\d+[A-Za-z]?\b", re.IGNORECASE)


def strip_leaked_citations(text: str) -> str:
    """Belt-and-braces guard — removes leaked 'Section 43' / 'Article 21' strings
    from the LLM reply. Paired with corpus.sanitize_model_output so a regex
    miss on one side is caught by the other.

    Catches BOTH citation orderings real-world replies use:
      • forward:  "IPC Section 420", "BNS 318"
      • reverse:  "Section 420 of the IPC", "u/s 420 IPC", "under Section 154 CrPC"
      • bare:     "376 IPC" (no "Section"/"u/s" keyword at all)

    Intentionally conservative: only strips the identifier itself, leaving
    surrounding grammar intact. If the reply reads oddly after stripping, the
    citation chips shown separately in the UI still convey the exact rule.
    """
    if not text:
        return text
    # Order matters: reverse/keyword-anchored patterns first (more specific),
    # then the forward act-first pattern, then the bare-number fallback —
    # each pass only touches text the earlier passes left untouched.
    # DHARA-B022: a leaked, unverifiable citation is still fully removed
    # (never shown as a bare "IPC 420" style assertion with no matching
    # source) — but the replacement now visibly flags that a citation was
    # caught here, instead of silently rewriting to generic "the law" with
    # no trace anything was filtered.
    text = _LEAK_SECTION_REV.sub("the law [UNVERIFIED]", text)
    text = _LEAK_SECTION_FWD.sub("the law [UNVERIFIED]", text)
    text = _LEAK_BARE_NUM_ACT.sub("the law [UNVERIFIED]", text)
    text = _LEAK_ARTICLE.sub("the constitutional right [UNVERIFIED]", text)
    # Collapse doubled spaces / punctuation left by the substitution.
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return text


# ── Helpers ───────────────────────────────────────────────────────────────────

def _subject_phrase(lq: Optional[LegalQuery]) -> str:
    """Short human phrase for the ANSWER line — never invents facts."""
    if not lq:
        return "your question"
    actions = [a for a in (lq.actions or []) if a] or []
    issues = [i for i in (lq.candidate_issues or []) if i] or []
    if actions and issues:
        return f"'{actions[0]} → {issues[0]}'"
    if issues:
        return f"'{issues[0]}'"
    if actions:
        return f"'{actions[0]}'"
    if lq.normalized_query:
        return f"'{lq.normalized_query[:80]}'"
    return "your question"


def _is_dead(h: dict) -> bool:
    if not h:
        return False
    if h.get("is_dead_law"):
        return True
    if (h.get("status") or "").upper() in _DEAD_STATUSES:
        return True
    if (h.get("dead_warning") or "").strip():
        return True
    return False
