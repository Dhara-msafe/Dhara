"""
retrieval_logic.py — Shared retrieval scoring + corroboration primitives.

Single source of truth for DHARA's retrieval math, extracted so it is defined
ONCE and imported by both retrieval backends:

  • corpus.py    — in-memory hand-verified keyword corpus (token/IDF scorer).
  • corpus_db.py — MongoDB $text full-text corpus (significant-word corroboration).

The "≥ 2 significant-word corroboration" rule (MIN_COROBORATION_WORDS) is the
core anti-noise gate both paths rely on: a fuzzy text/keyword hit must prove
real topical overlap (an explicit Act-label match, OR at least two significant
words in common) before it is trusted.

Two corpora → two stopword vocabularies, both defined here:
  • BASE_STOPWORDS — function words + meta-legislation words, for the keyword
                     corpus token scorer.
  • SIG_STOPWORDS  — the wider set that ALSO strips legal-boilerplate machinery
                     ("fine", "penalty", "shall"...), for the MongoDB corpus.

SAFETY-GUARD NOTE
-----------------
This module contains NO safety-guard logic. The is_dead_law guard (G1) and the
judicial_invalidations join (G2) live — unchanged — in corpus_db.py. Nothing
here removes, bypasses, or alters their trigger conditions.
"""

from __future__ import annotations

import re

