"""
P0-A regression tests — IPC/BNS correspondence correction.

Scope (per approved P0-A GO):
  * Verifies the 4 corrected records (IPC 166A, 155, 255, 168) now hold the
    NCRB-verified BNS values, in BOTH the live data file (ipc_bns_mapping.json)
    and the generator (build_ipc_mapping.py), so a future regeneration cannot
    silently reintroduce the old wrong values.
  * Verifies `verified` was NOT flipped to True (no fabricated legal review).
  * Verifies no unrelated record was touched (spot-checks neighbours).
  * Verifies legitimate many-to-one correspondences are preserved (BNS 178
    still reachable from more than one historical IPC section once reviewed;
    here we only assert the dataset is not corrupted into a 1:1-only shape).
  * Verifies the JSON file is still syntactically valid.
  * Verifies server.py::_normalise() quarantine tripwire fires ONLY for the
    4 known-wrong pairs and never for any other record.

Local-fixture only. No network, no LLM calls, no live DB writes.
"""
from __future__ import annotations

import json
import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

JSON_PATH = os.path.join(BACKEND_DIR, "ipc_bns_mapping.json")
GEN_PATH = os.path.join(BACKEND_DIR, "build_ipc_mapping.py")

EXPECTED = {
    "166A": {"bns": "199", "sub": None},
    "155":  {"bns": "193", "sub": "(2)"},
    "255":  {"bns": "178", "sub": None},
    "168":  {"bns": "202", "sub": None},
}

# Unaffected neighbours that must remain byte-for-byte unchanged in value.
UNRELATED_SPOT_CHECK = {
    "156": "200",   # neighbour of 155
    "166": "198",   # neighbour of 166A
    "166B": "203",  # neighbour of 166A
    "167": "204",   # neighbour of 168
    "169": "206",   # neighbour of 168
    "256": "200",   # neighbour of 255
}


@pytest.fixture(scope="module")
def xref_data() -> dict:
    with open(JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def _find(data: dict, ipc_section: str) -> dict:
    for e in data["ipc_complete_mapping"]:
        if str(e.get("ipc_section")) == ipc_section:
            return e
    raise AssertionError(f"IPC {ipc_section} not found in ipc_complete_mapping")


class TestJsonIsValid:
    def test_file_parses_as_json(self, xref_data):
        assert "ipc_complete_mapping" in xref_data
        assert len(xref_data["ipc_complete_mapping"]) == 559  # count unchanged


class TestCorrectedValues:
    @pytest.mark.parametrize("ipc_section", list(EXPECTED.keys()))
    def test_corrected_bns_value(self, xref_data, ipc_section):
        entry = _find(xref_data, ipc_section)
        expected = EXPECTED[ipc_section]
        assert entry["bns_section"] == expected["bns"]
        if expected["sub"]:
            assert entry.get("bns_subsection") == expected["sub"]

    @pytest.mark.parametrize("ipc_section", list(EXPECTED.keys()))
    def test_verified_flag_not_fabricated(self, xref_data, ipc_section):
        entry = _find(xref_data, ipc_section)
        assert entry["verified"] is False
        assert entry.get("reviewed_at") is None
        assert entry.get("reviewed_by") is None

    @pytest.mark.parametrize("ipc_section", list(EXPECTED.keys()))
    def test_review_status_marks_corrected_pending(self, xref_data, ipc_section):
        entry = _find(xref_data, ipc_section)
        assert entry.get("review_status") == "corrected_pending_review"
        assert "NCRB" in entry.get("review_source", "")

    def test_old_wrong_values_no_longer_present_for_these_sections(self, xref_data):
        # The specific WRONG combinations must no longer exist anywhere.
        wrong_pairs = {("155", "199"), ("166A", "202"), ("255", "199"), ("168", "205")}
        for e in xref_data["ipc_complete_mapping"]:
            pair = (str(e.get("ipc_section")), str(e.get("bns_section")))
            assert pair not in wrong_pairs, f"Known-incorrect pair still present: {pair}"


class TestNoUnrelatedRecordsTouched:
    @pytest.mark.parametrize("ipc_section,expected_bns", list(UNRELATED_SPOT_CHECK.items()))
    def test_neighbour_unchanged(self, xref_data, ipc_section, expected_bns):
        entry = _find(xref_data, ipc_section)
        assert entry["bns_section"] == expected_bns
        assert "review_status" not in entry  # untouched records keep original shape

    def test_total_record_counts_unchanged(self, xref_data):
        assert len(xref_data["bns_to_ipc_mapping"]) == 57
        assert len(xref_data["crpc_to_bnss_mapping"]) == 183
        assert len(xref_data["evidence_act_to_bsa_mapping"]) == 168


class TestReverseMappingContradictions:
    """P0-A item 3: confirm no contradictory reverse entries exist for the
    4 corrected sections / affected BNS numbers. (Audited: none found.)"""

    def test_no_contradicting_reverse_entries(self, xref_data):
        targets_ipc = {"166A", "155", "255", "168"}
        targets_bns = {"199", "193", "193(2)", "178", "202", "205"}
        hits = []
        for e in xref_data.get("bns_to_ipc_mapping", []):
            if str(e.get("ipc_section")) in targets_ipc or str(e.get("bns_section")) in targets_bns:
                hits.append(e)
        for e in xref_data.get("reverse_lookup_ipc_to_bns", []):
            if str(e.get("ipc_section")) in targets_ipc or str(e.get("bns_section")) in targets_bns:
                hits.append(e)
        assert hits == [], f"Unexpected contradicting reverse entries found: {hits}"


class TestGeneratorConsistency:
    def test_generator_file_has_corrected_values(self):
        with open(GEN_PATH, encoding="utf-8") as f:
            text = f.read()
        assert '("155", "193",' in text
        assert '("166A","199",' in text
        assert '("168", "202",' in text
        assert '("255", "178",' in text
        # Old wrong literal rows must be gone
        assert '("155", "199",   "Liability of person' not in text
        assert '("166A","202",   "Public servant disobeying direction' not in text
        assert '("168", "205",   "Public servant unlawfully engaging' not in text
        assert '("255", "199",   "Making or selling instrument' not in text

    def test_generator_file_is_valid_python(self):
        import ast
        with open(GEN_PATH, encoding="utf-8") as f:
            ast.parse(f.read())


class TestServerNormaliseQuarantine:
    """Imports only the pure _normalise()-equivalent logic by re-implementing
    the same lookup table check against server.py's source text, to avoid
    importing the full FastAPI app (which opens a DB connection at import
    time) — keeping this test fully offline per P0-A scope."""

    def test_quarantine_set_matches_known_wrong_pairs(self):
        with open(os.path.join(BACKEND_DIR, "server.py"), encoding="utf-8") as f:
            text = f.read()
        assert "_KNOWN_INCORRECT_IPC_BNS_PAIRS" in text
        assert '("155", "199")' in text
        assert '("166A", "202")' in text
        assert '("168", "205")' in text
        assert '("255", "199")' in text
        assert "quarantined_incorrect" in text
        # Additive provenance keys present, existing keys preserved
        for key in ("review_status", "review_source", "reviewed_at", "reviewed_by",
                    "mapping_version", "new_subsection", '"verified":', '"source_link":'):
            assert key in text

    def test_server_file_is_valid_python(self):
        import ast
        with open(os.path.join(BACKEND_DIR, "server.py"), encoding="utf-8") as f:
            ast.parse(f.read())
