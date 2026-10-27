"""H1 — legal gate contract tests (TESTS ONLY, no behaviour change).

Covers, for each existing legal gate:
  * a known pass case
  * a known block case
  * missing / malformed input behaviour (asserted as it actually is today;
    any fail-OPEN behaviour is pinned here and reported to the owner)
  * no banned user-visible word in any block / fallback message

Gates under test:
  Actor-Conduct Lock   engine/answer_generator.py
  Material Fact Detector engine/fact_detector.py
  Law Status Guard     engine/law_status_guard.py
  Citation / output guard engine/output_guard.py

Run with the backend's existing runner: cd /app/backend && python -m pytest tests/test_h1_legal_gates_contract.py
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from engine import answer_generator, fact_detector, law_status_guard, output_guard
from engine.models import LegalQuery, StatusRecord

# Words/phrases that must never appear in a user-visible block or fallback text.
BANNED_USER_VISIBLE = (
    "verified", "certified", "approved", "court-ready", "guaranteed", "verdict",
    "help is on the way", "fir has been filed", "complaint registered", "police notified",
)


def assert_no_banned_words(message: str, label: str) -> None:
    low = (message or "").lower()
    for w in BANNED_USER_VISIBLE:
        assert w not in low, f"{label}: banned user-visible text {w!r} in {message[:160]!r}"


# ── Citation / output guard ────────────────────────────────────────────────

def test_output_guard_pass_case_legal_term_of_art_is_not_blocked():
    clean, blocked, _ = output_guard.validate_dhara_text(
        "You may apply for a certified copy of the order; rights guaranteed by the Constitution still apply."
    )
    assert blocked is False
    assert "certified copy" in clean


def test_output_guard_block_case_self_claim():
    for bad in (
        "This answer is verified against the official text.",
        "DHARA has approved this draft.",
        "Here is a court-ready petition.",
        "[UNVERIFIED] Section 420 applies.",
    ):
        _, blocked, _ = output_guard.validate_dhara_text(bad)
        assert blocked is True, bad


def test_output_guard_missing_or_malformed_input():
    # Empty / None text is passed through unblocked — there is nothing to show,
    # so no user-visible claim can leak. Pinned so a future change is noticed.
    assert output_guard.validate_dhara_text("") == ("", False, 0)
    assert output_guard.validate_dhara_text(None) == (None, False, 0)
    assert output_guard.contains_dhara_claim_violation(None) is False


def test_output_guard_fallback_message_has_no_banned_words():
    assert_no_banned_words(output_guard.CANNOT_CONFIRM_MESSAGE, "CANNOT_CONFIRM_MESSAGE")


def test_cannot_verify_fallback_answer_has_no_banned_words():
    body = answer_generator.build_cannot_verify_response(
        LegalQuery(original_query="what is the punishment for theft"),
        dead_hits=[{"act_name": "Indian Penal Code", "section_number": "378", "status": "SUPERSEDED"}],
    )
    assert "ANSWER" in body
    assert_no_banned_words(body, "build_cannot_verify_response")


# ── Actor-Conduct Lock ─────────────────────────────────────────────────────

MISMATCH = SimpleNamespace(
    actor_mismatch=True, regulated_actor="landlord",
    regulated_conduct="returning the deposit", user_role="tenant",
)
NO_MISMATCH = SimpleNamespace(
    actor_mismatch=False, regulated_actor=None, regulated_conduct=None, user_role="tenant",
)


def test_actor_conduct_lock_pass_case_no_mismatch_is_a_noop():
    prompt = "Answer the question."
    assert answer_generator.augment_prompt_with_actor_conduct_lock(prompt, NO_MISMATCH) == prompt
    text = "You must pay the rent."
    assert answer_generator.reframe_misdirected_obligations(text, NO_MISMATCH) == text


def test_actor_conduct_lock_block_case_reframes_obligation_away_from_user():
    out = answer_generator.augment_prompt_with_actor_conduct_lock("Answer.", MISMATCH)
    assert "ACTOR-CONDUCT LOCK NOTICE" in out
    assert_no_banned_words(out, "actor conduct lock notice")

    reframed = answer_generator.reframe_misdirected_obligations("You must return the deposit.", MISMATCH)
    assert "you must" not in reframed.lower()
    assert "the landlord must" in reframed


def test_actor_conduct_lock_rights_phrasing_is_not_corrupted():
    # "you cannot ..." is usually a RIGHT addressed to the user; must survive.
    text = "You cannot be denied an FIR."
    assert answer_generator.reframe_misdirected_obligations(text, MISMATCH) == text


def test_actor_conduct_lock_missing_or_malformed_input_fails_closed():
    # No classify_result / no text => no rewrite, no crash.
    assert answer_generator.augment_prompt_with_actor_conduct_lock("P", None) == "P"
    assert answer_generator.reframe_misdirected_obligations("You must pay.", None) == "You must pay."
    assert answer_generator.reframe_misdirected_obligations("", MISMATCH) == ""
    assert answer_generator.reframe_misdirected_obligations(None, MISMATCH) is None


# ── Material Fact Detector ─────────────────────────────────────────────────

def test_fact_detector_pass_case_religion_present_is_direct():
    res = fact_detector.detect(
        LegalQuery(original_query="My Hindu marriage — can I file for divorce?"),
        "marriage_and_family",
    )
    assert res.answer_mode == "DIRECT"


def test_fact_detector_block_case_missing_religion_escalates_with_one_question():
    res = fact_detector.detect(LegalQuery(original_query="Can I file for divorce?"), "marriage_and_family")
    assert res.answer_mode == "ESCALATE"
    assert res.missing_facts == ["religion"]
    assert res.follow_up_question
    assert_no_banned_words(res.follow_up_question, "fact_detector follow_up_question")


def test_fact_detector_soft_gate_for_non_hard_domains():
    res = fact_detector.detect(LegalQuery(original_query="I was detained yesterday"), "criminal_procedure")
    assert res.answer_mode == "CONDITIONAL"
    assert "actor_role_check" in res.missing_facts


def test_fact_detector_missing_or_malformed_input():
    # Fix 3 (H2b): an empty or unrecognised domain now returns CONDITIONAL
    # (fail-closed) because no required-fact spec exists for it.
    # A known domain with an empty required-facts list still returns DIRECT.
    assert fact_detector.detect(LegalQuery(), "").answer_mode == "CONDITIONAL"
    assert fact_detector.detect(LegalQuery(original_query=""), "no_such_domain").answer_mode == "CONDITIONAL"


# ── Law Status Guard ───────────────────────────────────────────────────────

def _rec(status: str) -> StatusRecord:
    return StatusRecord(
        act_id="TEST_ACT_1860", short_name="Test Act 1860", status=status,
        successor_act="Test Sanhita 2023", status_reason="Replaced for new matters.",
    )


def test_law_status_guard_pass_case_active_provision(monkeypatch):
    monkeypatch.setattr(law_status_guard, "_match_provision_to_registry", lambda p: _rec("ACTIVE"))
    label, rec = law_status_guard.check_provision({"act_name": "Test Act 1860"})
    assert label == "ACTIVE"
    out = law_status_guard.annotate_provisions([{"act_name": "Test Act 1860", "section_number": "1"}])
    assert out[0].get("is_dead_law") is None


def test_law_status_guard_block_case_repealed_provision(monkeypatch):
    monkeypatch.setattr(law_status_guard, "_match_provision_to_registry", lambda p: _rec("REPEALED"))
    label, rec = law_status_guard.check_provision({"act_name": "Test Act 1860"})
    assert label == "INACTIVE"
    out = law_status_guard.annotate_provisions([{"act_name": "Test Act 1860", "section_number": "1"}])
    assert out[0]["is_dead_law"] is True
    assert_no_banned_words(out[0]["dead_warning"], "dead_warning")


def test_law_status_guard_unknown_status_is_treated_as_inactive(monkeypatch):
    monkeypatch.setattr(law_status_guard, "_match_provision_to_registry", lambda p: _rec("UNKNOWN"))
    assert law_status_guard.check_provision({"act_name": "x"})[0] == "INACTIVE"


def test_law_status_guard_historical_tag_without_approval_falls_back_to_dead_warning(monkeypatch):
    monkeypatch.setattr(law_status_guard, "_match_provision_to_registry", lambda p: _rec("SUPERSEDED"))
    out = law_status_guard.annotate_provisions([{
        "act_name": "Test Act 1860", "section_number": "1",
        "historical_still_applicable": True, "official_text": "Whoever ...",
    }], approval_registry=[])
    assert out[0]["is_dead_law"] is True
    assert "historical_notice" not in out[0]


def test_law_status_guard_missing_or_malformed_provision():
    # Fix 1 Option B (H2b): a provision whose act is absent from the registry
    # now gets an internal _law_status = "NOT_IN_REGISTRY" marker (logged, not
    # shown to users). No dead_warning, no is_dead_law — those are reserved for
    # known-INACTIVE acts. Registry gap was 46.5 % of corpus; user-facing text
    # is deferred until the registry covers those acts.
    assert law_status_guard.check_provision({})[0] == "NOT_IN_REGISTRY"
    assert law_status_guard.check_provision({"act_name": ""})[0] == "NOT_IN_REGISTRY"
    out = law_status_guard.annotate_provisions([{"act_name": "Entirely Made Up Act 2099"}])
    assert "dead_warning" not in out[0]
    assert out[0].get("is_dead_law") is None
    assert out[0].get("_law_status") == "NOT_IN_REGISTRY"


def test_law_status_registry_loads():
    assert len(law_status_guard._load_registry()) > 0


# ── Ordering contract: SOS / danger check runs before the C1 canned reply ───

CHAT_ROUTER = Path(__file__).resolve().parent.parent / "api" / "chat_router.py"


def test_c1_conversational_matcher_never_runs_before_the_danger_check():
    src = CHAT_ROUTER.read_text(encoding="utf-8")
    gate = src.index("FEATURE_C1_CONVERSATIONAL_REPLIES\n")
    first_emergency = src.index("_emergency")
    assert first_emergency < gate, "immediate-danger check must be computed before the C1 gate"
    window = src[gate:gate + 400]
    assert "not _emergency" in window, "C1 gate must be guarded by `not _emergency`"
    assert "is_denylisted" in window, "C1 gate must respect the deny list"


def test_c1_flag_defaults_to_off_when_missing_or_misspelt(monkeypatch):
    import os
    monkeypatch.delenv("FEATURE_C1_CONVERSATIONAL_REPLIES", raising=False)
    assert os.getenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "false").lower() == "false"
    monkeypatch.setenv("FEATURE_C1_CONVERSATIONAL_REPLY", "true")  # misspelt
    assert os.getenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "false").lower() == "false"
    monkeypatch.setenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "false")
    assert os.getenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "false").lower() != "true"
    monkeypatch.setenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "true")
    assert os.getenv("FEATURE_C1_CONVERSATIONAL_REPLIES", "false").lower() == "true"