# ── Synonym / lay-term expansion ──────────────────────────────────────────────
# Maps plain-language terms users actually type to the statutory vocabulary used
# in the corpus. Each tuple is (compiled_regex, expansion_suffix). The suffix is
# APPENDED to the query (not a replacement) so the original words still score too.
_SYNONYMS: list[tuple[re.Pattern, str]] = [
    # NRI / FEMA / property
    (re.compile(r"\bNRI\b", re.I),                                       "person resident outside India FEMA foreign exchange"),
    (re.compile(r"\bnon.?resident\s+indian\b", re.I),                    "person resident outside India FEMA foreign exchange"),
    (re.compile(r"\b(?:buy|purchase|acquire)\s+(?:\w+\s+)?(?:land|plot|flat|property|house|farm)\b", re.I), "purchase immovable property transfer acquire"),
    (re.compile(r"\b(?:sell|transfer)\s+(?:\w+\s+)?(?:land|plot|flat|property|house|farm)\b", re.I),        "transfer immovable property sale"),
    (re.compile(r"\bown\s+(?:land|property|flat|house)\b", re.I),        "hold immovable property ownership"),
    (re.compile(r"\bsend\s+money\s+(?:to\s+)?india\b", re.I),            "inward remittance FEMA foreign exchange"),
    (re.compile(r"\bsend\s+money\s+abroad\b", re.I),                     "outward remittance FEMA foreign exchange"),
    (re.compile(r"\bforeign\s+(?:money|funds|investment|currency)\b", re.I), "foreign exchange FEMA"),
    # Consumer
    (re.compile(r"\b(?:cheated|fraud|scam)\s+(?:by\s+)?(?:a\s+)?(?:shop|seller|brand|company)\b", re.I), "consumer protection defective goods complaint"),
    (re.compile(r"\bdefective\s+product\b", re.I),                       "consumer protection defective goods"),
    (re.compile(r"\brefund\s+(?:denied|refused|not\s+given)\b", re.I),   "consumer protection complaint redressal"),
    # Cheque / negotiable instruments
    (re.compile(r"\bcheque\s+(?:bounce|bounced|dishonour|dishonored)\b", re.I), "dishonour cheque negotiable instruments"),
    # Traffic / motor vehicles
    (re.compile(r"\btraffic\s+(?:fine|challan|ticket)\b", re.I),         "motor vehicles challan compounding"),
    (re.compile(r"\bover\s*speed(?:ing)?\b", re.I),                      "motor vehicles speeding challan"),
    # Workplace harassment
    (re.compile(r"\bsexual\s+harassment\s+(?:at\s+)?(?:work|office|workplace)\b", re.I), "POSH sexual harassment workplace"),
    # Domestic violence
    (re.compile(r"\b(?:wife|husband|partner|spouse)\s+(?:beating|beat|hit|hitting|abuse|abused|violence)\b", re.I), "domestic violence protection women"),
    (re.compile(r"\bspousal\s+abuse\b", re.I),                           "domestic violence protection women"),
    # Employment / termination
    (re.compile(r"\b(?:fired|sacked|dismissed|terminated)\s+from\s+(?:job|work)\b", re.I), "termination employment industrial disputes"),
    (re.compile(r"\bunfair\s+dismissal\b", re.I),                        "termination employment industrial disputes"),
    # Bail / arrest
    (re.compile(r"\b(?:get\s+out\s+of\s+jail|jail\s+release|get\s+bail)\b", re.I), "bail arrest BNSS"),
    # RTI
    (re.compile(r"\b(?:ask|get\s+information\s+from)\s+(?:the\s+)?(?:government|govt)\b", re.I), "right to information RTI"),
    # Dowry
    (re.compile(r"\bdowry\s+(?:harassment|demand|torture)\b", re.I),     "dowry prohibition BNS cruelty"),
    # Physical assault / hurt — everyday phrasing ("I was physically assaulted",
    # "he hit/beat/slapped/punched/kicked me") uses verb tenses that never
    # literally appear in the BNS Hurt/Assault chapter headings (§115 "Voluntarily
    # causing hurt", §130 "Assault"), so plain significant-word overlap alone
    # was scoring 0 and these queries fell through to a flat refusal even though
    # the exact right sections exist in the corpus. Appending the statutory
    # vocabulary here (not replacing the user's words) restores the overlap.
    (re.compile(r"\bassault(?:ed|ing|s)?\b", re.I),                      "assault criminal force voluntarily causing hurt"),
    (re.compile(r"\b(?:beat|beaten|hit|punched|slapped|kicked|attacked)\s+(?:me|him|her|us|them)\b", re.I),
                                                                          "assault hurt voluntarily causing hurt criminal force"),
    (re.compile(r"\bphysically\s+(?:abused|hurt|injured|attacked)\b", re.I), "assault hurt voluntarily causing hurt"),
    # FIR refusal — colloquial variants ("won't write", "not taking", "not registering",
    # "refuse to register") that contain no keyword shared with bnss_173 beyond "fir".
    # Appending the statutory vocabulary restores the overlap to ≥ 4 score.
    (re.compile(
        r"\b(?:police|officer|station|thana|thane)\b.*\b(?:won.?t|not|refus(?:e[sd]?|ing)|den(?:y|ied)|not\s+willing|not\s+taking|not\s+writing|not\s+registering)\b.*\b(?:fir|complaint|case)\b",
        re.I,
    ), "refuse fir register fir police refused fir lodge fir"),
    (re.compile(
        r"\b(?:won.?t|not|refus(?:e[sd]?|ing)|den(?:y|ied))\b.*\b(?:write|register|lodge|take|file|record)\b.*\bfir\b",
        re.I,
    ), "refuse fir register fir police refused fir lodge fir"),
]


def expand_query(query: str) -> str:
    """Append statutory synonyms for any lay-term patterns found in `query`.

    Never replaces the original words — only adds; so the original tokens
    still score independently and the expansion only helps retrieval, never
    hurts it. Safe to call more than once (idempotent via exact-suffix check).
    """
    extra: list[str] = []
    for pattern, expansion in _SYNONYMS:
        if pattern.search(query) and expansion not in query:
            extra.append(expansion)
    if not extra:
        return query
    return query + " " + " ".join(extra)


# ── Shared corroboration threshold ────────────────────────────────────────────
# A fuzzy hit needs at least this many significant words in common with the
# query (unless the query names the Act by label) to count as corroborated.
MIN_COROBORATION_WORDS = 2

# Keyword-corpus confidence floor (corpus.py). A single moderately-common token
# (weight 3) matching is not enough evidence on its own.
RETRIEVAL_MIN_SCORE = 4


# ── Tokenization (keyword corpus) ─────────────────────────────────────────────
def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).strip()


def _tokens(s: str) -> set:
    """Split a normalized string into a set of tokens (words)."""
    return {t for t in _norm(s).split() if len(t) > 1}


