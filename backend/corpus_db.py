"""
corpus_db.py  —  MongoDB-backed legal-section retrieval for DHARA.

Architecture
------------
Two retrieval paths:

1. Exact section lookup (preferred when the user cites a specific section/article
   number).  Uses the act_name + section_number compound index — sub-millisecond.

2. Situational full-text search (when the user describes a problem).
   Uses the Atlas-compatible $text index on section_heading (w=10) + act_name
   (w=5) + section_text (w=1).  Optionally boosts results from the user's
   state jurisdiction to the top of the list.

Safety guards  (code, not prompts — non-negotiable per spec)
-------------------------------------------------------------
G1  Dead-law guard — if is_dead_law is True, prepend serve_warning *in the
    user's language* before any statutory text.  Dead sections are EXCLUDED
    from situational search but CAN appear in exact lookups so the app can
    explain that the section has been struck/omitted.

G2  Judicial-invalidation join — after retrieving any section, look it up in
    the judicial_invalidations collection.  If a record exists AND
    status != "UPHELD", prepend flag.user_warning to the answer.
    Records with status "UPHELD" are negative entries — suppress the warning.

G3  Badge logic —
      verify_tier == 1  AND  verified_by is not None/empty
          → badge = "Advocate Reviewed"  (gold)
      everything else
          → badge = "Sourced from Government of India"  (standard)

Integration note
----------------
This module is *additive*.  The caller should:
  1. Try corpus_db first.
  2. If it returns zero results, fall back to the Python corpus (corpus.py).
  3. If it returns results, use them — they carry live government-source text.

Returned dict shape (per result)
---------------------------------
{
  "act_name": str,
  "section_number": str,
  "section_heading": str,
  "section_text": str,        # verbatim government text
  "jurisdiction": str,        # "CENTRAL" | state full name
  "source_url": str,
  "verify_tier": int,         # 1 or 2
  "badge": str,               # human-readable badge label
  "is_dead_law": bool,
  "dead_warning": str|None,   # serve_warning value or None
  "judicial_flag": str|None,  # user_warning from judicial_invalidations or None
  "_score": float,            # text-search relevance score (0 for exact lookups)
}
"""

from __future__ import annotations

import asyncio
import json as _json
import re
from pathlib import Path as _Path

from motor.motor_asyncio import AsyncIOMotorDatabase

# Scoring + the ≥2-word Corroboration Rule are defined once in retrieval_logic
# and shared with corpus.py — never duplicated here. The safety guards below
# (is_dead_law / judicial_invalidations) are NOT in retrieval_logic; they stay
# in this module, unchanged.
from retrieval_logic import (
    SIG_STOPWORDS as _SIG_STOPWORDS,  # noqa: F401  (kept for reference/back-compat)
    MIN_COROBORATION_WORDS as _MIN_COROBORATION_WORDS,
    significant_words as _significant_words,
    corroboration_score as _corroboration_score,
    corroborates as _corroborates,  # noqa: F401  (kept for external callers)
    relative_top_cutoff as _relative_top_cutoff,
    expand_query as _expand_query,
    extract_exact_statute_ref as _extract_exact_statute_ref,  # P0-B
    classify_statute_reference_intent as _classify_statute_reference_intent,  # P0-D
    STATUTE_REF_VALID as _STATUTE_REF_VALID,  # P0-D
    STATUTE_REF_INVALID as _STATUTE_REF_INVALID,  # P0-D
)

