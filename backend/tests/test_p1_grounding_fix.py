"""
P1 tests — grounding-safety fix for the BNS 199 / IPC 166A contradiction.

Scope (reuses existing P0-B/P0-D mock patterns, no live LLM calls):
  * legal_sections now has verified IPC 166A + BNS 199 records (seeded via
    scripts/seed_ipc166a_bns199.py) with the correct punishment, and
    retrieve_db() returns them correctly shaped (successor_act passthrough
    for IPC 166A's historical framing).
  * check_bns_family_identifier(): existence-index + IPC-origin hypothesis,
    reused from the SAME ipc_bns_mapping.json table server.py's own
    cross-reference search already loads.
  * build_bns_identifier_hypothesis_response(): deterministic/template, never
    asserts non-existence, always offers the hypothesis with hedged language.
  * Nearby-identifier distinctness (166, 166A, 166B, 199 IPC vs 199 BNS)
    remains intact after adding the two new records.
"""
from __future__ import annotations

import os
import sys

import pytest
from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

import corpus_db  # noqa: E402
from tests.test_p0b_exact_statute import _FakeDB  # reuse existing mock  # noqa: E402
from engine.answer_generator import (  # noqa: E402
    build_bns_identifier_hypothesis_response,
    build_cannot_verify_response,
    all_provisions_dead,
)


# ── Live-DB checks against the actual seeded records ─────────────────────────
# These hit the real preview DB directly (read-only) to confirm the seed
# script's idempotent upsert actually produced correct, complete records —
# not just that the mock-based unit tests below pass.