# ── Stopwords: keyword-corpus vocabulary (corpus.py) ──────────────────────────
# Words too common to give retrieval signal (would over-match). Includes
# meta-legislation words ("act", "section", "code"...) which appear in nearly
# every real query yet, being rare in the hand-written keyword lists, would
# otherwise score as high-weight tokens (poor-man's-IDF inverting itself).
BASE_STOPWORDS: set = {
    "the", "a", "an", "is", "are", "was", "were", "of", "and", "or", "for",
    "in", "on", "at", "to", "by", "my", "me", "i", "we", "you", "your",
    "can", "may", "do", "does", "did", "have", "has", "had", "be", "been",
    "will", "would", "should", "could", "shall", "any", "all", "some",
    "what", "why", "how", "when", "where", "who", "which", "this", "that",
    "without", "with", "not", "no", "from", "than", "then", "into", "about",
    "if", "as", "but", "so", "there", "their", "them", "his", "her", "its",
    "am", "get", "got", "make", "made", "tell", "know", "want", "need",
    "please", "sir", "madam", "hai", "kya", "mera", "meri",
    "act", "acts", "section", "sections", "rule", "rules", "code", "codes",
    "law", "laws", "sanhita", "adhiniyam", "under",
}

# ── Stopwords: MongoDB significant-word vocabulary (corpus_db.py) ──────────────
# Adds legal-boilerplate machinery words on top of the function words. These
# appear in the vast majority of Bare Act sections regardless of subject matter
# ("fine", "penalty", "shall", "rupees", "manner as prescribed"...) so two
# documents sharing ONLY these words are not actually on the same topic.
SIG_STOPWORDS: set = {
    "the", "a", "an", "is", "are", "was", "were", "of", "and", "or", "for",
    "in", "on", "at", "to", "by", "my", "me", "i", "we", "you", "your",
    "can", "may", "do", "does", "did", "have", "has", "had", "be", "been",
    "will", "would", "should", "could", "shall", "any", "all", "some",
    "what", "why", "how", "when", "where", "who", "which", "this", "that",
    "without", "with", "not", "no", "from", "than", "then", "into", "about",
    "if", "as", "but", "so", "there", "their", "them", "they", "his", "her", "its",
    "am", "get", "got", "make", "made", "tell", "know", "want", "need",
    "please", "sir", "madam", "against", "per", "under",
    "act", "acts", "section", "sections", "rule", "rules", "code", "codes",
    "law", "laws", "sanhita", "adhiniyam",
    # Legal-boilerplate machinery words — appear across the vast majority of
    # Bare Act sections regardless of subject matter.
    "fine", "fines", "penalty", "penalties", "punishment", "punishable",
    "imprisonment", "extend", "extending", "extended", "liable", "liability",
    "rupees", "amount", "payment", "pay", "paid", "notice", "prescribed",
    "provided", "government", "authority", "officer", "officers", "court",
    "courts", "person", "persons", "such", "said", "aforesaid", "thereof",
    "herein", "thereto", "shall", "whoever", "confiscation", "lieu",
    "option", "compensation", "offence", "offences", "contravention",
    "contravenes", "regard", "respect", "matter", "matters", "case", "cases",
    "name", "names", "address", "addresses", "give", "giving", "given",
    "arrested", "arrest",
    # Generic words that surface disproportionately in LLM-normalised query
    # paraphrases ("A user claims they were defrauded...") and, separately,
    # appear across huge unrelated swaths of the corpus without real topical
    # signal — "claim"/"claims" in virtually any tribunal/compensation Act,
    # "user" as the property-law term for "usage" in easement/water-rights
    # clauses. Left unguarded, two documents sharing only these words were
    # scoring as corroborated on pure coincidence (e.g. an online-fraud
    # question matching the Northern India Canal and Drainage Act, whose
    # only real overlap was "user" + "claims").
    "user", "users", "claim", "claims", "claimed", "claiming",
    # Generic time/manner connectors — near-zero topical signal on their own.
    "time", "times", "period", "periods", "date", "dates", "days", "month",
    "months", "year", "years", "limit", "limits", "manner", "necessary",
    "reasonable", "required", "specified", "concerned", "applicable",
    "otherwise", "accordance", "force", "forthwith", "immediately",
    # Structural/administrative headings repeated verbatim across thousands of
    # unrelated Acts ("Procedure on application", "Application of Act").
    "procedure", "procedures", "application", "applications", "provisions",
    "provision", "general", "particular", "purposes", "purpose",
}


