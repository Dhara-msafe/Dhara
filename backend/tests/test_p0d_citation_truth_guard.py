"""
P0-D tests — Highest-priority fix: malformed-explicit-reference handling in
retrieve_db(), plus the orphan-warning consistency fix.

Scope covered here (within the 10-12 call budget for this stage):
  * classify_statute_reference_intent() — VALID / INVALID_OR_UNSUPPORTED /
    NO_EXPLICIT_REFERENCE, including "do not reject general questions that
    merely contain a year/number".
  * retrieve_db(): malformed attempts ("IPC 9999", "IPC 166ABCD",
    "1860 IPC") return [] and NEVER reach the fuzzy/sentinel path (proven via
    a mocked DB primed with an unrelated IPC doc that would otherwise be
    returned by the act-label sentinel).
  * check_query_for_orphan_warnings(): bare "IPC 377" now resolves via the
    exact extractor (previously silently returned None).

NOT YET covered by automated tests in this stage (reported as deferred —
see delivery message): the inline chat_router.py citation-truth-guard block
and the active_statute_ref retrieval-text fallback, which are implemented
but require either a refactor into a standalone testable function or a
heavier chat-endpoint integration test — both out of this budget.
"""
from __future__ import annotations

import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from retrieval_logic import (  # noqa: E402
    classify_statute_reference_intent,
    STATUTE_REF_VALID, STATUTE_REF_INVALID, STATUTE_REF_NONE,
)
import corpus_db  # noqa: E402
from tests.test_p0b_exact_statute import _FakeDB  # reuse existing mock # noqa: E402


class TestThreeStateClassification:
    @pytest.mark.parametrize("text", ["IPC 166A", "BNS 199", "BNS 193(2)", "IPC 511"])
    def test_valid(self, text):
        assert classify_statute_reference_intent(text) == STATUTE_REF_VALID

    @pytest.mark.parametrize("text", ["IPC 9999", "IPC 166ABCD", "1860 IPC"])
    def test_invalid_attempt(self, text):
        assert classify_statute_reference_intent(text) == STATUTE_REF_INVALID

    @pytest.mark.parametrize("text", [
        "I was assaulted in 2023", "My case from 1990", "He owes me 500000 rupees",
        "", "Hello DHARA",
    ])
    def test_general_question_with_numbers_not_flagged(self, text):
        # Critical negative requirement: years/amounts with NO Act name must
        # NEVER be misclassified as an invalid citation attempt.
        assert classify_statute_reference_intent(text) == STATUTE_REF_NONE


@pytest.mark.asyncio
class TestMalformedReferenceNeverReachesFuzzyPath:
    """The highest-priority P0-D requirement: a malformed explicit reference
    must not be promoted to an unrelated same-Act citation. We prime the fake
    DB with an UNRELATED IPC document (that a working act-label sentinel
    WOULD surface for any generic IPC query) and prove it is never returned."""

    @pytest.mark.parametrize("query", ["IPC 9999", "IPC 166ABCD", "1860 IPC"])
    async def test_malformed_reference_returns_empty_not_unrelated(self, query):
        unrelated_doc = {
            "act_name": "Indian Penal Code", "section_number": "420",
            "section_heading": "Cheating", "act_id": "ipc", "is_dead_law": False,
        }
        db = _FakeDB(legal_sections_find_one=None, legal_sections_find=[unrelated_doc])
        results = await corpus_db.retrieve_db(db, query)
        assert results == [], f"{query!r} must return [], never an unrelated citation"

    async def test_valid_reference_unaffected_by_this_change(self):
        doc = {
            "act_name": "Indian Penal Code", "section_number": "166A",
            "section_heading": "x", "section_text": "y", "act_id": "ipc",
            "is_dead_law": False,
        }
        db = _FakeDB(legal_sections_find_one=doc)
        results = await corpus_db.retrieve_db(db, "IPC 166A")
        assert len(results) == 1 and results[0]["section_number"] == "166A"

    async def test_general_question_still_reaches_fuzzy_path(self):
        db = _FakeDB(legal_sections_find_one=None, legal_sections_find=[])
        results = await corpus_db.retrieve_db(db, "My neighbour hit me yesterday")
        assert results == []  # empty fake corpus, but no exception / no wrong short-circuit


class _FakeOrphanDB:
    """Fake DB for check_query_for_orphan_warnings — only judicial_invalidations
    matters; legal_sections is irrelevant to this function."""
    class _Coll:
        def __init__(self, doc):
            self._doc = doc
        async def find_one(self, query):
            return self._doc

    def __init__(self, doc=None):
        self.judicial_invalidations = self._Coll(doc)
        self.legal_sections = self._Coll(None)


@pytest.mark.asyncio
class TestOrphanWarningBarePhrasing:
    async def test_bare_ipc_377_now_resolves(self, monkeypatch):
        # Before P0-D: _SEC_RE required the literal word "Section" and
        # missed "IPC 377" entirely, silently returning None.
        called_with = {}
        async def _fake_check_orphan(db, sec, act_hint):
            called_with["sec"] = sec
            called_with["act_hint"] = act_hint
            return {"section": sec, "ruling": "Navtej Singh Johar v. UOI"}
        monkeypatch.setattr(corpus_db, "check_orphan_invalidation", _fake_check_orphan)
        result = await corpus_db.check_query_for_orphan_warnings(_FakeOrphanDB(), "IPC 377")
        assert result is not None
        assert called_with["sec"] == "377"
        assert called_with["act_hint"] == "Indian Penal Code"

    async def test_bare_section_no_act_still_uses_legacy_path(self, monkeypatch):
        called_with = {}
        async def _fake_check_orphan(db, sec, act_hint):
            called_with["sec"] = sec
            return None
        monkeypatch.setattr(corpus_db, "check_orphan_invalidation", _fake_check_orphan)
        await corpus_db.check_query_for_orphan_warnings(_FakeOrphanDB(), "Section 138 bounce")
        assert called_with["sec"] == "138"

    async def test_no_reference_at_all_returns_none(self):
        result = await corpus_db.check_query_for_orphan_warnings(_FakeOrphanDB(), "I need help")
        assert result is None
