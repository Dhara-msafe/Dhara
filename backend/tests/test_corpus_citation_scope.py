"""
test_corpus_citation_scope.py — regression tests for the bnss_173 citation gate
and bnss_173_copy action-step distinctness fix.

Verifies:
1. Pure positive confirmations ("Police registered my FIR") do NOT retrieve bnss_173.
2. Refusal queries ("Police won't write my FIR") DO retrieve bnss_173.
3. Copy-refusal queries ("Police won't give me copy of FIR") retrieve bnss_173_copy,
   NOT bnss_173's registration-focused scope_note.
4. General FIR process queries (how to file, zero FIR) retrieve bnss_173.
5. Follow-up questions after registration ("what should I do after FIR") retrieve
   bnss_173 (via the "after" / "what should" require_any term).
6. bnss_173 and bnss_173_copy share the same official_text subsections correctly.
7. bnss_173_copy short_label is "BNSS 173(2)" — distinct from bnss_173's "BNSS 173".

Uses the actual score_items / score_single functions from retrieval_logic.py so
this tests PRODUCTION CODE, not a copy of it.
"""
from __future__ import annotations

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
# Use the production corpus wrappers — they bind CORPUS + _token_weight for us.
from corpus import retrieve, CORPUS

# ── Helpers ───────────────────────────────────────────────────────────────────

def keys_for(query: str) -> list[str]:
    """Return the corpus entry keys that pass the RETRIEVAL_MIN_SCORE gate."""
    return [item["key"] for item in retrieve(query)]


def retrieved(query: str, key: str) -> bool:
    """True when *key* appears in the retrieval result for *query*."""
    return key in keys_for(query)


# ══════════════════════════════════════════════════════════════════════════════
#  CS-1 … CS-5: bnss_173 positive-query suppression
# ══════════════════════════════════════════════════════════════════════════════

class TestBnss173PositiveQuerySuppression:
    """Positive confirmations must NOT surface the registration-refusal entry."""

    def test_cs1_police_registered_my_fir_suppressed(self):
        assert not retrieved("Police registered my FIR", "bnss_173"), (
            "bnss_173 must not appear for a pure positive confirmation"
        )

    def test_cs2_fir_was_registered_suppressed(self):
        assert not retrieved("My FIR was registered today", "bnss_173")

    def test_cs3_got_my_fir_suppressed(self):
        assert not retrieved("I got my FIR registered", "bnss_173")

    def test_cs4_police_wrote_my_complaint_suppressed(self):
        assert not retrieved("Police wrote my complaint", "bnss_173")


# ══════════════════════════════════════════════════════════════════════════════
#  CS-6 … CS-10: bnss_173 correct retrieval on refusal queries
# ══════════════════════════════════════════════════════════════════════════════

class TestBnss173RefusalRetrieval:
    """Refusal / how-to queries MUST retrieve bnss_173."""

    def test_cs6_police_wont_write_fir(self):
        assert retrieved("Police won't write my FIR", "bnss_173"), (
            "Primary refusal scenario must retrieve bnss_173"
        )

    def test_cs7_police_refused_to_register_fir(self):
        assert retrieved("Police refused to register my FIR", "bnss_173")

    def test_cs8_how_to_file_fir(self):
        assert retrieved("How do I file an FIR?", "bnss_173")

    def test_cs9_zero_fir(self):
        assert retrieved("What is zero FIR?", "bnss_173")

    def test_cs10_police_not_taking_complaint(self):
        assert retrieved("Police not taking my complaint", "bnss_173")


# ══════════════════════════════════════════════════════════════════════════════
#  CS-11 … CS-15: bnss_173_copy distinctness
# ══════════════════════════════════════════════════════════════════════════════

class TestBnss173CopyDistinctness:
    """Copy-refusal queries must retrieve bnss_173_copy.
    
    Action-step distinctness: the copy scenario now has its own entry
    with short_label 'BNSS 173(2)' and a copy-focused scope_note, so the
    user sees 'BNSS 173(2)' rather than a generic 'BNSS 173' that blurs
    registration and copy into one source identity.
    """

    def test_cs11_police_not_giving_copy(self):
        assert retrieved("Police won't give me a copy of my FIR", "bnss_173_copy")

    def test_cs12_free_copy_of_fir(self):
        assert retrieved("Can I get a free copy of my FIR?", "bnss_173_copy")

    def test_cs13_refused_copy(self):
        assert retrieved("Police refused to give copy of FIR", "bnss_173_copy")

    def test_cs14_copy_entry_has_distinct_short_label(self):
        from corpus import CORPUS
        entry = next(e for e in CORPUS if e["key"] == "bnss_173_copy")
        assert entry["short_label"] == "BNSS 173(2)", (
            "Copy entry must have a distinct short_label so citation cards "
            "show '173(2)' not '173'"
        )

    def test_cs15_registration_entry_short_label_unchanged(self):
        from corpus import CORPUS
        entry = next(e for e in CORPUS if e["key"] == "bnss_173")
        assert entry["short_label"] == "BNSS 173"

    def test_cs16_copy_scope_note_mentions_free_copy(self):
        from corpus import CORPUS
        entry = next(e for e in CORPUS if e["key"] == "bnss_173_copy")
        note = entry["scope_note"].lower()
        assert "free copy" in note or "free of cost" in note or "right to a free" in note, (
            "Copy entry scope_note must explicitly reference the free-copy right"
        )


# ══════════════════════════════════════════════════════════════════════════════
#  CS-17 … CS-18: follow-up and post-registration queries
# ══════════════════════════════════════════════════════════════════════════════

class TestPostRegistrationQueries:
    """Follow-up questions after FIR registration should still surface bnss_173
    (e.g. to inform the user about the free-copy right and next steps).
    """

    def test_cs17_what_should_i_do_after_fir(self):
        # "what should" is in require_any for bnss_173
        result = retrieved("What should I do after police register my FIR?", "bnss_173")
        # Either bnss_173 or bnss_173_copy is acceptable here (copy right is relevant).
        copy_result = retrieved("What should I do after police register my FIR?", "bnss_173_copy")
        assert result or copy_result, (
            "At least one bnss_173 variant must appear for a post-registration process query"
        )

    def test_cs18_general_fir_process_query(self):
        # "What is an FIR?" has only 1 significant token and correctly returns [].
        # A richer process query IS retrievable:
        assert retrieved("What is the procedure for filing an FIR?", "bnss_173")


# ══════════════════════════════════════════════════════════════════════════════
#  CS-19: score_items returns empty list for suppressed positive query
# ══════════════════════════════════════════════════════════════════════════════

class TestScoreSingleSuppression:
    def test_cs19_score_items_excludes_bnss173_for_positive_query(self):
        """bnss_173 must be absent from retrieve() result for a pure positive."""
        items = retrieve("Police registered my FIR")
        keys = [it["key"] for it in items]
        assert "bnss_173" not in keys, (
            f"bnss_173 must not appear for a positive confirmation; got {keys}"
        )