# ── Keyword-corpus scoring (used by corpus.py) ────────────────────────────────
def build_token_df(items: list) -> dict:
    """Token document-frequency table (poor-man's IDF input). Counts, per token,
    how many corpus entries mention it across their keywords + short_label."""
    df: dict = {}
    for item in items:
        toks: set = set()
        for kw in item["keywords"]:
            toks |= _tokens(kw)
        toks |= _tokens(item["short_label"])
        for t in toks:
            df[t] = df.get(t, 0) + 1
    return df


def make_token_weight(token_df: dict):
    """Return a token-weight function bound to `token_df`. Rare tokens carry up
    to 4x the weight of tokens that appear across many entries."""
    def _token_weight(tok: str) -> int:
        n = token_df.get(tok, 1)
        if n <= 1:
            return 4      # unique to one section — very strong signal
        if n <= 3:
            return 3
        if n <= 6:
            return 2
        return 1          # appears everywhere — weak signal
    return _token_weight


def score_items(
    question: str,
    items: list,
    token_weight,
    stop: set = BASE_STOPWORDS,
) -> list[tuple[int, dict]]:
    """Score every item against the question. Returns ALL entries scoring > 0,
    sorted descending — WITHOUT any minimum-score cutoff.

    Score per entry:
      +12 if the entry's short_label appears in the question
      +6  per multi-word keyword appearing as a contiguous substring
      +   weighted token overlap (rare tokens 4 ... common tokens 1);
          bare numerals are skipped (a section number floating free of its Act
          context is weak evidence).
    """
    q_norm = _norm(expand_query(question))
    if not q_norm:
        return []
    q_tokens = _tokens(expand_query(question)) - stop

    scored: list[tuple[int, dict]] = []
    for item in items:
        req = item.get("require_any")
        if req and not any(_norm(r) in q_norm for r in req):
            continue
        score = 0
        if _norm(item["short_label"]) in q_norm:
            score += 12
        kw_tokens: set = set()
        for kw in item["keywords"]:
            kw_norm = _norm(kw)
            if " " in kw_norm and kw_norm in q_norm:
                score += 6
            kw_tokens |= _tokens(kw)
        kw_tokens -= stop
        for t in kw_tokens & q_tokens:
            if t.isdigit():
                continue
            score += token_weight(t)
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored


def corroborated(question: str, item: dict, stop: set = BASE_STOPWORDS) -> bool:
    """≥ 2 significant-word corroboration for the keyword corpus.

    PASS if EITHER
      (a) the entry's short_label appears in the question (a strong label
          match — e.g. "bnss 35", "article 21"), OR
      (b) the question shares >= MIN_COROBORATION_WORDS significant words with
          the entry's keyword tokens.
    """
    ql = question.lower()
    label = item.get("short_label", "").lower()
    if label in ql:
        return True
    kw_tokens = set().union(
        *[_tokens(kw) for kw in item.get("keywords", [])]
    ) - stop
    return len(set(_tokens(question)) & kw_tokens) >= MIN_COROBORATION_WORDS


# ── MongoDB significant-word corroboration (used by corpus_db.py) ─────────────
def significant_words(text: str, stopwords: set = SIG_STOPWORDS) -> set:
    """Lowercased alphabetic tokens (len>=3) minus stopwords — the real topical
    signal in a string, stripped of function words and generic legal-domain
    filler that would otherwise over-match everything."""
    words = re.findall(r"[a-zA-Z]{3,}", (text or "").lower())
    return {w for w in words if w not in stopwords}