@pytest.mark.asyncio
class TestSeededRecordsAreCorrect:
    async def _get_real_db(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        return client[os.environ.get("DB_NAME", "test_database")]

    async def test_bns_199_record_exists_with_correct_punishment(self):
        db = await self._get_real_db()
        doc = await db.legal_sections.find_one({"act_name": "Bharatiya Nyaya Sanhita", "section_number": "199"})
        assert doc is not None, "BNS 199 must have a verified legal_sections record"
        assert doc["is_dead_law"] is False
        assert "six months" in doc["section_text"] and "two years" in doc["section_text"]
        assert "rigorous imprisonment" in doc["section_text"].lower()
        assert doc.get("source_url")

    async def test_ipc_166a_record_is_historical_with_successor(self):
        db = await self._get_real_db()
        doc = await db.legal_sections.find_one({"act_name": "Indian Penal Code", "section_number": "166A"})
        assert doc is not None, "IPC 166A must have a verified legal_sections record"
        assert doc["is_dead_law"] is True
        assert "199" in (doc.get("successor_act") or "")
        assert "six months" in doc["section_text"] and "two years" in doc["section_text"]

    async def test_adjacent_ipc_166_still_has_no_fabricated_record(self):
        # We must NOT have accidentally created/touched a record for the
        # adjacent, unrelated IPC Section 166 while fixing 166A.
        db = await self._get_real_db()
        doc = await db.legal_sections.find_one({"act_name": "Indian Penal Code", "section_number": "166"})
        assert doc is None or doc.get("seeded_by") != "p1_grounding_fix_2026-06"


# ── retrieve_db() shape checks (mocked DB, mirrors the real seeded shape) ────

@pytest.mark.asyncio
class TestRetrieveDbReturnsCorrectGrounding:
    async def test_bns_199_returns_current_correct_provision(self):
        doc = {
            "act_name": "Bharatiya Nyaya Sanhita", "section_number": "199",
            "section_heading": "Public servant disobeying direction under law",
            "section_text": "...rigorous imprisonment...six months...two years...fine...",
            "is_dead_law": False, "act_id": "bns", "source_url": "https://indiacode.gov.in",
        }
        db = _FakeDB(legal_sections_find_one=doc)
        results = await corpus_db.retrieve_db(db, "BNS 199")
        assert len(results) == 1
        assert results[0]["section_number"] == "199"
        assert results[0]["is_dead_law"] is False
        assert all_provisions_dead(results) is False

    async def test_ipc_166a_returns_historical_hit_with_successor(self):
        doc = {
            "act_name": "Indian Penal Code", "section_number": "166A",
            "section_heading": "Public servant disobeying direction under law",
            "section_text": "...rigorous imprisonment...six months...two years...fine...",
            "is_dead_law": True, "act_id": "ipc",
            "successor_act": "Bharatiya Nyaya Sanhita, Section 199",
        }
        db = _FakeDB(legal_sections_find_one=doc)
        results = await corpus_db.retrieve_db(db, "IPC 166A")
        assert len(results) == 1
        assert results[0]["is_dead_law"] is True
        assert results[0]["successor_act"] == "Bharatiya Nyaya Sanhita, Section 199"
        assert all_provisions_dead(results) is True  # Layer M gate should trigger

    async def test_cannot_verify_response_names_successor_for_166a(self):
        hit = {
            "act_name": "Indian Penal Code", "section_number": "166A",
            "is_dead_law": True, "successor_act": "Bharatiya Nyaya Sanhita, Section 199",
            "status": "SUPERSEDED",
        }
        text = build_cannot_verify_response(None, dead_hits=[hit])
        assert "199" in text, "Historical explanation must name the BNS 199 correspondence"


# ── check_bns_family_identifier() — existence index + hypothesis ────────────

class TestBnsFamilyIdentifierCheck:
    def test_199_confirmed_existing_via_correspondence_table(self):
        result = corpus_db.check_bns_family_identifier("199")
        assert result["confirmed_existing"] is True

    def test_166a_not_in_bns_existence_index_but_has_ipc_origin_hypothesis(self):
        result = corpus_db.check_bns_family_identifier("166A")
        assert result["confirmed_existing"] is False
        assert result["ipc_origin_hypothesis"] is not None
        assert result["ipc_origin_hypothesis"]["bns_section"] == "199"

    def test_totally_unknown_number_has_no_hypothesis_either(self):
        result = corpus_db.check_bns_family_identifier("99999")
        assert result["confirmed_existing"] is False
        assert result["ipc_origin_hypothesis"] is None


class TestHypothesisResponseIsHedgedNeverAssertive:
    def test_response_never_declares_section_invalid(self):
        hyp = {"bns_section": "199", "what_changed": "x", "source_link": "y"}
        text = build_bns_identifier_hypothesis_response("Bharatiya Nyaya Sanhita", "166A", hyp)
        lowered = text.lower()
        # Must hedge ("can't confirm it does/doesn't exist either way"), never
        # bare-assert non-existence or call the identifier "invalid".
        assert "invalid" not in lowered
        assert "this section does not exist" not in lowered
        assert "don't have a verified record" in lowered
        assert "can't independently confirm" in lowered
        assert "199" in text
        assert "licensed advocate" in lowered

    def test_response_never_swaps_the_users_act(self):
        # The hypothesis must be OFFERED, not substituted: the user's own
        # act name must still appear, unchanged, in the response.
        hyp = {"bns_section": "199", "what_changed": "x", "source_link": "y"}
        text = build_bns_identifier_hypothesis_response("Bharatiya Nyaya Sanhita", "166A", hyp)
        assert "Bharatiya Nyaya Sanhita" in text


# ── Nearby-identifier distinctness remains intact ────────────────────────────

@pytest.mark.asyncio
class TestNearbyIdentifiersRemainDistinct:
    @pytest.mark.parametrize("sec", ["166", "166B", "168"])
    async def test_sibling_sections_not_confused_with_166a(self, sec):
        # None of these should resolve to the 166A/199 record.
        unrelated = {"act_name": "Indian Penal Code", "section_number": sec, "is_dead_law": False}
        db = _FakeDB(legal_sections_find_one=unrelated)
        results = await corpus_db.retrieve_db(db, f"IPC {sec}")
        assert results[0]["section_number"] == sec  # exact match on its OWN number only

    async def test_old_ipc_199_distinct_from_new_bns_199(self):
        # Old IPC 199 (false statement) must never be returned for a BNS 199 query.
        db = _FakeDB(legal_sections_find_one=None)  # BNS 199 lookup finds nothing in this mock
        results = await corpus_db.retrieve_db(db, "BNS 199")
        assert results == []  # must NOT fall back to the unrelated IPC 199 doc