# ── State code → corpus jurisdiction string ──────────────────────────────────
# The corpus `jurisdiction` field uses full English state names (as harvested
# from indiacode.gov.in).  User profiles store the 2-letter ISO-like state
# code (same as states.py).  This mapping bridges the two.
#
# States that ARE in the corpus (have section text):
#   MH, UP, RJ, JK, ML, TG, TN, JH, UK, MP, AN, KL
# All other state codes map to their official full name — even if no corpus
# sections exist yet, the mapping lets the API return a proper "not available"
# response instead of a silent failure.
STATE_CODE_TO_JURISDICTION: dict[str, str] = {
    "AN": "Andaman and Nicobar Islands",
    "AP": "Andhra Pradesh",
    "AR": "Arunachal Pradesh",
    "AS": "Assam",
    "BR": "Bihar",
    "CG": "Chhattisgarh",
    "CH": "Chandigarh",
    "DH": "Dadra and Nagar Haveli and Daman and Diu",
    "DL": "Delhi",
    "GA": "Goa",
    "GJ": "Gujarat",
    "HP": "Himachal Pradesh",
    "HR": "Haryana",
    "JH": "Jharkhand",
    "JK": "Jammu and Kashmir",
    "KA": "Karnataka",
    "KL": "Kerala",
    "LA": "Ladakh",
    "LD": "Lakshadweep",
    "MH": "Maharashtra",
    "ML": "Meghalaya",
    "MN": "Manipur",
    "MP": "Madhya Pradesh",
    "MZ": "Mizoram",
    "NL": "Nagaland",
    "OD": "Odisha",
    "PB": "Punjab",
    "PY": "Puducherry",
    "RJ": "Rajasthan",
    "SK": "Sikkim",
    "TG": "Telangana",
    "TN": "Tamil Nadu",
    "TR": "Tripura",
    "UK": "Uttarakhand",
    "UP": "Uttar Pradesh",
    "WB": "West Bengal",
}

# ── Section-number extraction ─────────────────────────────────────────────────
# Matches patterns like "Section 138", "s.138", "Art. 21", "Article 21A",
# "s 66A", "sec 9", etc.  Returns the bare number string ("138", "21A", "66A").
_SEC_RE = re.compile(
    r"(?:section|sections|sec|s\.|art(?:icle)?\.?)\s*(\d+[A-Za-z]{0,3})",
    re.IGNORECASE,
)
# Act-name hints extracted from the query to improve exact lookup accuracy.
_ACT_HINTS: dict[str, re.Pattern] = {
    # Bigamy/second-marriage phrasing is added here (not a separate hint key)
    # because the correct universal answer — BNS s.82 "Marrying again during
    # lifetime of husband or wife" — shares only ONE significant word
    # ("marri*") with common phrasings like "can an Indian marry twice", and
    # the >=2-word Corroboration Rule (retrieval_logic.MIN_COROBORATION_WORDS)
    # would otherwise filter it out even though it is the single most
    # relevant section in the corpus for that exact question.
    "Bharatiya Nyaya Sanhita": re.compile(
        r"bns|nyaya\s+sanhita|bigamy|marry\s+(?:twice|again)|marrying\s+again|"
        r"second\s+marriage|remarry\s+without\s+divorce|two\s+wives|two\s+husbands",
        re.I,
    ),
    "Bharatiya Nagarik Suraksha Sanhita": re.compile(r"bnss|nagarik\s+suraksha", re.I),
    "Bharatiya Sakshya Adhiniyam": re.compile(r"bsa|sakshya", re.I),
    "Information Technology": re.compile(r"\bit\s+act\b|information\s+technology", re.I),
    "Negotiable Instruments": re.compile(r"\bni\s+act\b|negotiable\s+instruments", re.I),
    "Indian Penal Code": re.compile(r"\bipc\b|indian\s+penal\s+code", re.I),
    "Code of Criminal Procedure": re.compile(r"\bcrpc\b|criminal\s+procedure", re.I),
    "Constitution of India": re.compile(r"constitution|article\s+\d", re.I),
    "Motor Vehicles": re.compile(r"motor\s+vehicles|mvact|mva\b", re.I),
    "Consumer Protection": re.compile(r"consumer\s+protection|consumer\s+court", re.I),
    "Protection of Women from Domestic Violence": re.compile(r"domestic\s+violence", re.I),
    "Right to Information": re.compile(r"\brti\b|right\s+to\s+information", re.I),
    "Labour Code|Code on Wages": re.compile(r"wages\s+code|code\s+on\s+wages", re.I),
    "Insolvency and Bankruptcy": re.compile(r"\bibc\b|insolvency.*bankruptcy", re.I),
    # ── Personal law (marriage/succession) — added alongside personal_law.py's
    # disambiguation flow. Each pattern is intentionally topic-specific (marriage
    # vs succession) so a marriage-only signal never boosts a succession Act and
    # vice-versa; server.py additionally appends one of these exact phrases to
    # the retrieval text once a religion/context is known, so these patterns
    # ALSO fire reliably off that silent hint rather than needing the user's
    # own wording to happen to match.
    "Hindu Marriage Act": re.compile(r"hindu\s+marriage\s+act|\bhma\b", re.I),
    "Hindu Succession Act": re.compile(r"hindu\s+succession\s+act|\bhsa\b", re.I),
    "Special Marriage Act": re.compile(r"special\s+marriage\s+act", re.I),
    "Indian Christian Marriage Act": re.compile(r"indian\s+christian\s+marriage\s+act|christian\s+marriage\s+act", re.I),
    "Dissolution of Muslim Marriages Act": re.compile(r"dissolution\s+of\s+muslim\s+marriages\s+act", re.I),
    "Indian Succession Act": re.compile(r"indian\s+succession\s+act", re.I),
    "Muslim Personal Law": re.compile(r"muslim\s+personal\s+law|shariat\s+application\s+act", re.I),
}


