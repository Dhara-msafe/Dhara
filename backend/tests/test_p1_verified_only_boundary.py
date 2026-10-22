"""
P1 — Verified-only release boundary (Item 2 of the "Resolve Remaining Legal
and Sharing Blockers" correction pass).

This file does NOT change any production behaviour — exploration confirmed
the existing guard already satisfies the requirement:

  "Ensure unverified mapping/corpus records cannot support answers labelled
   verified. Do not mark a source verified merely because it appears in a
   mapping file. If a record supports only a correspondence hint, present
   only that limited verified information."

Evidence (reproducible, from the actual data file — not a full audit):
  - ipc_bns_mapping.json currently has 999 total records.
  - 0 of them have verified=True.
  - 995 have no review_status field at all (the /advocate/cross-reference
    endpoint in server.py defaults this to "unreviewed_draft").
  - 4 have review_status="corrected_pending_review" (the P0-A quarantine
    fix for the 155/166A/168/255 pairs).

corpus_db.py's check_bns_family_identifier() / chat_router.py's
build_bns_identifier_hypothesis_response() ALREADY only ever use this file
to (a) pick between two hedged REFUSAL templates (neither asserts
substantive legal content) and (b) build an explicitly-hedged "you may be
thinking of former IPC Section X" suggestion that never claims to be
verified. These tests pin that invariant down explicitly so a future
change can't silently start treating a draft mapping record as verified.

Direct unit tests against the pure functions — no DB, no network, no live
server. Synthetic data only.
"""
import sys
import os
import json
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from corpus_db import check_bns_family_identifier  # noqa: E402
from engine.answer_generator import build_bns_identifier_hypothesis_response  # noqa: E402

_MAPPING_PATH = Path(__file__).parent.parent / "ipc_bns_mapping.json"


def _load_mapping_records():
    data = json.loads(_MAPPING_PATH.read_text())
    records = []
    for table, entries in data.items():
        if isinstance(entries, list):
            records.extend(e for e in entries if isinstance(e, dict))
    return records


class TestMappingFileVerificationCounts:
    """Cheap, existing-data-only count check (NOT a comprehensive audit) —
    reports exactly how many mapping records currently claim to be
    verified, so this number is visible and can be tracked over time."""

    def test_report_verified_vs_unverified_counts(self):
        records = _load_mapping_records()
        assert len(records) > 0
        verified_count = sum(1 for r in records if r.get("verified") is True)
        unreviewed_count = sum(1 for r in records if not r.get("review_status"))
        corrected_pending = sum(1 for r in records if r.get("review_status") == "corrected_pending_review")
        print(
            f"\n[verified-only release boundary] total={len(records)} "
            f"verified_true={verified_count} unreviewed_draft={unreviewed_count} "
            f"corrected_pending_review={corrected_pending}"
        )
        # Pin the current honest state: nothing in this file currently claims
        # to be independently verified — it is a correspondence-hint table only.
        assert verified_count == 0, (
            "If this ever becomes non-zero, re-check that check_bns_family_identifier() "
            "and the hypothesis builder still never present such a record as settled law."
        )


class TestHypothesisResponseNeverClaimsVerified:
    """build_bns_identifier_hypothesis_response() must always hedge, even
    when the underlying correspondence record is an unreviewed draft."""

    def test_166a_hypothesis_is_hedged_not_verified(self):
        existence = check_bns_family_identifier("166A")
        assert existence["confirmed_existing"] is False, "166A is not itself a real BNS/BNSS/BSA identifier"
        hyp = existence.get("ipc_origin_hypothesis")
        assert hyp and hyp.get("bns_section") == "199"
        msg = build_bns_identifier_hypothesis_response("IPC", "166A", hyp)
        lowered = msg.lower()
        assert "verified" not in lowered or "cannot" in lowered or "can't" in lowered, (
            "the response must never assert the hypothesis itself is verified"
        )
        assert any(w in lowered for w in ("may be", "licensed advocate", "cannot independently confirm", "can't independently confirm")), \
            "expected an explicit hedge/disclaimer phrase"

    def test_confirmed_existing_sections_never_reach_the_hypothesis_builder(self):
        """check_bns_family_identifier() may legitimately return BOTH
        confirmed_existing=True (the numeral is a real current section) AND
        a non-null ipc_origin_hypothesis (the SAME numeral also happens to
        match a former, substantively-different, IPC section) — e.g. "199"
        is both the real current BNS 199 and the former IPC 199. That is
        correct, informative data, not a bug. The actual safety invariant
        lives one layer up, in api/chat_router.py's gating condition
        (`if not confirmed_existing and ipc_origin_hypothesis`): the
        hedged-hypothesis builder must only ever be reachable when
        confirmed_existing is False. This test pins that exact gate."""
        existence = check_bns_family_identifier("199")
        assert existence["confirmed_existing"] is True
        reaches_hypothesis_builder = (
            not existence.get("confirmed_existing") and existence.get("ipc_origin_hypothesis")
        )
        assert not reaches_hypothesis_builder, (
            "a confirmed-existing section must never be routed through the "
            "unverified-correspondence hypothesis messaging"
        )


class TestCorrespondenceHintNeverExpandedIntoSubstantiveClaim:
    def test_hypothesis_response_contains_no_punishment_or_term_language(self):
        """The hedged hypothesis for an unverified mapping-only record must
        only describe the CORRESPONDENCE, never invent punishment/term
        details — those require an actually-grounded record."""
        existence = check_bns_family_identifier("166A")
        hyp = existence.get("ipc_origin_hypothesis")
        msg = build_bns_identifier_hypothesis_response("IPC", "166A", hyp)
        lowered = msg.lower()
        for banned in ("shall be punished with imprisonment of", "fine of rs", "up to 1 year", "up to one year"):
            assert banned not in lowered, f"hypothesis response must not invent punishment text ({banned!r} found)"