def _act_name_leads_with(doc_act_name: str, act_hint: str) -> bool:
    """True when `doc_act_name`, once its leading article is stripped, STARTS
    WITH `act_hint`.

    Was previously a bare substring check (`act_hint in doc_act_name`), which
    let "Information Technology" match "The INDIAN INSTITUTES OF Information
    Technology Act, 2014" — a completely unrelated Act about educational
    institutes that merely happens to contain those two words. That bug gave
    such docs a guaranteed corroboration_score of 9999 ("always surfaces,
    sorted first"), so a query about the real IT Act's §66A came back with
    two Indian Institutes of Information Technology Act sections outranking
    it. Real Act names always lead with their own proper name (at most after
    "The"/"An"/"A"), so anchoring to the start is a safe, general fix.
    """
    norm = (doc_act_name or "").lower().strip()
    for article in ("the ", "an ", "a "):
        if norm.startswith(article):
            norm = norm[len(article):]
            break
    return norm.startswith(act_hint.lower())


def corroboration_score(question_sig: set, doc: dict, act_hint: str | None) -> int:
    """Numeric corroboration score used to RE-RANK $text candidates.

    Returns 9999  → act-label match (doc's act_name LEADS WITH act_hint, i.e.
                     it IS that Act, not merely an Act whose longer name
                     happens to contain those words — see
                     `_act_name_leads_with`). Always surfaces; sorted first
                     regardless of text-index score.
    Returns N ≥ 0 → see weighting below.

    Threshold for inclusion (applied by callers): score >= MIN_COROBORATION_WORDS.

    IMPORTANT: the inclusion floor is always checked against the RAW
    (unweighted) significant-word overlap — exactly the original behaviour —
    so a single generic heading-word match (e.g. a query about "online
    sellers" sharing only the word "online" with an unrelated Online Gaming
    Act heading) still cannot clear the floor alone. The heading bonus below
    is added ONLY on top of an already-qualifying raw score, and therefore
    only ever affects ranking ORDER among candidates that already passed the
    same floor as before — it can never pull in a new, weaker match.

    Heading bonus (ranking only, not eligibility)
    -----------------------------------------------
    A plain (unweighted) overlap count let procedural "power to arrest
    without warrant" clauses (Railway Protection Force Act, CISF Act, etc.)
    outrank the actual offence-defining BNS section for everyday queries
    like "I was physically assaulted" — those clauses exist specifically to
    enumerate MANY trigger offences in one sentence ("voluntarily causes
    hurt... assaults... uses criminal force...") so they share several
    significant words with almost any personal-safety query, even though
    their own heading ("Power to arrest without warrant") has nothing to do
    with the topic. A section's HEADING is its clearest, most reliable topic
    signal — mirrors MongoDB's own $text index, which already weights
    section_heading ×10 vs section_text ×1 (see module docstring) — so once
    a candidate has already qualified on raw overlap, each of its heading
    words additionally counts double towards the final (ranking) score.
    """
    doc_act_name = doc.get("act_name") or ""
    if act_hint and _act_name_leads_with(doc_act_name, act_hint):
        return 9999  # Explicit act-label match → always surface
    heading_sig = significant_words(doc_act_name + " " + (doc.get("section_heading") or ""))
    doc_sig = heading_sig | significant_words((doc.get("section_text") or "")[:800])
    raw = len(question_sig & doc_sig)
    if raw < MIN_COROBORATION_WORDS:
        return raw   # unchanged from original behaviour — correctly excluded by callers
    heading_overlap = len(question_sig & heading_sig)
    return raw + heading_overlap * 2


def corroborates(question_sig: set, doc: dict, act_hint: str | None) -> bool:
    """Corroboration Rule gate — boolean version (kept for external callers)."""
    return corroboration_score(question_sig, doc, act_hint) >= MIN_COROBORATION_WORDS