# ── Corroboration Rule (P0) ───────────────────────────────────────────────
# MongoDB's $text search scores a hit if it shares ANY indexed token with the
# query — including generic words ("fine", "penalty", "notice", "court") that
# appear in thousands of unrelated sections. To stop that noise, a text-search
# hit must PROVE real topical overlap before it is trusted:
#
#   PASS if EITHER
#     (a) the query names this hit's Act by name/abbreviation (a strong label
#         match — the same act_hint used for exact section lookup), OR
#     (b) the query shares >= _MIN_COROBORATION_WORDS significant words with
#         the hit's act_name + section_heading + section_text.
#
# The stopword vocabulary (_SIG_STOPWORDS), the significant-word extractor
# (_significant_words), the numeric re-rank score (_corroboration_score) and the
# boolean gate (_corroborates) all now live in retrieval_logic and are imported
# above — defined ONCE, shared with corpus.py. Exact section lookups
# (lookup_section) are untouched — they are already deterministic (act + section
# number), not a fuzzy text-search guess.

# Wide candidate pool fetched from MongoDB before corroboration re-ranking.
# The old value was `limit * 4 = 20` — too narrow when relevant sections score
# low on section_heading (weight=10) but high on section_text (weight=1).
# 300 ensures we capture deep-in-the-list genuine matches (e.g. MV Act §129
# where "helmet" sits in section_text, not the heading).
_CANDIDATE_POOL_SIZE = 300


def _act_name_prefix_regex(act_hint: str) -> re.Pattern:
    """Regex matching act_name values that START WITH `act_hint` (after an
    optional leading "The"/"An"/"A") — anchored, not a bare substring.

    Used for exact section lookups so a short hint like "Information
    Technology" cannot resolve to a completely different, longer-named Act
    that merely contains those words (e.g. "Indian Institutes of Information
    Technology Act"). Mirrors the same anchor used for ranking in
    retrieval_logic.py's `_act_name_leads_with`.
    """
    return re.compile(r"^(the\s+|an?\s+)?" + re.escape(act_hint[:60]), re.IGNORECASE)


def _badge(doc: dict) -> str:
    """G3 — Badge logic (code, not prompts)."""
    if doc.get("verify_tier") == 1 and doc.get("verified_by"):
        return "Advocate Reviewed"
    return "Sourced from Government of India"


def _dead_warning(doc: dict) -> str | None:
    """G1 — Return the serve_warning text if section is dead law, else None."""
    if not doc.get("is_dead_law"):
        return None
    return doc.get(
        "serve_warning",
        "⚠️ This section has been omitted or repealed. "
        "The text below is retained for historical reference and is NOT current law.",
    )


