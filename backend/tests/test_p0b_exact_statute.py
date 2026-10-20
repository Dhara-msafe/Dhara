"""
P0-B regression tests — Exact Statute Identification and Safe Retrieval.

Scope (per approved P0-B GO):
  * extract_exact_statute_ref() — pure deterministic parser, all 10 required
    formats, plus negative cases (bare numbers, IPC 166 vs 166A vs 166B).
  * retrieve_db() — mocked MongoDB (no live DB, no network, no LLM):
      - explicit Act+section -> exact-match route ONLY, never fuzzy fallback.
      - exact match not found -> [] (explicit "not found"), never an
        unrelated same-Act citation via the corroboration_score() 9999
        sentinel.
      - general natural-language query (no Act+section) -> legacy fuzzy path
        still runs (back-compat, unaffected by this change).
  * Existing P0-A tests and legal golden tests remain passing (run alongside).
"""
from __future__ import annotations

import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from retrieval_logic import extract_exact_statute_ref  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────
# 1. Pure parser tests — all 10 required formats
# ─────────────────────────────────────────────────────────────────────────

FORMATS = [
    ("IPC 166A", "Indian Penal Code", "166A", None),
    ("IPC-166A", "Indian Penal Code", "166A", None),
    ("166A IPC", "Indian Penal Code", "166A", None),
    ("Section 166A of IPC", "Indian Penal Code", "166A", None),
    ("Indian Penal Code Section 166A", "Indian Penal Code", "166A", None),
    ("BNS 199", "Bharatiya Nyaya Sanhita", "199", None),
    ("BNS-199", "Bharatiya Nyaya Sanhita", "199", None),
    ("Section 193(2) BNS", "Bharatiya Nyaya Sanhita", "193", "2"),
    ("IPC 166", "Indian Penal Code", "166", None),
    ("IPC 166B", "Indian Penal Code", "166B", None),
]


class TestAllTenSupportedFormats:
    @pytest.mark.parametrize("text,exp_act,exp_sec,exp_sub", FORMATS)
    def test_format(self, text, exp_act, exp_sec, exp_sub):
        act, sec, sub = extract_exact_statute_ref(text)
        assert act == exp_act, f"{text!r}: act mismatch (got {act!r})"
        assert sec == exp_sec, f"{text!r}: section mismatch (got {sec!r})"
        assert sub == exp_sub, f"{text!r}: subsection mismatch (got {sub!r})"

    def test_in_a_real_sentence(self):
        act, sec, sub = extract_exact_statute_ref("Hey DHARA, check IPC 166A please.")
        assert (act, sec) == ("Indian Penal Code", "166A")

    def test_question_phrasing(self):
        act, sec, sub = extract_exact_statute_ref("Does IPC 166A still apply?")
        assert (act, sec) == ("Indian Penal Code", "166A")


class TestDistinctIdentities:
    def test_166_166a_166b_are_distinct(self):
        r166 = extract_exact_statute_ref("IPC 166")
        r166a = extract_exact_statute_ref("IPC 166A")
        r166b = extract_exact_statute_ref("IPC 166B")
        assert r166[1] == "166"
        assert r166a[1] == "166A"
        assert r166b[1] == "166B"
        assert len({r166[1], r166a[1], r166b[1]}) == 3  # all different

    def test_bns_reference_never_becomes_ipc(self):
        act, sec, sub = extract_exact_statute_ref("BNS 166A")
        # User may have meant IPC 166A, but we must NOT silently rewrite the
        # Act — we parse exactly what was said: BNS as the Act.
        assert act == "Bharatiya Nyaya Sanhita"
        assert sec == "166A"


class TestUnqualifiedNumbersNeverMatch:
    @pytest.mark.parametrize("text", [
        "166A", "166", "what about 199?", "I am 166 cm tall",
        "call me at 199", "section needed", "",
    ])
    def test_bare_number_no_act_returns_none(self, text):
        act, sec, sub = extract_exact_statute_ref(text)
        assert act is None and sec is None and sub is None


class TestSubsectionPreserved:
    def test_subsection_parens_preserved(self):
        act, sec, sub = extract_exact_statute_ref("Section 193(2) BNS")
        assert sec == "193"
        assert sub == "2"

    def test_no_subsection_is_none(self):
        act, sec, sub = extract_exact_statute_ref("IPC 166A")
        assert sub is None


# ─────────────────────────────────────────────────────────────────────────
# 1b. P0-C.1 hardening — complete-identifier-boundary enforcement
# ─────────────────────────────────────────────────────────────────────────

class TestNoPartialTruncatedMatch:
    """The parser must never accept a PREFIX of a longer number/suffix as if
    it were the whole, correct identifier. Each of these must fail safely
    (None, None, None) — never resolve to a shorter, different section."""

    @pytest.mark.parametrize("text", [
        "IPC 9999",      # 4-digit overlong number -> must NOT become "999"
        "1860 IPC",      # enactment year -> must NOT become "860 IPC"
        "IPC 166ABCD",   # 4-letter overlong suffix -> must NOT become "166AB"
    ])
    def test_overlong_reference_fails_safely(self, text):
        act, sec, sub = extract_exact_statute_ref(text)
        assert (act, sec, sub) == (None, None, None), f"{text!r} must fail safely, got ({act!r},{sec!r},{sub!r})"

    @pytest.mark.parametrize("text,exp_sec", [
        ("IPC 166A", "166A"),
        ("IPC 511", "511"),
        ("BNS 199", "199"),
    ])
    def test_valid_references_still_work_after_hardening(self, text, exp_sec):
        act, sec, sub = extract_exact_statute_ref(text)
        assert sec == exp_sec

    def test_subsection_still_works_after_hardening(self):
        act, sec, sub = extract_exact_statute_ref("BNS 193(2)")
        assert (act, sec, sub) == ("Bharatiya Nyaya Sanhita", "193", "2")

    def test_166a_vs_166b_still_distinct_after_hardening(self):
        a = extract_exact_statute_ref("IPC 166A")
        b = extract_exact_statute_ref("IPC 166B")
        assert a[1] == "166A" and b[1] == "166B" and a[1] != b[1]