# ── Relative-noise cutoff — shared final-slice rule for BOTH engines ────────
# Defined ONCE here (not duplicated in corpus.py / corpus_db.py) precisely so
# the two retrieval engines cannot drift apart again the way they did before
# this module existed. A clear winner (or an explicit Act-label match, see
# `sentinel`) must not drag a weakly-related hit along just because that hit
# cleared the ABSOLUTE floor (RETRIEVAL_MIN_SCORE / MIN_COROBORATION_WORDS).
# Real examples this caught in production: a cheque-bounce question also
# returning an RTI reply-deadline chip (both mention "notice" + "30 days");
# a bigamy question ("can an Indian marry twice") returning an unrelated
# "National Commission for Indian System of Medicine Act" hit that only
# shared the word "Indian".
def extract_exact_statute_ref(text: str) -> tuple[str | None, str | None, str | None]:
    """P0-B — Deterministic exact-statute-reference extractor.

    Recognises an EXPLICIT Act + section (+ optional letter suffix + optional
    numeric subsection) citation regardless of phrasing order, WITHOUT
    requiring the literal word "Section"/"Sec" — the gap that made the old
    corpus_db._SEC_RE miss bare forms like "IPC 166A", "166A IPC", "BNS-199".

    Supports (case-insensitive):
      IPC 166A | IPC-166A | 166A IPC | Section 166A of IPC |
      Indian Penal Code Section 166A | BNS 199 | BNS-199 |
      Section 193(2) BNS | IPC 166 | IPC 166B

    Returns (act_name_canonical, section_with_suffix, subsection_or_None).
    Returns (None, None, None) if no explicit Act name is present anywhere
    near a number — a BARE number alone is deliberately never treated as a
    statute citation (weak evidence, not a legal identifier). Letter suffixes
    are never stripped ("166A" always stays "166A", never becomes "166") and
    the Act name is never guessed/substituted for a different Act.
    """
    if not text:
        return None, None, None
    m = _EXACT_STATUTE_FWD.search(text) or _EXACT_STATUTE_REV.search(text)
    if not m:
        return None, None, None
    act_name = ACT_ALIASES.get(m.group("act").lower())
    if not act_name:
        return None, None, None
    section = m.group("num").upper()
    return act_name, section, m.group("sub")


# ── Act aliases recognised by extract_exact_statute_ref() ────────────────────
# Canonical values match the `act_name` hint strings already used for exact
# MongoDB lookups elsewhere (corpus_db._ACT_HINTS) — no new naming scheme.
ACT_ALIASES: dict[str, str] = {
    "ipc": "Indian Penal Code",
    "indian penal code": "Indian Penal Code",
    "bns": "Bharatiya Nyaya Sanhita",
    "bharatiya nyaya sanhita": "Bharatiya Nyaya Sanhita",
    "bnss": "Bharatiya Nagarik Suraksha Sanhita",
    "bharatiya nagarik suraksha sanhita": "Bharatiya Nagarik Suraksha Sanhita",
    "bsa": "Bharatiya Sakshya Adhiniyam",
    "bharatiya sakshya adhiniyam": "Bharatiya Sakshya Adhiniyam",
    "crpc": "Code of Criminal Procedure",
    "code of criminal procedure": "Code of Criminal Procedure",
}
_ACT_ALT = "|".join(sorted((re.escape(a) for a in ACT_ALIASES), key=len, reverse=True))

# Act name FIRST: "IPC 166A", "IPC-166A", "BNS 193(2)", "Indian Penal Code Section 166A"
# P0-C.1 hardening: (?<!\d) before and (?![\dA-Za-z]) after the number+suffix
# group enforce COMPLETE identifier boundaries. Without these, a regex engine
# backtrack/retry could accept a mere PREFIX of a longer digit run ("IPC 9999"
# silently becoming "999") or a longer letter-suffix run ("166ABCD" becoming
# "166AB") as if it were the whole, correct identifier — a truncation bug,
# not a real section number. With the boundary checks, any input that is not
# EXACTLY a 1-3 digit section optionally followed by 0-2 letters, bounded on
# both sides by a non-alphanumeric character, fails to match at all (returns
# None, None, None) rather than silently resolving to a different, shorter
# identifier. This also prevents a bare enactment year ("1860 IPC") from
# being misread as "860 IPC" by starting the digit match mid-run.
_EXACT_STATUTE_FWD = re.compile(
    rf"\b(?P<act>{_ACT_ALT})\b[\s\-]*(?:section|sections|sec\.?|§)?\s*"
    rf"(?<!\d)(?P<num>\d{{1,3}}[A-Za-z]{{0,2}})(?![\dA-Za-z])(?:\s*\((?P<sub>\d+)\))?",
    re.IGNORECASE,
)
# Number FIRST: "166A IPC", "Section 166A of IPC", "Section 193(2) BNS"
_EXACT_STATUTE_REV = re.compile(
    rf"\b(?:section|sections|sec\.?|§)?\s*"
    rf"(?<!\d)(?P<num>\d{{1,3}}[A-Za-z]{{0,2}})(?![\dA-Za-z])"
    rf"(?:\s*\((?P<sub>\d+)\))?\s*(?:of\s+(?:the\s+)?)?(?P<act>{_ACT_ALT})\b",
    re.IGNORECASE,
)