async def _judicial_flag(db: AsyncIOMotorDatabase, act_name: str, section_number: str) -> str | None:
    """G2 — Look up judicial_invalidations.  Return user_warning if flagged, else None."""
    rec = await db.judicial_invalidations.find_one(
        {"act_name": act_name, "section_number": section_number}
    )
    if not rec:
        return None
    # UPHELD entries are negative entries — they exist to *prevent* false warnings.
    if (rec.get("status") or "").upper() == "UPHELD":
        return None
    return rec.get("user_warning") or f"⚠️ This provision has been subject to judicial proceedings. Please verify current status with an advocate."


def _shape(doc: dict, score: float, jflag: str | None, is_anchored: bool = False) -> dict:
    """Convert a raw MongoDB document to the standard result dict.

    `is_anchored` marks a STRUCTURALLY high-confidence hit — an exact
    section-number lookup, or an explicit Act-label match (see
    corroboration_score's 9999 sentinel) — as opposed to a fuzzy hit that
    only cleared the bare MIN_COROBORATION_WORDS floor on generic-word
    overlap. server.py uses this to decide whether a MongoDB hit is trusted
    enough to stand alongside (or instead of) the curated Python corpus for
    the SAME query — see the "anchored-preference" merge rule there.
    """
    return {
        "act_name": doc.get("act_name", ""),
        "section_number": doc.get("section_number", ""),
        "section_heading": doc.get("section_heading", ""),
        "section_text": doc.get("section_text", ""),
        "jurisdiction": doc.get("jurisdiction", "CENTRAL"),
        "source_url": doc.get("source_url", ""),
        "verify_tier": doc.get("verify_tier", 2),
        "badge": _badge(doc),
        "is_dead_law": bool(doc.get("is_dead_law", False)),
        "dead_warning": _dead_warning(doc),
        "judicial_flag": jflag,
        "_score": score,
        "is_anchored": is_anchored,
        # Extra fields useful for display
        "ministry": doc.get("ministry", ""),
        "act_year": doc.get("act_year"),
        "act_id": doc.get("act_id", ""),
        "dead_law_reason": doc.get("dead_law_reason"),
        # P1 fix: pass through an optional successor-provision hint (e.g. IPC
        # 166A -> "Bharatiya Nyaya Sanhita, Section 199") so the EXISTING
        # cannot-verify/dead-law template in answer_generator.py can name the
        # current provision instead of just saying "superseded".
        "successor_act": doc.get("successor_act"),
    }


# ── P1 identifier-existence check ────────────────────────────────────────────
# Reuses the SAME ipc_bns_mapping.json correspondence table server.py's own
# IPC<->BNS cross-reference search already loads — no new dataset, no new
# engine. Purpose: tell apart "this BNS/BNSS/BSA section number genuinely has
# no record in legal_sections yet" (a grounding gap) from "there is no
# evidence this section number exists at all" (where an old IPC/CrPC/Evidence
# Act number may explain the user's confusion). Absence from this index must
# NEVER be read as proof of non-existence — only as "no evidence either way".
_XREF_JSON_PATH = _Path(__file__).parent / "ipc_bns_mapping.json"
_bns_family_existence_index: "set[str] | None" = None
_ipc_origin_hypothesis_index: "dict[str, dict] | None" = None

_NEW_SECTION_KEYS = ("bns_section", "bnss_section", "bsa_section")
_OLD_SECTION_KEYS = ("ipc_section", "crpc_section", "iea_section")


