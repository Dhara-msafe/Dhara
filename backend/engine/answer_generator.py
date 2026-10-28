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


def recheck_dead_with_successor_release(
    active_ref: Optional[dict],
    hits: Iterable[dict],
    legacy_to_successor_family: dict,
) -> bool:
    """P0 containment (T04 — legal-release containment).

    Decides, for THIS turn only, whether the conversation's active statute
    reference is a verified dead law with a known successor — the sole
    condition allowed to exempt an all-dead retrieval set from the generic
    "cannot verify" refusal (see all_provisions_dead()/build_cannot_verify_
    response() callers in api/chat_router.py).

    A previously-stored `dead_with_successor` flag on `active_ref` (carried
    across turns via CaseState.active_statute_ref, a persisted session
    field) must NEVER be trusted on its own: conversation/topic memory is
    not approval evidence. Trusting a stored flag would let an earlier
    turn's determination silently authorize a later turn's answer even if
    that later turn's own retrieval no longer supports it. This function
    therefore ALWAYS re-derives the result from THIS turn's own retrieved
    `hits` and overwrites the stored flag with the freshly computed value
    (True or False) — a turn whose own retrieval no longer matches fails
    closed instead of inheriting a stale True.

    Mutates `active_ref` in place (same dict object, matching the prior
    inline behaviour) so the recomputed `dead_with_successor` /
    `successor_act_label` / `successor_act_family` fields are persisted for
    the *next* turn's retrieval carry-forward — but recomputed every call,
    never short-circuited by the previous value.
    """
    if not active_ref:
        return False
    ref_act = (active_ref.get("act") or "").strip().lower()
    ref_sec = (active_ref.get("section") or "").strip().upper()
    if not (ref_act and ref_sec):
        return False
    for h in hits or []:
        h_act = (h.get("act_name") or h.get("act") or "").strip().lower()
        h_sec = (h.get("section_number") or "").strip().upper()
        if h_act == ref_act and h_sec == ref_sec and (
            h.get("successor_act") or h.get("_successor_act")
        ):
            active_ref["dead_with_successor"] = True
            active_ref["successor_act_label"] = h.get("successor_act") or h.get("_successor_act")
            active_ref["successor_act_family"] = legacy_to_successor_family.get(ref_act)
            return True
    # This turn's own evidence does not support it — fail closed, clearing
    # any stale True a prior turn may have left on the persisted dict.
    active_ref["dead_with_successor"] = False
    return False


# ── Public builders ───────────────────────────────────────────────────────────

def augment_prompt_with_numeric_fidelity_lock(prompt: str) -> str:
    """P0 fix — a punishment/penalty's exact figures (e.g. 'six months to
    two years', a fine amount, a day/year limit) must never be rounded,
    estimated, or substituted from the model's own training-time memory of
    a similarly-named law. Observed failure: asked about BNS Section 199 /
    IPC Section 166A (verbatim SOURCES text: 'not less than six months but
    which may extend to two years, and shall also be liable to fine'), the
    model's own paraphrase instead said 'up to one year, or fine, or both'
    — the ADJACENT, unrelated IPC Section 166's figures, apparently from
    memorised training data, not from the SOURCES actually provided this
    turn. The existing 'never quote verbatim' rule (avoids leaking a full
    legal sentence as if DHARA wrote it) does not cover numeric fidelity —
    paraphrasing in different WORDS is fine; inventing different NUMBERS
    is not. Appended whenever any verified source text is present, not
    only for the dead-law-citation case.
    """
    return prompt + (
        "\n\nNUMERIC FIDELITY (mandatory):\n"
        "Any punishment duration, fine amount, age limit, deadline, or other specific number "
        "appearing in the SOURCES above must be repeated with the EXACT SAME FIGURES when you "
        "mention it — you may paraphrase the sentence around it in your own words, but never "
        "change, round, estimate, or substitute a number from memory of a similarly-named or "
        "adjacent section. If you are not certain a number you are about to state appears "
        "verbatim in SOURCES, omit that number rather than guess it."
    )


def correct_punishment_mismatch(text: str, hits: Iterable[dict]) -> str:
    """Deterministic, code-only correction — the prompt-level NUMERIC
    FIDELITY instruction above did not reliably stop this one specific,
    repeatedly-observed hallucination: for BNS Section 199 / IPC Section
    166A (verbatim punishment: 'rigorous imprisonment ... not less than
    six months ... may extend to two years ... also liable to fine'), the
    LLM kept substituting the ADJACENT, unrelated IPC Section 166's figure
    ('up to one year ... fine ... or both') regardless of instruction.
    Runs only when one of THIS turn's own verified hits is specifically
    BNS 199 or IPC 166A, and only replaces the specific wrong-duration
    phrase — never rewrites anything else model-authored, never invents a
    number not already present in a verified hit's own text.
    """
    if not text:
        return text
    _is_199_or_166a = any(
        (h.get("section_number") or "").upper() in ("199", "166A")
        and (
            "nyaya sanhita" in (h.get("act_name") or "").lower()
            or "penal code" in (h.get("act_name") or "").lower()
        )
        for h in (hits or [])
    )
    if not _is_199_or_166a:
        return text
    _wrong_duration_re = re.compile(
        r"up to (?:one|1)\s*year'?s?\s*(?:of\s*)?imprisonment|"
        r"imprisonment (?:for|of) up to (?:one|1)\s*year|"
        r"(?:one|1)\s*year(?:'s)?\s*imprisonment",
        re.IGNORECASE,
    )
    if _wrong_duration_re.search(text):
        text = _wrong_duration_re.sub(
            "rigorous imprisonment for a term of six months to two years", text,
        )
    return text



