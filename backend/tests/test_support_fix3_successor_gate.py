"""Emergent support fix 3: successor / correspondence statements on the chat
path are released only with an approved relationship. Every test calls the
real production function. Approvals are injected in memory only.
"""
import json
import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")

import engine.approval_evidence as ae  # noqa: E402
import engine.correspondence_gate as cg  # noqa: E402
from api import chat_router  # noqa: E402
from engine.answer_generator import (  # noqa: E402
    augment_prompt_with_exact_dead_citation_lock,
    build_bns_identifier_hypothesis_response,
    build_cannot_verify_response,
    recheck_dead_with_successor_release,
)

REVIEWER = {"reviewer_id": "adv.synthetic.lead", "name": "Synthetic", "status": "active",
            "revoked_at": None, "added_at": "2026-10-28T00:00:00Z"}

DEAD_166A = {
    "act_name": "Indian Penal Code", "section_number": "166A",
    "section_heading": "Public servant disobeying direction under law",
    "section_text": "Whoever, being a public servant, knowingly disobeys any direction of the law ...",
    "is_dead_law": True, "status": "SUPERSEDED",
    "dead_warning": "This section has been omitted or repealed.",
    "successor_act": "Bharatiya Nyaya Sanhita, Section 199",
    "jurisdiction": "CENTRAL",
}
BNS_199 = {"act_name": "Bharatiya Nyaya Sanhita", "section_number": "199", "is_dead_law": False}
BNS_200 = {"act_name": "Bharatiya Nyaya Sanhita", "section_number": "200", "is_dead_law": False}


def _entry_166a():
    return next(e for e in cg._iter_entries() if str(e.get("ipc_section")) == "166A" and e.get("bns_section"))


def _approval_166a():
    e = _entry_166a()
    return [{"approval_id": "T-166A", "record_type": "correspondence", "subject_key": cg.entry_subject_key(e),
             "content_hash": cg.entry_content_hash(e), "reviewer_id": REVIEWER["reviewer_id"], "status": "active"}]


@pytest.fixture
def approved(monkeypatch):
    monkeypatch.setattr(ae, "_load_registry", lambda: _approval_166a())
    monkeypatch.setattr(ae, "_load_authorized_reviewers", lambda: [REVIEWER])


@pytest.fixture
def approval_without_reviewer(monkeypatch):
    monkeypatch.setattr(ae, "_load_registry", lambda: _approval_166a())
    monkeypatch.setattr(ae, "_load_authorized_reviewers", lambda: [])


def _active_ref():
    ref = {"act": "Indian Penal Code", "section": "166A"}
    assert recheck_dead_with_successor_release(ref, [dict(DEAD_166A)], chat_router._LEGACY_TO_SUCCESSOR_FAMILY)
    return ref


def test_mapping_entry_binds_ipc_166a_to_bns_199():
    assert cg.entry_subject_key(_entry_166a()) == "IPC:166A->BNS:199"


# (a) LLM context line
class TestContextLine:
    def test_unapproved_omits_successor_line(self):
        block = chat_router._db_hit_context_block(dict(DEAD_166A))
        assert "Successor provision" not in block and "199" not in block
        assert "SAFETY WARNING (DEAD LAW)" in block  # existing dead-law wording kept

    def test_unlisted_reviewer_omits_successor_line(self, approval_without_reviewer):
        assert "199" not in chat_router._db_hit_context_block(dict(DEAD_166A))

    def test_approved_emits_successor_line(self, approved):
        assert "Successor provision: Bharatiya Nyaya Sanhita, Section 199" in chat_router._db_hit_context_block(dict(DEAD_166A))


# (b) citation card
class TestCitationCard:
    def test_unapproved_card_withholds_successor(self):
        payload = chat_router._db_hit_citation_payload(dict(DEAD_166A))
        assert payload["citation"]["successor_act"] is None
        assert payload["citation"]["successor_withheld"] is True

    def test_approved_card_keeps_successor(self, approved):
        payload = chat_router._db_hit_citation_payload(dict(DEAD_166A))
        assert payload["citation"]["successor_act"] == "Bharatiya Nyaya Sanhita, Section 199"
        assert "successor_withheld" not in payload["citation"]


# (c) successor-family hit acceptance
class TestSuccessorFamilyAcceptance:
    def test_unapproved_rejects_bns_199_hit(self):
        assert chat_router._successor_family_hit_supports_ref(_active_ref(), BNS_199) is False

    def test_approved_accepts_only_the_approved_successor_section(self, approved):
        ref = _active_ref()
        assert chat_router._successor_family_hit_supports_ref(ref, BNS_199) is True
        assert chat_router._successor_family_hit_supports_ref(ref, BNS_200) is False


# (d) exact-dead-citation lock + BNS identifier hypothesis
class TestPromptLockAndHypothesis:
    def test_lock_default_forbids_naming_successor(self):
        out = augment_prompt_with_exact_dead_citation_lock("BASE")
        assert "do NOT name or guess any successor section number" in out
        assert "name its successor" not in out

    def test_lock_wired_to_active_ref_approval(self, approved):
        assert chat_router._active_ref_successor_approved(_active_ref()) is True
        assert "name its successor" in augment_prompt_with_exact_dead_citation_lock("BASE", successor_approved=True)

    def test_active_ref_unapproved(self):
        assert chat_router._active_ref_successor_approved(_active_ref()) is False

    def test_hypothesis_unapproved_names_no_successor(self):
        text = build_bns_identifier_hypothesis_response("Bharatiya Nyaya Sanhita", "166A", {"bns_section": "199"})
        assert "199" not in text and "licensed advocate" in text

    def test_hypothesis_approved_names_successor(self):
        text = build_bns_identifier_hypothesis_response(
            "Bharatiya Nyaya Sanhita", "166A", {"bns_section": "199"},
            registry=_approval_166a(), authorized_reviewers=[REVIEWER],
        )
        assert "BNS Section 199" in text


# (e) cannot-verify fallback text
class TestCannotVerifyFallback:
    def test_unapproved_fallback_names_no_successor_section(self):
        assert "199" not in build_cannot_verify_response(None, dead_hits=[dict(DEAD_166A)])

    def test_approved_fallback_names_successor(self, approved):
        assert "199" in build_cannot_verify_response(None, dead_hits=[dict(DEAD_166A)])


# Streamed output: what event_gen emits for a dead section with a successor.
class TestEmittedStreamHasNoSuccessorWithoutApproval:
    def test_no_successor_number_in_any_emitted_frame_or_llm_context(self):
        hits = [dict(DEAD_166A)]
        ref = {"act": "Indian Penal Code", "section": "166A"}
        recheck_dead_with_successor_release(ref, hits, chat_router._LEGACY_TO_SUCCESSOR_FAMILY)
        # citation frames exactly as event_gen builds and encodes them
        frames = [
            f"data: {json.dumps(chat_router._db_hit_citation_payload(h), ensure_ascii=False)}\n\n" for h in hits
        ]
        # the refusal/fallback delta frame (Layer M cannot-verify text)
        frames.append(f"data: {json.dumps({'type': 'delta', 'content': build_cannot_verify_response(None, dead_hits=hits)}, ensure_ascii=False)}\n\n")
        # the system-prompt material the LLM would stream from
        llm_context = augment_prompt_with_exact_dead_citation_lock(
            chat_router._db_hit_context_block(hits[0]),
            successor_approved=chat_router._active_ref_successor_approved(ref),
        )
        for chunk in frames + [llm_context]:
            assert "199" not in chunk, chunk[:200]