def _build_bns_family_indexes() -> None:
    global _bns_family_existence_index, _ipc_origin_hypothesis_index
    _bns_family_existence_index = set()
    _ipc_origin_hypothesis_index = {}
    if not _XREF_JSON_PATH.exists():
        return
    try:
        with open(_XREF_JSON_PATH, encoding="utf-8") as f:
            data = _json.load(f)
    except Exception:
        return
    for _table_name, entries in data.items():
        if not isinstance(entries, list):
            continue
        for e in entries:
            if not isinstance(e, dict):
                continue
            for k in _NEW_SECTION_KEYS:
                v = e.get(k)
                if v:
                    _bns_family_existence_index.add(str(v).strip().upper())
            for k in _OLD_SECTION_KEYS:
                old_num = e.get(k)
                if not old_num:
                    continue
                new_num = e.get("bns_section") or e.get("bnss_section") or e.get("bsa_section")
                if new_num:
                    _ipc_origin_hypothesis_index.setdefault(str(old_num).strip().upper(), {
                        "bns_section": str(new_num).strip(),
                        "what_changed": e.get("what_changed", ""),
                        "source_link": e.get("source_link", ""),
                    })


def check_bns_family_identifier(section_number: str) -> dict:
    """
    For a well-formed "BNS/BNSS/BSA <section_number>" reference whose exact
    legal_sections record is missing, report whether the verified
    correspondence index confirms the number as a real current section, and
    if not, whether it matches a former IPC/CrPC/Evidence-Act number that
    could explain the confusion.

    Returns {"confirmed_existing": bool, "ipc_origin_hypothesis": dict|None}.
    Callers MUST treat confirmed_existing=False as "no evidence either way",
    never as "this section does not exist" — the index only covers sections
    that happen to appear in this correspondence table.
    """
    if _bns_family_existence_index is None:
        _build_bns_family_indexes()
    sec = (section_number or "").strip().upper()
    return {
        "confirmed_existing": sec in (_bns_family_existence_index or set()),
        "ipc_origin_hypothesis": (_ipc_origin_hypothesis_index or {}).get(sec),
    }


async def lookup_section(
    db: AsyncIOMotorDatabase,
    section_number: str,
    act_hint: str | None = None,
) -> dict | None:
    """Exact section lookup by section_number + optional act name hint.

    **JI check is decoupled from section-lookup success.**  Sections most
    likely to need a judicial-invalidation warning are sometimes exactly the
    ones absent from legal_sections — because they were repealed or superseded
    (e.g. IPC §377 replaced by BNS).  Both lookups run in parallel; the JI
    warning surfaces regardless of whether statutory text was found.

    Return values:
    - None → section not in corpus AND no JI record
    - full result dict → section found (± JI flag)
    - no-text result (no_current_text=True) → JI record found, section absent
    """
    query: dict = {"section_number": section_number}
    if act_hint:
        query["act_name"] = _act_name_prefix_regex(act_hint)

    # Run both lookups in parallel — JI must not wait for section success.
    doc, ji_rec = await asyncio.gather(
        db.legal_sections.find_one(query),
        db.judicial_invalidations.find_one(query),
    )

    # Build JI flag from the independent JI lookup (regardless of doc)
    jflag: str | None = None
    ji_act_name: str = ""
    if ji_rec and (ji_rec.get("status") or "").upper() != "UPHELD":
        jflag = (
            ji_rec.get("user_warning")
            or "⚠️ This provision has been subject to judicial proceedings. "
               "Please verify current status with an advocate."
        )
        ji_act_name = ji_rec.get("act_name", "")

    if not doc:
        if not jflag:
            return None
        # JI warning exists but no statutory text — return an honest no-text
        # result.  server.py detects no_current_text=True and adds an honest
        # "text not available; may be repealed" note to corpus_context and SSE.
        return {
            "act_name": ji_act_name,
            "section_number": section_number,
            "section_heading": "",
            "section_text": None,
            "jurisdiction": "CENTRAL",
            "source_url": "",
            "verify_tier": 2,
            "badge": "Sourced from Government of India",
            "is_dead_law": False,
            "dead_warning": None,
            "judicial_flag": jflag,
            "_score": 0.0,
            "ministry": "",
            "act_year": None,
            "act_id": "",
            "dead_law_reason": None,
            "no_current_text": True,
            "is_anchored": True,
        }

    return _shape(doc, 0.0, jflag, is_anchored=True)