class TestMultipleReferencesInOneMessage:
    """Known, documented limitation (unchanged from P0-C): the parser finds
    only the FIRST explicit reference via .search(). It must still return a
    VALID identifier (never a corrupted/truncated one) and must never
    silently substitute a DIFFERENT section than the first one actually
    named. True multi-reference preservation (keeping both 166A and 168
    simultaneously) would require a broader CaseState/return-type change —
    NOT implemented here; flagged as a separate, larger dependency."""

    def test_first_of_two_references_is_returned_intact(self):
        act, sec, sub = extract_exact_statute_ref("IPC 166A and IPC 168")
        assert act == "Indian Penal Code"
        assert sec == "166A"  # the FIRST one named — not corrupted, not swapped

    def test_166a_vs_168_both_individually_valid(self):
        a = extract_exact_statute_ref("IPC 166A")
        b = extract_exact_statute_ref("IPC 168")
        assert a[1] == "166A"
        assert b[1] == "168"


# ─────────────────────────────────────────────────────────────────────────
# 2. retrieve_db() behaviour — mocked Motor DB, no live DB/network/LLM
# ─────────────────────────────────────────────────────────────────────────

class _FakeCursor:
    """Minimal async-iterable cursor mimicking Motor's find().sort().limit()."""
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _FakeCollection:
    def __init__(self, find_one_result=None, find_results=None):
        self._find_one_result = find_one_result
        self._find_results = find_results or []

    async def find_one(self, query):
        return self._find_one_result

    def find(self, *a, **kw):
        return _FakeCursor(self._find_results)


class _FakeDB:
    def __init__(self, legal_sections_find_one=None, legal_sections_find=None,
                 judicial_invalidations_find_one=None):
        self.legal_sections = _FakeCollection(
            find_one_result=legal_sections_find_one,
            find_results=legal_sections_find or [],
        )
        self.judicial_invalidations = _FakeCollection(
            find_one_result=judicial_invalidations_find_one,
        )


import corpus_db  # noqa: E402


@pytest.mark.asyncio
class TestExplicitIdentifierExactRoute:
    async def test_exact_match_found_returns_only_that_record(self):
        doc = {
            "act_name": "Indian Penal Code", "section_number": "166A",
            "section_heading": "Public servant disobeying direction under law",
            "section_text": "...", "source_url": "https://indiacode.gov.in",
            "verify_tier": 2, "is_dead_law": False, "act_id": "ipc",
        }
        db = _FakeDB(legal_sections_find_one=doc)
        results = await corpus_db.retrieve_db(db, "IPC 166A")
        assert len(results) == 1
        assert results[0]["section_number"] == "166A"
        assert results[0]["exact_identifier_requested"] is True

    async def test_exact_match_not_found_returns_empty_not_unrelated_citation(self):
        # No legal_sections doc, no judicial_invalidations record either —
        # lookup_section() returns None -> retrieve_db() must return [] and
        # must NEVER fall through to the fuzzy path (which would be primed
        # to find_results below if it ran).
        unrelated_doc = {
            "act_name": "Indian Penal Code", "section_number": "420",
            "section_heading": "Cheating", "score": 50.0, "act_id": "ipc",
            "is_dead_law": False,
        }
        db = _FakeDB(
            legal_sections_find_one=None,
            legal_sections_find=[unrelated_doc],
            judicial_invalidations_find_one=None,
        )
        results = await corpus_db.retrieve_db(db, "IPC 166A")
        assert results == [], "exact-match-not-found must return [], never an unrelated citation"

    async def test_bare_act_number_variants_all_take_exact_route(self):
        doc = {
            "act_name": "Bharatiya Nyaya Sanhita", "section_number": "199",
            "section_heading": "x", "section_text": "y", "act_id": "bns",
            "is_dead_law": False,
        }
        for q in ("BNS 199", "BNS-199", "199 BNS"):
            db = _FakeDB(legal_sections_find_one=doc)
            results = await corpus_db.retrieve_db(db, q)
            assert len(results) == 1 and results[0]["section_number"] == "199", q


@pytest.mark.asyncio
class TestGeneralRetrievalUnaffected:
    async def test_natural_language_query_still_uses_fuzzy_path(self):
        # No Act+section identifier in this query -> must NOT take the exact
        # short-circuit route; must reach the existing fuzzy phase (empty
        # candidate pool here is fine — we're only proving no exception and
        # no incorrect short-circuit, not fuzzy-ranking correctness itself).
        db = _FakeDB(legal_sections_find_one=None, legal_sections_find=[])
        results = await corpus_db.retrieve_db(db, "I was physically assaulted by my neighbour")
        assert results == []  # empty fake corpus -> empty, but no exception raised

    async def test_bare_section_no_act_still_uses_legacy_sec_re_path(self):
        # "Section 138" has no Act name -> extract_exact_statute_ref() returns
        # None -> falls through to the UNCHANGED legacy _SEC_RE path.
        doc = {
            "act_name": "Negotiable Instruments Act", "section_number": "138",
            "section_heading": "x", "section_text": "y", "act_id": "ni",
            "is_dead_law": False,
        }
        db = _FakeDB(legal_sections_find_one=doc, legal_sections_find=[])
        results = await corpus_db.retrieve_db(db, "Section 138 cheque bounce")
        assert any(r.get("section_number") == "138" for r in results)