# ── P0-D: malformed-explicit-reference detection ────────────────────────────
# Distinguishes three states for a message, used by retrieve_db() and
# check_query_for_orphan_warnings() so a FAILED citation attempt (overlong
# number, overlong suffix, a bare enactment year) is never silently treated
# as an ordinary open-ended question and promoted to an unrelated same-Act
# citation via fuzzy retrieval's act-label sentinel.
STATUTE_REF_VALID = "VALID_EXPLICIT_REFERENCE"
STATUTE_REF_INVALID = "INVALID_OR_UNSUPPORTED_EXPLICIT_REFERENCE"
STATUTE_REF_NONE = "NO_EXPLICIT_REFERENCE"

# Loose detector: an Act name adjacent to ANY digit run, WITHOUT the strict
# complete-identifier boundary checks used above. If this matches but
# extract_exact_statute_ref() does not, the user attempted an explicit
# citation that failed structural validation. A bare number/year with NO Act
# name anywhere near it does NOT match this and is correctly NO_EXPLICIT_REFERENCE
# — general questions that merely mention a year/amount are unaffected.
_LOOSE_ATTEMPT_FWD = re.compile(
    rf"\b(?:{_ACT_ALT})\b[\s\-]*(?:section|sections|sec\.?|\u00a7)?\s*\d",
    re.IGNORECASE,
)
_LOOSE_ATTEMPT_REV = re.compile(
    rf"\d[\dA-Za-z]*\s*(?:\(\d+\))?\s*(?:of\s+(?:the\s+)?)?(?:{_ACT_ALT})\b",
    re.IGNORECASE,
)


def classify_statute_reference_intent(text: str) -> str:
    """P0-D — classify a message's explicit-statute intent for safe retrieval
    routing. Returns STATUTE_REF_VALID / STATUTE_REF_INVALID / STATUTE_REF_NONE.
    Never treats a bare year/number with no Act name as an attempted citation."""
    if not text:
        return STATUTE_REF_NONE
    act, sec, _sub = extract_exact_statute_ref(text)
    if act and sec:
        return STATUTE_REF_VALID
    if _LOOSE_ATTEMPT_FWD.search(text) or _LOOSE_ATTEMPT_REV.search(text):
        return STATUTE_REF_INVALID
    return STATUTE_REF_NONE


def relative_top_cutoff(
    scored: list[tuple[float, object]],
    limit: int,
    min_floor: float,
    relative_ratio: float = 0.5,
    sentinel: float | None = None,
) -> list:
    """`scored` must already be sorted descending by score.

    Keeps at most `limit` items, dropping any whose score is below
    max(min_floor, relative_ratio * best_score) — "best_score" being the top
    score EXCLUDING any `sentinel`-valued entries (an explicit Act-label
    match), so one anchored citation cannot inflate the bar and silently
    swallow a second, genuinely-corroborated citation. Sentinel-valued
    entries themselves always pass through (they are a direct label match,
    not a fuzzy score), up to `limit`.
    """
    if not scored:
        return []
    real_scores = [s for s, _ in scored if sentinel is None or s != sentinel]
    top_real = real_scores[0] if real_scores else 0
    floor = max(min_floor, top_real * relative_ratio)
    out: list = []
    for s, item in scored:
        if len(out) >= limit:
            break
        if (sentinel is not None and s == sentinel) or s >= floor:
            out.append(item)
    return out