def augment_prompt_with_exact_dead_citation_lock(prompt: str, *, successor_approved: bool = False) -> str:
    """P0 fix — strong, explicit instruction for the one scenario the
    generic status-guard notice above was not firm enough for: the user
    named an EXACT (now-superseded) Act+Section by name, and the ONLY
    verified source is that dead provision with a KNOWN successor. The
    LLM kept defaulting to a generic "I cannot confirm this is in force,
    consult an advocate" refusal-style answer even though a real,
    verified citation (with its successor) was sitting right there in
    SOURCES — which then caused the citation-guard to (correctly, by its
    own narrow rule) treat the reply as a refusal and almost discard the
    citation. This instruction removes the ambiguity: the model must
    state the provision's content and successor plainly, never refuse.

    Emergent support fix 3d: the instruction to name the successor
    section is given ONLY when the (dead section -> successor section)
    relationship has an allowlisted-reviewer, hash-bound approval
    (engine.correspondence_gate). Default is fail-closed: the model is told
    not to name or guess any successor section number.
    """
    if not successor_approved:
        return prompt + (
            "\n\nEXACT-SECTION LOOKUP NOTICE (mandatory):\n"
            "The user explicitly asked about ONE specific, now-superseded section by name. "
            "A verified source for that exact section IS available above (marked DEAD LAW). "
            "Do NOT say you 'cannot confirm' this or that there is 'no verified "
            "source' — there is one. Instead: (1) state plainly what that section covered/the "
            "punishment it carried, clearly labelled as the now-replaced provision; (2) do NOT "
            "name or guess any successor section number — no approved correspondence is "
            "available; (3) note this old text no longer applies to new "
            "matters, only to events/FIRs/trials from before the cutover."
        )
    return prompt + (
        "\n\nEXACT-SECTION LOOKUP NOTICE (mandatory):\n"
        "The user explicitly asked about ONE specific, now-superseded section by name. "
        "A verified source for that exact section IS available above (marked DEAD LAW, with "
        "its successor). Do NOT say you 'cannot confirm' this or that there is 'no verified "
        "source' — there is one. Instead: (1) state plainly what that section covered/the "
        "punishment it carried, clearly labelled as the now-replaced provision; (2) name its "
        "successor act/section from SOURCES; (3) note this old text no longer applies to new "
        "matters, only to events/FIRs/trials from before the cutover."
    )


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
        # Emergent support fix 3e: a section-level successor_act is named
        # only when its relationship is approved; otherwise fall back to the
        # act-level successor_act_id (unchanged behaviour) or omit it.
        successor = h.get("successor_act_id")
        if h.get("successor_act"):
            from engine.correspondence_gate import check_successor_claim
            if check_successor_claim(h.get("act_name") or h.get("act"), h.get("section_number"),
                                     h.get("successor_act")).approved:
                successor = h.get("successor_act")
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


def build_bns_identifier_hypothesis_response(
    act_hint: str,
    section_hint: str,
    hypothesis: dict,
    *,
    registry: Optional[List[dict]] = None,
    authorized_reviewers: Optional[List[dict]] = None,
) -> str:
    """Deterministic, hedged response for a well-formed BNS/BNSS/BSA reference
    whose exact record is absent AND whose number is not confirmed to exist
    in the verified correspondence index, but DOES match a former IPC/CrPC/
    Evidence-Act number.

    Never asserts the section doesn't exist — only that this is unconfirmed —
    and OFFERS the old-law correspondence as a possible intended reference,
    never a silent substitution. Deterministic/template, not LLM-authored, so
    it can never invent a punishment or statutory claim.

    Emergent support fix 3d: the IPC->BNS correspondence sentence (which
    names a successor section number) is included ONLY when that exact
    relationship is approved (engine.correspondence_gate). Otherwise the
    response keeps only the existing "no verified record" hedge and the
    existing advocate/disclaimer wording, and names no successor number.
    """
    from engine.correspondence_gate import check_relationship
    bns_sec = hypothesis.get("bns_section", "")
    if not check_relationship(section_hint, bns_sec, registry=registry,
                              authorized_reviewers=authorized_reviewers).approved:
        return (
            f"I don't have a verified record confirming that {act_hint} has a Section "
            f"{section_hint}. I also can't independently confirm it does NOT exist \u2014 this is "
            f"only a gap in what I can verify right now, not a ruling on the section itself.\n\n"
            f"Please confirm with a licensed advocate before relying on it.\n\n"
            f"\u26a0\ufe0f Legal information, not legal advice."
        )
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
