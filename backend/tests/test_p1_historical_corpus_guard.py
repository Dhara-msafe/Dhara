"""
P1 — Python-corpus citation-guard parity fix.

ROOT CAUSE (fixed in engine/law_status_guard.py + corpus_ipc.py +
api/chat_router.py): the Law Status Guard (Layer S) annotates EVERY
retrieved provision — both MongoDB (`legal_sections`) hits AND the
hand-curated Python corpus (corpus.py / corpus_ipc.py) hits — by matching
its act name against data/law_status_registry.json. IPC_1860 and
CRPC_1973 are both registered SUPERSEDED (by BNS/BNSS from 1 July 2024).
Before this fix, `annotate_provisions()` treated ANY IPC/CrPC-tagged hit
as dead law (is_dead_law=True + dead_warning), with no distinction between:

  (a) a bare MongoDB record whose ONLY fact is "this is dead, see
      successor X" (no right to quote old punishment text) — refusing the
      substantive question and naming the successor is correct here; and
  (b) a corpus_ipc.py entry that was hand-verified SPECIFICALLY to answer
      "what did IPC/CrPC section X say" correctly, including for events,
      FIRs and trials from before the cutover, where the old text is
      still the governing law.

Because engine/answer_generator.py's `all_provisions_dead()` / `_is_dead()`
check exactly those three fields (is_dead_law, status, dead_warning), a
query whose ONLY hit was a corpus_ipc.py entry (case b) was being swallowed
by the generic "I cannot confirm this from the official text" cannot-verify
refusal template — even though a hand-verified, correct, historically-
framed answer was available. This is the "do not automatically label every
historical provision unusable or return a dead-law template" defect.

These are direct unit tests against the pure functions (no DB, no network,
no live server) — synthetic/library data only.

=== POLICY CHANGE (P0 containment, T03, 2026-10-26 remediation) ===
Several assertions below were updated from their original form. The
ORIGINAL tests asserted that `historical_still_applicable=True` ALONE
(a blanket hand-authored flag on the whole corpus_ipc.py dataset, never
reviewed per-record by an authorized legal reviewer) was sufficient to
grant the "this old text still governs" framing and keep a hit out of the
cannot-verify gate. That is exactly the unapproved-release defect T03 was
opened to contain: a stored/source flag independently authorizing an
answer, with no reviewer identity, no record/hash binding, and no way to
fail closed if ever revoked. `engine/law_status_guard.py` now requires an
actual approval-evidence record (engine.approval_evidence.check_approval)
before granting that framing; the on-disk registry is intentionally EMPTY
(no approvals seeded), so by default these entries now get the STANDARD
dead-law warning instead — the same outcome as any other superseded
provision — until a legal reviewer actually approves a specific entry.
Tests below are split into "no approval" (new default, fails closed) and
"with a synthetic in-memory approval" (the original historical-notice
behaviour, now gated).
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from corpus_ipc import IPC_CRPC_CORPUS  # noqa: E402
from engine.law_status_guard import annotate_provisions  # noqa: E402
from engine.answer_generator import all_provisions_dead, _is_dead  # noqa: E402
from engine.approval_evidence import compute_content_hash  # noqa: E402
from corpus import with_historical_notice, public_citation  # noqa: E402


def _entry(key: str) -> dict:
    hit = next((e for e in IPC_CRPC_CORPUS if e["key"] == key), None)
    assert hit, f"fixture corpus entry {key!r} not found in corpus_ipc.py"
    return hit


# Approval now additionally requires an allowlisted reviewer (Emergent
# support fix 1). In-memory only; the real on-disk allowlist stays empty.
_TEST_ALLOWLIST = [{
    "reviewer_id": "test-reviewer-only-not-real",
    "name": "Synthetic test reviewer",
    "status": "active",
    "revoked_at": None,
    "added_at": "2026-10-28T00:00:00Z",
}]


def _synthetic_approval_for(entry: dict, reviewer_id: str = "test-reviewer-only-not-real") -> list:
    """Build an in-memory (never written to disk) approval record for test
    use only — exercises the approved path without ever creating a real
    approval in backend/data/approval_evidence_registry.json."""
    return [{
        "approval_id": f"TEST-{entry['key']}",
        "record_type": "historical_applicability",
        "subject_key": entry["key"],
        "content_hash": compute_content_hash(entry["official_text"]),
        "reviewer_id": reviewer_id,
        "status": "active",
    }]


class TestHistoricalCorpusEntriesAreTaggedAndNotMarkedDead:
    """corpus_ipc.py entries must all carry historical_still_applicable —
    this flag is necessary but, since T03, no longer SUFFICIENT on its own."""

    def test_all_entries_tagged(self):
        assert len(IPC_CRPC_CORPUS) > 0
        assert all(e.get("historical_still_applicable") is True for e in IPC_CRPC_CORPUS)

    def test_without_approval_entry_now_fails_closed_to_standard_dead_law(self):
        # T03 policy change: no approval exists for this entry (the real
        # on-disk registry is empty) -> must behave like any other
        # superseded provision, NOT get the special historical framing.
        hit = annotate_provisions([_entry("ipc_34")], source_tag="corpus")[0]
        assert hit.get("is_dead_law") is True, "without reviewer approval this must fail closed to standard dead-law treatment"
        assert hit.get("dead_warning")
        assert not hit.get("historical_notice"), "historical framing must not be granted without approval evidence"

    def test_with_valid_synthetic_approval_grants_historical_notice(self):
        entry = _entry("ipc_34")
        approval_registry = _synthetic_approval_for(entry)
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=approval_registry, authorized_reviewers=_TEST_ALLOWLIST)[0]
        assert not hit.get("is_dead_law"), "a genuinely approved historical entry must not be flagged dead_law"
        assert not (hit.get("status") or "").strip()
        assert hit.get("historical_notice"), "expected a historical framing notice to be attached"
        assert hit.get("_approval_reviewer") == "test-reviewer-only-not-real"

    def test_revoked_approval_also_fails_closed(self):
        entry = _entry("ipc_34")
        approval_registry = _synthetic_approval_for(entry)
        approval_registry[0]["status"] = "revoked"
        approval_registry[0]["revoked_at"] = "2026-10-27T00:00:00Z"
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=approval_registry, authorized_reviewers=_TEST_ALLOWLIST)[0]
        assert hit.get("is_dead_law") is True
        assert not hit.get("historical_notice")

    def test_hash_mismatched_approval_also_fails_closed(self):
        entry = _entry("ipc_34")
        approval_registry = _synthetic_approval_for(entry)
        approval_registry[0]["content_hash"] = "deadbeef" * 8  # wrong hash — text changed since approval
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=approval_registry, authorized_reviewers=_TEST_ALLOWLIST)[0]
        assert hit.get("is_dead_law") is True
        assert not hit.get("historical_notice")

    def test_malformed_approval_missing_reviewer_id_fails_closed(self):
        entry = _entry("ipc_34")
        approval_registry = _synthetic_approval_for(entry)
        approval_registry[0]["reviewer_id"] = ""  # malformed: no authorized reviewer identified
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=approval_registry, authorized_reviewers=_TEST_ALLOWLIST)[0]
        assert hit.get("is_dead_law") is True
        assert not hit.get("historical_notice")

    def test_annotate_preserves_original_official_text(self):
        original = _entry("ipc_34")
        hit = annotate_provisions([original], source_tag="corpus")[0]
        assert hit["official_text"] == original["official_text"], \
            "punishment/content text must remain byte-for-byte faithful to the source"


class TestAllProvisionsDeadDoesNotWronglyFireForHistoricalHit:
    """With a genuine, reviewer-approved historical hit, the single hit must
    NOT trigger the Layer M cannot-verify gate. Without approval (default),
    it now correctly DOES count as dead, same as any superseded provision."""

    def test_single_historical_hit_without_approval_is_now_all_dead(self):
        hit = annotate_provisions([_entry("ipc_34")], source_tag="corpus")[0]
        assert all_provisions_dead([hit]) is True

    def test_single_historical_hit_with_approval_is_not_all_dead(self):
        entry = _entry("ipc_34")
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry), authorized_reviewers=_TEST_ALLOWLIST)[0]
        assert all_provisions_dead([hit]) is False

    def test_is_dead_helper_says_alive_only_with_approval(self):
        entry = _entry("ipc_34")
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry), authorized_reviewers=_TEST_ALLOWLIST)[0]
        assert _is_dead(hit) is False

    def test_mixed_with_an_alive_db_hit_still_not_all_dead(self):
        entry = _entry("ipc_34")
        hist_hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry), authorized_reviewers=_TEST_ALLOWLIST)
        alive_db_hit = {"act": "BNS", "section": "199"}  # not in the dead registry
        combined = hist_hit + annotate_provisions([alive_db_hit], source_tag="db")
        assert all_provisions_dead(combined) is False

    def test_crpc_entry_without_approval_is_now_marked_dead(self):
        crpc_hits = [e for e in IPC_CRPC_CORPUS if e.get("act") == "CrPC"]
        assert crpc_hits, "expected at least one CrPC entry in corpus_ipc.py"
        hit = annotate_provisions([crpc_hits[0]], source_tag="corpus")[0]
        assert hit.get("is_dead_law") is True
        assert all_provisions_dead([hit]) is True

    def test_crpc_entry_with_approval_is_not_marked_dead(self):
        crpc_hits = [e for e in IPC_CRPC_CORPUS if e.get("act") == "CrPC"]
        entry = crpc_hits[0]
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry), authorized_reviewers=_TEST_ALLOWLIST)[0]
        assert not hit.get("is_dead_law")
        assert all_provisions_dead([hit]) is False


class TestRegressionDbBackedDeadRecordStillRefusedCorrectly:
    """Batch-1 behaviour (DB-backed dead records with no historical flag)
    must be completely unaffected by this fix."""

    def test_db_hit_without_historical_flag_is_still_marked_dead(self):
        db_hit = {"act": "IPC", "section": "166A"}  # plain DB-style dict, no historical flag
        hit = annotate_provisions([db_hit], source_tag="db")[0]
        assert hit.get("is_dead_law") is True
        assert hit.get("dead_warning")

    def test_all_provisions_dead_still_true_for_bare_db_dead_hit(self):
        db_hit = {"act": "IPC", "section": "166A"}
        hit = annotate_provisions([db_hit], source_tag="db")[0]
        assert all_provisions_dead([hit]) is True

    def test_historical_flag_set_false_behaves_like_before(self):
        db_hit = {"act": "IPC", "section": "166A", "historical_still_applicable": False}
        hit = annotate_provisions([db_hit], source_tag="db")[0]
        assert hit.get("is_dead_law") is True


class TestCitationCardShowsHistoricalFraming:
    """Item-1 'appropriate historical/current-law framing' for Python-corpus
    hits — previously public_citation() dropped dead_warning/historical
    framing entirely for these hits; with_historical_notice() now surfaces
    it directly in official_text (no frontend change required)."""

    def test_historical_notice_prepended_to_official_text(self):
        # Requires a valid synthetic approval (T03) — without one the
        # notice is not granted at all (see TestHistoricalCorpusEntries...
        # test_without_approval_entry_now_fails_closed_to_standard_dead_law).
        entry = _entry("ipc_34")
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry), authorized_reviewers=_TEST_ALLOWLIST)[0]
        cite = with_historical_notice(public_citation(hit), hit)
        assert cite["official_text"].startswith("Historical note:")
        assert "replaced by" in cite["official_text"]
        # Original verbatim text must still be present, unmodified, after the notice.
        assert entry["official_text"] in cite["official_text"]

    def test_no_notice_without_approval_even_though_flag_is_set(self):
        hit = annotate_provisions([_entry("ipc_34")], source_tag="corpus")[0]
        cite = with_historical_notice(public_citation(hit), hit)
        assert not cite.get("historical_notice")
        assert not cite["official_text"].startswith("Historical note:")

    def test_no_notice_prepended_for_a_live_non_dead_entry(self):
        live_entry = dict(_entry("ipc_34"))
        live_entry["key"] = "synthetic_live_test"
        cite_plain = public_citation(live_entry)  # never annotated -> no historical_notice key
        out = with_historical_notice(cite_plain, live_entry)
        assert out == cite_plain

    def test_with_historical_notice_does_not_mutate_inputs(self):
        entry = _entry("ipc_34")
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry), authorized_reviewers=_TEST_ALLOWLIST)[0]
        cite = public_citation(hit)
        original_text = cite["official_text"]
        with_historical_notice(cite, hit)
        assert cite["official_text"] == original_text, "must return a new dict, never mutate the citation in place"


class TestPunishmentTextFaithfulness:
    """'Generated punishment agrees with the retrieved statutory text' —
    for the corpus_ipc.py path this means the verbatim official_text is
    never altered/summarised by the historical-notice wrapping, for a
    sample of entries that do carry punishment clauses."""

    def test_ipc_entries_with_punishment_text_unchanged_after_annotation(self):
        punishment_entries = [
            e for e in IPC_CRPC_CORPUS
            if "punish" in e.get("official_text", "").lower() or "imprisonment" in e.get("official_text", "").lower()
        ]
        assert punishment_entries, "expected at least one IPC/CrPC entry with punishment text for this check"
        for e in punishment_entries[:10]:
            hit = annotate_provisions([e], source_tag="corpus")[0]
            assert hit["official_text"] == e["official_text"]
            cite = with_historical_notice(public_citation(hit), hit)
            # The verbatim punishment clause itself must appear unmodified inside the final citation text.
            assert e["official_text"] in cite["official_text"]