async def retrieve_db(
    db: AsyncIOMotorDatabase,
    question: str,
    state_code: str | None = None,
    limit: int = 5,
) -> list[dict]:
    """Situational full-text search against the legal_sections corpus.

    Two-phase retrieval (fixes the heading-weight ranking bias):
    ─────────────────────────────────────────────────────────────
    PHASE A — Wide fetch
      Fetch up to _CANDIDATE_POOL_SIZE (300) docs per jurisdiction from the
      $text index.  MongoDB's textScore unfairly favours section_heading
      (weight=10) over section_text (weight=1), so limiting to `limit*4=20`
      candidates meant that sections where the topic lives in body text (e.g.
      MV Act §129 "helmet") were never seen by the corroboration filter.

    PHASE B — Corroboration re-rank, then slice
      Score every candidate with _corroboration_score() (significant-word
      overlap count; 9999 for an explicit act-label match).  Filter out scores
      below _MIN_COROBORATION_WORDS (= 2), sort descending, and take the top
      `limit`.  State-jurisdiction candidates beat central ones at equal scores.

    Priority ordering (unchanged):
      1. Exact section lookup (if question cites a section number + act hint).
      2. Re-ranked results from state jurisdiction (if set).
      3. Re-ranked results from CENTRAL jurisdiction.

    Dead sections are EXCLUDED from situational search results (G1).
    JI flags are fetched in parallel only for the final top-`limit` results.

    Returns up to `limit` result dicts (may be fewer if corpus is sparse).
    """
    results: list[dict] = []
    seen_ids: set[str] = set()

    # ── 0. Derive jurisdiction string from state code ─────────────────────────
    state_jurisdiction: str | None = None
    if state_code:
        state_jurisdiction = STATE_CODE_TO_JURISDICTION.get(state_code.upper())

    # ── Act hint + significant-word set — computed ONCE ───────────────────────
    act_hint: str | None = None
    for hint_name, pattern in _ACT_HINTS.items():
        if pattern.search(question):
            act_hint = hint_name
            break

    # ── P0-D: classify explicit-statute intent BEFORE synonym expansion —
    # VALID / INVALID_OR_UNSUPPORTED / NO_EXPLICIT_REFERENCE. Reuses P0-B's
    # extract_exact_statute_ref(); adds detection of a FAILED citation
    # ATTEMPT (overlong number, overlong suffix, a bare enactment year) so
    # it is never silently treated as an ordinary open-ended question and
    # promoted to an unrelated same-Act citation via the fuzzy path below.
    _ref_state = _classify_statute_reference_intent(question)

    question = _expand_query(question)          # synonym expansion before retrieval
    question_sig = _significant_words(question)

    if _ref_state == _STATUTE_REF_INVALID:
        # P0-D highest-priority fix: a malformed/unsupported explicit
        # citation attempt (e.g. "IPC 9999", "IPC 166ABCD", "1860 IPC").
        # Fail safely — NEVER fall through to fuzzy retrieval here, where
        # the act-label sentinel could promote an unrelated same-Act
        # section as if it answered this malformed reference.
        return []

    if _ref_state == _STATUTE_REF_VALID:
        exact_act, exact_sec, exact_sub = _extract_exact_statute_ref(question)
        # P0-B rule: an EXPLICIT Act+section identifier was named. Return ONLY
        # a deterministic exact match for that identifier — NEVER fall back to
        # the fuzzy/corroboration path below, whose act-label sentinel
        # (corroboration_score() == 9999 for ANY same-Act document) is exactly
        # the mechanism that could otherwise promote an unrelated same-Act
        # citation as if it answered this specific section. A failed exact
        # lookup returns [] — an explicit "no exact match" — not a guess.
        exact = await lookup_section(db, exact_sec, exact_act)
        if exact:
            exact["requested_subsection"] = exact_sub
            exact["exact_identifier_requested"] = True
            return [exact]
        return []

    # ── 1. (legacy, unchanged) Attempt exact section lookup for a bare
    # "Section N" mention with no Act name — only reached when NO explicit
    # Act+section identifier (valid or invalid-attempt) was detected above.
    sec_match = _SEC_RE.search(question)
    if sec_match:
        sec_num = sec_match.group(1).upper()
        exact = await lookup_section(db, sec_num, act_hint)
        if exact:
            seen_ids.add(exact.get("act_id", "") + "|" + exact["section_number"])
            results.append(exact)

    # ── Shared projection for both text-search queries ────────────────────────
    _PROJ = {
        "score": {"$meta": "textScore"},
        "act_name": 1, "section_number": 1, "section_heading": 1,
        "section_text": 1, "source_url": 1, "verify_tier": 1,
        "verified_by": 1, "is_dead_law": 1, "dead_law_reason": 1,
        "serve_warning": 1, "jurisdiction": 1, "ministry": 1,
        "act_year": 1, "act_id": 1,
    }

    # ── PHASE A: wide candidate collection ───────────────────────────────────
    # Each entry: (corr_score, jurisdiction_priority, text_score, key, doc)
    # jurisdiction_priority: 1 = state, 0 = central  →  state wins ties.
    candidates: list[tuple[int, int, float, str, dict]] = []

    # 2a. State jurisdiction candidates
    if state_jurisdiction:
        try:
            cursor = db.legal_sections.find(
                {
                    "$text": {"$search": question},
                    "jurisdiction": state_jurisdiction,
                    "is_dead_law": False,
                },
                _PROJ,
            ).sort([("score", {"$meta": "textScore"})]).limit(_CANDIDATE_POOL_SIZE)

            async for doc in cursor:
                key = doc.get("act_id", "") + "|" + doc.get("section_number", "")
                if key in seen_ids:
                    continue
                corr = _corroboration_score(question_sig, doc, act_hint)
                if corr >= _MIN_COROBORATION_WORDS:
                    candidates.append((corr, 1, float(doc.get("score", 0.0)), key, doc))
        except Exception:
            pass  # Corpus may not have this jurisdiction yet — fall through

    # 2b. CENTRAL jurisdiction candidates
    try:
        cursor = db.legal_sections.find(
            {
                "$text": {"$search": question},
                "jurisdiction": "CENTRAL",
                "is_dead_law": False,
            },
            _PROJ,
        ).sort([("score", {"$meta": "textScore"})]).limit(_CANDIDATE_POOL_SIZE)

        async for doc in cursor:
            key = doc.get("act_id", "") + "|" + doc.get("section_number", "")
            if key in seen_ids:
                continue
            corr = _corroboration_score(question_sig, doc, act_hint)
            if corr >= _MIN_COROBORATION_WORDS:
                candidates.append((corr, 0, float(doc.get("score", 0.0)), key, doc))
    except Exception:
        pass

    # ── PHASE B: re-rank by corroboration score, dedupe, slice ───────────────
    # Sort: corr_score DESC → jurisdiction_priority DESC → text_score DESC
    candidates.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)

    # Dedupe by key first (state + central candidate pools can in theory
    # overlap at the boundary), preserving sort order — the relative cutoff
    # below assumes a clean, already-ranked list.
    deduped: list[tuple[int, float, dict]] = []
    for corr, _jprio, text_score, key, doc in candidates:
        if key in seen_ids:
            continue
        seen_ids.add(key)
        deduped.append((corr, text_score, doc))

    # Relative-noise cutoff — shared with corpus.py's retrieve() via
    # retrieval_logic.relative_top_cutoff so the two engines cannot drift
    # apart again. corr == 9999 is an explicit Act-label match (see
    # corroboration_score) and always passes through; every other candidate
    # must score at least half of the best NON-label-match candidate to be
    # shown, so an anchored citation (e.g. BNS s.82 for a bigamy question)
    # cannot silently drag along an unrelated hit that only just cleared the
    # absolute MIN_COROBORATION_WORDS floor.
    top_candidates: list[tuple[int, float, dict]] = _relative_top_cutoff(
        [(corr, (corr, text_score, doc)) for corr, text_score, doc in deduped],
        limit=limit - len(results),
        min_floor=_MIN_COROBORATION_WORDS,
        sentinel=9999,
    )

    # Fetch JI flags in parallel for the final slice only (not all 300)
    if top_candidates:
        jflags = await asyncio.gather(
            *[
                _judicial_flag(db, doc.get("act_name", ""), doc.get("section_number", ""))
                for _, _, doc in top_candidates
            ]
        )
        for (corr, text_score, doc), jflag in zip(top_candidates, jflags):
            results.append(_shape(doc, text_score, jflag, is_anchored=(corr == 9999)))

    return results


