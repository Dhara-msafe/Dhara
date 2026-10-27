"""
P0 containment test — T05 (DHARA-Team-Delivery-Tracker-2026-10-26.xlsx,
Batch A: "Gate every release surface ... fail closed consistently").

T03 gated the historical_still_applicable bypass inside
engine.law_status_guard.annotate_provisions() behind approval evidence.
These tests confirm that gate's effect PROPAGATES to the other named
output surfaces, which all read the SAME annotated fields rather than
re-deriving their own historical treatment from the raw corpus flag:

  * Layer M "cannot verify" gate (all_provisions_dead) — already covered
    directly in test_p1_historical_corpus_guard.py; re-asserted here
    alongside the prompt-guard surface for a single combined before/after
    picture of one hit going through both gates.
  * The SSE/chat-text prompt instruction (augment_prompt_with_status_guard)
    that is appended to the LLM prompt BEFORE the model generates the
    streamed reply — this is the actual "chat text and streamed SSE text"
    surface named in T05. It must warn the model off an unapproved
    "historical still applies" hit exactly as it would for any other dead
    law, and must NOT warn it off a genuinely approved one.

Correspondence-hypothesis hedging (build_bns_identifier_hypothesis_response)
and the /advocate/cross-reference verified-only boundary are ALREADY
covered by tests/test_p1_verified_only_boundary.py and
tests/test_p0a_ipc_bns_correction.py (0 of 999 mapping records claim
verified=True; hypothesis responses always hedge) — not duplicated here.

Direct unit tests against real production functions. No DB, no network,
no live server, no seeded approvals.
"""
from __future__ import annotations

import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from corpus_ipc import IPC_CRPC_CORPUS  # noqa: E402
from engine.law_status_guard import annotate_provisions  # noqa: E402
from engine.answer_generator import all_provisions_dead, augment_prompt_with_status_guard  # noqa: E402
from engine.approval_evidence import compute_content_hash  # noqa: E402


def _entry(key: str) -> dict:
    hit = next((e for e in IPC_CRPC_CORPUS if e["key"] == key), None)
    assert hit, f"fixture corpus entry {key!r} not found in corpus_ipc.py"
    return hit


def _synthetic_approval_for(entry: dict) -> list:
    return [{
        "approval_id": f"TEST-{entry['key']}",
        "record_type": "historical_applicability",
        "subject_key": entry["key"],
        "content_hash": compute_content_hash(entry["official_text"]),
        "reviewer_id": "test-reviewer-only-not-real",
        "status": "active",
    }]


class TestSsePromptGuardSurfaceInheritsApprovalGate:
    """The literal text instruction appended before the LLM streams its
    reply — this is what reaches the user as 'chat text / streamed SSE
    text' in T05's surface list."""

    def test_unapproved_historical_hit_gets_the_do_not_treat_as_enforceable_instruction(self):
        hit = annotate_provisions([_entry("ipc_34")], source_tag="corpus")[0]
        prompt = augment_prompt_with_status_guard("BASE PROMPT", [hit])
        assert "STATUS-GUARD NOTICE" in prompt
        assert "do NOT describe these as if they were currently enforceable" in prompt

    def test_approved_historical_hit_does_not_get_the_dead_law_instruction(self):
        entry = _entry("ipc_34")
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry))[0]
        prompt = augment_prompt_with_status_guard("BASE PROMPT", [hit])
        assert prompt == "BASE PROMPT", "an approved historical hit must not be instructed-against as dead law"


class TestLayerMGateInheritsApprovalGate:
    """Same two inputs, the other named surface — the deterministic
    'cannot verify' template that replaces the LLM call entirely when
    every surviving hit is dead."""

    def test_unapproved_hit_counts_as_dead_for_the_cannot_verify_gate(self):
        hit = annotate_provisions([_entry("ipc_34")], source_tag="corpus")[0]
        assert all_provisions_dead([hit]) is True

    def test_approved_hit_does_not_trigger_cannot_verify(self):
        entry = _entry("ipc_34")
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry))[0]
        assert all_provisions_dead([hit]) is False


class TestBothSurfacesAgreeForTheSameHit:
    """The prompt-guard surface and the Layer M gate must never disagree
    about the SAME hit — both derive from the identical annotated fields,
    so a hit can't slip through one gate while being blocked by the other."""

    def test_both_surfaces_agree_when_unapproved(self):
        hit = annotate_provisions([_entry("ipc_34")], source_tag="corpus")[0]
        warned_in_prompt = "STATUS-GUARD NOTICE" in augment_prompt_with_status_guard("P", [hit])
        counted_dead = all_provisions_dead([hit])
        assert warned_in_prompt is True and counted_dead is True

    def test_both_surfaces_agree_when_approved(self):
        entry = _entry("ipc_34")
        hit = annotate_provisions([entry], source_tag="corpus", approval_registry=_synthetic_approval_for(entry))[0]
        warned_in_prompt = "STATUS-GUARD NOTICE" in augment_prompt_with_status_guard("P", [hit])
        counted_dead = all_provisions_dead([hit])
        assert warned_in_prompt is False and counted_dead is False