async def check_orphan_invalidation(
    db: AsyncIOMotorDatabase,
    section_number: str,
    act_hint: str | None = None,
) -> dict | None:
    """Look up judicial_invalidations directly, even when the section has NO
    matching entry in legal_sections.

    Handles cases like IPC §377 (IPC replaced by BNS and absent from
    legal_sections) where a Supreme Court ruling IS tracked in
    judicial_invalidations but the full statutory text is not in the corpus.

    Returns None if no record exists or if status == "UPHELD".
    Returns a plain dict otherwise.
    """
    query: dict = {"section_number": section_number}
    if act_hint:
        query["act_name"] = _act_name_prefix_regex(act_hint)

    rec = await db.judicial_invalidations.find_one(query)
    if not rec:
        return None
    if (rec.get("status") or "").upper() == "UPHELD":
        return None
    return {
        "act_name": rec.get("act_name", ""),
        "section_number": section_number,
        "status": rec.get("status", ""),
        "user_warning": (
            rec.get("user_warning")
            or "⚠️ This provision has been subject to judicial proceedings. "
               "Please verify current status with an advocate."
        ),
    }


async def check_query_for_orphan_warnings(
    db: AsyncIOMotorDatabase,
    question: str,
) -> dict | None:
    """Extract section number + act hint from `question`, then check
    judicial_invalidations for an orphan ruling (section cited but not in
    legal_sections).  Returns None when nothing found.

    Designed as the last-resort check AFTER retrieve_db returns empty — it
    prevents a silent "no results" for queries like "IPC section 377" where
    the act no longer appears in the corpus but a Supreme Court ruling is
    tracked.
    """
    # P0-D: try the P0-B/P0-C exact-statute extractor FIRST — preserves Act
    # identity and catches bare phrasings like "IPC 377", which the legacy
    # _SEC_RE-only check below missed entirely (it required the literal
    # word "Section"). Falls back to the legacy bare-"Section N" check,
    # unchanged, for queries with no Act name of their own.
    exact_act, exact_sec, _exact_sub = _extract_exact_statute_ref(question)
    if exact_act and exact_sec:
        return await check_orphan_invalidation(db, exact_sec, exact_act)

    sec_match = _SEC_RE.search(question)
    if not sec_match:
        return None

    sec_num = sec_match.group(1).upper()
    act_hint: str | None = None
    for hint_name, pattern in _ACT_HINTS.items():
        if pattern.search(question):
            act_hint = hint_name
            break

    return await check_orphan_invalidation(db, sec_num, act_hint)


async def lookup_act_sections(
    db: AsyncIOMotorDatabase,
    act_id: str,
    limit: int = 50,
) -> list[dict]:
    """Browse all sections of an Act in statutory order (Task 4 pattern 3)."""
    cursor = db.legal_sections.find(
        {"act_id": act_id},
    ).sort([("section_num_int", 1), ("section_num_suffix", 1)]).limit(limit)

    results = []
    async for doc in cursor:
        jflag = await _judicial_flag(
            db, doc.get("act_name", ""), doc.get("section_number", "")
        )
        results.append(_shape(doc, 0.0, jflag))
    return results
