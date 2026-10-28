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
    # now gets an internal _law_status = "NOT_IN_REGISTRY" marker.
    # Graduate Fix 1: central NOT_IN_REGISTRY provisions also get a soft
    # registry_gap_note (NOT dead_warning — that is reserved for INACTIVE acts).
    assert law_status_guard.check_provision({})[0] == "NOT_IN_REGISTRY"
    assert law_status_guard.check_provision({"act_name": ""})[0] == "NOT_IN_REGISTRY"
    out = law_status_guard.annotate_provisions([{"act_name": "Entirely Made Up Act 2099"}])
    # dead_warning and is_dead_law are strictly reserved for INACTIVE acts
    assert "dead_warning" not in out[0]
    assert out[0].get("is_dead_law") is None
    assert out[0].get("_law_status") == "NOT_IN_REGISTRY"
    # Graduate Fix 1: soft caution must be present for named central acts
    assert "registry_gap_note" in out[0], \
        "NOT_IN_REGISTRY central act must receive a soft registry_gap_note (Graduate Fix 1)"
    note = out[0]["registry_gap_note"]
    assert "Entirely Made Up Act 2099" in note, \
        f"registry_gap_note must cite the act name; got: {note!r}"
    # Provisions with no act name must NOT get a registry_gap_note (nothing to cite)
    no_act_out = law_status_guard.annotate_provisions([{"act_name": ""}])
    assert "registry_gap_note" not in no_act_out[0], \
        "Provision with empty act_name must not get a registry_gap_note"


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


# ── H3 Phase 2 tests ────────────────────────────────────────────────────────

def _fresh_registry():
    """Clear the lru_cache so each test sees the real file on disk."""
    import engine.law_status_guard as lsg
    lsg._load_registry.cache_clear()
    return lsg._load_registry()


def test_h3_new_active_acts_pass_with_no_dead_warning():
    """Newly added ACTIVE acts must reach check_provision as ACTIVE, no dead_warning."""
    import engine.law_status_guard as lsg
    lsg._load_registry.cache_clear()
    for corpus_label, expected_id in [
        ("MV",                    "MVA_1988"),
        ("RTI",                   "RTI_2005"),
        ("PWDVA",                 "PWDVA_2005"),
        ("CPA",                   "CPA_2019"),
        ("Code on Wages",         "COW_2019"),
        ("Industrial Relations Code", "IRC_2020"),
        # duplicate corpus labels
        ("Right to Information Act",  "RTI_2005"),
        ("Consumer Protection Act",   "CPA_2019"),
    ]:
        status, rec = lsg.check_provision({"act": corpus_label})
        assert status == "ACTIVE", f"{corpus_label!r}: expected ACTIVE, got {status!r}"
        assert rec is not None, f"{corpus_label!r}: expected a StatusRecord"
        assert rec.act_id == expected_id, f"{corpus_label!r}: expected act_id {expected_id!r}, got {rec.act_id!r}"
    # Annotate a sample MV provision — must carry no dead_warning
    out = lsg.annotate_provisions([{"act": "MV", "key": "mv_129"}])
    assert "dead_warning" not in out[0], "ACTIVE MV provision must not have dead_warning"
    assert out[0].get("_law_status") == "ACTIVE"


def test_h3_state_act_provisions_get_state_not_checked():
    """State-jurisdiction provisions must be marked STATE_NOT_CHECKED, not NOT_IN_REGISTRY."""
    import engine.law_status_guard as lsg
    lsg._load_registry.cache_clear()
    state_prov = {"act": "Delhi Rent Control Act", "state": "DL", "key": "dl_rent_14"}
    out = lsg.annotate_provisions([state_prov])
    assert out[0].get("_law_status") == "STATE_NOT_CHECKED", \
        f"Expected STATE_NOT_CHECKED, got {out[0].get('_law_status')!r}"
    assert "dead_warning" not in out[0]


def test_h3_central_unregistered_act_still_not_in_registry():
    """An Act absent from the registry must stay NOT_IN_REGISTRY after H4 expansion.

    NOTE: The Negotiable Instruments Act 1881 was previously used here but was
    added to the registry in H4 Phase 1.  Use an act that is intentionally
    absent (Waqf Act, 1995) to keep the test meaningful.
    """
    import engine.law_status_guard as lsg
    lsg._load_registry.cache_clear()
    status, rec = lsg.check_provision({"act": "Waqf Act, 1995"})
    assert status == "NOT_IN_REGISTRY"
    assert rec is None
    out = lsg.annotate_provisions([{"act": "Waqf Act, 1995", "key": "waqf_40"}])
    assert out[0].get("_law_status") == "NOT_IN_REGISTRY"
    assert "dead_warning" not in out[0]
    # Graduate Fix 1: soft caution must now be present
    assert "registry_gap_note" in out[0], \
        "Central unregistered act must carry registry_gap_note (Graduate Fix 1)"


def test_h3_loader_rejects_blank_source_url(tmp_path, monkeypatch):
    """A registry entry with blank source_url must be skipped by the loader."""
    import json, engine.law_status_guard as lsg
    bad_registry = {
        "registry": [{
            "act_id": "FAKE_ACT_9999",
            "short_name": "Fake Act, 9999",
            "status": "ACTIVE",
            "source_url": "",          # blank — must be rejected
            "source_type": "UNKNOWN",
            "verified_at": "2026-01-01",
            "status_reason": "Test entry with blank source_url",
        }]
    }
    fake_path = tmp_path / "fake_registry.json"
    fake_path.write_text(json.dumps(bad_registry))
    monkeypatch.setattr(lsg, "_REGISTRY_PATH", fake_path)
    lsg._load_registry.cache_clear()
    reg = lsg._load_registry()
    assert "FAKE_ACT_9999" not in reg, \
        "Entry with blank source_url must be rejected by the loader check"
    lsg._load_registry.cache_clear()


def test_h3_new_entries_carry_checked_by_and_review_status():
    """All six H3 entries must have non-empty checked_by and review_status."""
    import engine.law_status_guard as lsg
    lsg._load_registry.cache_clear()
    reg = lsg._load_registry()
    for act_id in ("MVA_1988", "RTI_2005", "PWDVA_2005", "CPA_2019", "COW_2019", "IRC_2020"):
        rec = reg.get(act_id.upper())
        assert rec is not None, f"{act_id} missing from registry"
        assert rec.checked_by, f"{act_id} has blank checked_by"
        assert rec.review_status, f"{act_id} has blank review_status"
    lsg._load_registry.cache_clear()


# ── Matcher Fix tests — whole-word + year-aware (no false positives) ─────────

def _clear_registry():
    """Clear the lru_cache so each test sees a fresh registry."""
    import engine.law_status_guard as lsg
    lsg._load_registry.cache_clear()


class TestMatcherWholeWordFalsePositives:
    """'RTI' must NOT match acts that merely contain 'rti' inside a word."""

    def test_partition_of_revenue_paying_estates_not_matched_to_rti(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision(
            {"act_name": "Partition of Revenue-paying Estates Act"}
        )
        assert status == "NOT_IN_REGISTRY", (
            f"'RTI' substring inside 'paRTItion' must not produce a match; got {status!r}"
        )
        assert rec is None

    def test_martin_luther_christian_university_not_matched_to_rti(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision(
            {"act_name": "Martin Luther Christian University Act"}
        )
        assert status == "NOT_IN_REGISTRY", (
            f"'RTI' substring inside 'maRTIn' must not produce a match; got {status!r}"
        )
        assert rec is None

    def test_artillery_practice_acts_not_matched_to_rti(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision(
            {"act_name": "Artillery Practice Act"}
        )
        assert status == "NOT_IN_REGISTRY", (
            f"'RTI' substring inside 'aRTIllery' must not produce a match; got {status!r}"
        )
        assert rec is None


class TestMatcherYearAwareFalsePositives:
    """Year-specific acts must NOT match corpus acts from a different era."""

    def test_state_motor_vehicles_taxation_act_1958_not_matched_to_mva_1988(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision(
            {"act_name": "Motor Vehicles Taxation Act, 1958"}
        )
        assert status == "NOT_IN_REGISTRY", (
            f"Year 1958 ≠ MVA_1988 canonical year 1988; should be NOT_IN_REGISTRY, got {status!r}"
        )
        assert rec is None

    def test_telangana_places_of_worship_act_1997_not_matched_to_pow_1991(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision(
            {"act_name": "Telangana Places of Worship Act, 1997"}
        )
        assert status == "NOT_IN_REGISTRY", (
            f"Year 1997 ≠ PLACES_OF_WORSHIP_1991 canonical year 1991; "
            f"should be NOT_IN_REGISTRY, got {status!r}"
        )
        assert rec is None

    def test_consumer_protection_act_1986_not_matched_to_cpa_2019(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision(
            {"act_name": "Consumer Protection Act, 1986"}
        )
        assert status == "NOT_IN_REGISTRY", (
            f"Year 1986 ≠ CPA_2019 canonical year 2019; should be NOT_IN_REGISTRY, got {status!r}"
        )
        assert rec is None

    def test_motor_vehicles_act_1939_not_matched_to_mva_1988(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision(
            {"act_name": "Motor Vehicles Act, 1939"}
        )
        assert status == "NOT_IN_REGISTRY", (
            f"Year 1939 ≠ MVA_1988 canonical year 1988; should be NOT_IN_REGISTRY, got {status!r}"
        )
        assert rec is None


class TestMatcherPositiveRegressions:
    """Valid aliases must still resolve correctly after the fix."""

    def test_rti_short_code_still_matches_rti_2005(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "RTI"})
        assert status == "ACTIVE", f"Short alias 'RTI' should match RTI_2005; got {status!r}"
        assert rec is not None and rec.act_id == "RTI_2005"

    def test_rti_act_2005_still_matches_rti_2005(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "RTI ACT 2005"})
        assert status == "ACTIVE", f"'RTI ACT 2005' should match RTI_2005; got {status!r}"
        assert rec is not None and rec.act_id == "RTI_2005"

    def test_right_to_information_act_still_matches_rti_2005(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "Right to Information Act"})
        assert status == "ACTIVE", f"Long alias should match RTI_2005; got {status!r}"
        assert rec is not None and rec.act_id == "RTI_2005"

    def test_motor_vehicles_act_1988_still_matches_mva_1988(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "Motor Vehicles Act, 1988"})
        assert status == "ACTIVE", f"MVA 1988 should still match MVA_1988; got {status!r}"
        assert rec is not None and rec.act_id == "MVA_1988"

    def test_mv_short_code_still_matches_mva_1988(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "MV"})
        assert status == "ACTIVE", f"Short alias 'MV' should match MVA_1988; got {status!r}"
        assert rec is not None and rec.act_id == "MVA_1988"

    def test_consumer_protection_act_2019_still_matches_cpa_2019(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "Consumer Protection Act, 2019"})
        assert status == "ACTIVE", f"CPA 2019 should still match CPA_2019; got {status!r}"
        assert rec is not None and rec.act_id == "CPA_2019"

    def test_cpa_short_code_still_matches_cpa_2019(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "CPA"})
        assert status == "ACTIVE", f"Short alias 'CPA' should match CPA_2019; got {status!r}"
        assert rec is not None and rec.act_id == "CPA_2019"

    def test_longer_alias_wins_over_shorter_for_same_act(self):
        """'MOTOR VEHICLES ACT' (18 chars) beats 'MOTOR VEHICLES' (14 chars) — same act_id ✓."""
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "Motor Vehicles Act, 1988"})
        assert status == "ACTIVE"
        assert rec is not None and rec.act_id == "MVA_1988"

    def test_ipc_short_code_still_matches_ipc_1860(self):
        _clear_registry()
        status, rec = law_status_guard.check_provision({"act": "IPC"})
        assert status in ("INACTIVE", "SUPERSEDED", "ACTIVE"), \
            f"IPC must produce a registry match; got {status!r}"
        assert rec is not None and rec.act_id == "IPC_1860"



# ── H4 Phase 1 tests — NI 1881, IT 2000, POCSO 2012, PMLA 2002 ───────────────

class TestH4RegistryExpansion:
    """H4 Phase 1: four new central Acts must be in the registry and resolve correctly."""

    def setup_method(self):
        import engine.law_status_guard as lsg
        lsg._load_registry.cache_clear()

    def teardown_method(self):
        import engine.law_status_guard as lsg
        lsg._load_registry.cache_clear()

    # ── NI Act 1881 ────────────────────────────────────────────────────────────

    def test_ni_short_code_matches_ni_1881(self):
        status, rec = law_status_guard.check_provision({"act": "NI"})
        assert status == "ACTIVE", f"Short alias 'NI' must match NI_1881; got {status!r}"
        assert rec is not None and rec.act_id == "NI_1881"

    def test_negotiable_instruments_act_long_form_matches(self):
        status, rec = law_status_guard.check_provision(
            {"act": "Negotiable Instruments Act, 1881"}
        )
        assert status == "ACTIVE", \
            f"'Negotiable Instruments Act, 1881' must match NI_1881; got {status!r}"
        assert rec is not None and rec.act_id == "NI_1881"

    def test_ni_section_138_provision_has_no_dead_warning(self):
        """NI Act is ACTIVE — s.138 provisions must not carry dead_warning."""
        out = law_status_guard.annotate_provisions([{"act": "NI", "key": "ni_138"}])
        assert out[0].get("_law_status") == "ACTIVE"
        assert "dead_warning" not in out[0]
        assert "registry_gap_note" not in out[0], \
            "ACTIVE NI provisions must NOT have registry_gap_note"

    def test_ni_act_1961_not_matched_to_ni_1881_year_guard(self):
        """Year guard: hypothetical NI Act 1961 must not map to NI_1881."""
        status, rec = law_status_guard.check_provision(
            {"act": "Negotiable Instruments Act, 1961"}
        )
        assert status == "NOT_IN_REGISTRY", \
            f"Year 1961 ≠ NI_1881 canonical year 1881; got {status!r}"

    # ── IT Act 2000 (PARTIALLY_ACTIVE) ────────────────────────────────────────

    def test_information_technology_act_matches_it_2000(self):
        status, rec = law_status_guard.check_provision(
            {"act": "Information Technology Act, 2000"}
        )
        assert status == "WARN", \
            f"IT_2000 is PARTIALLY_ACTIVE so should land in WARN; got {status!r}"
        assert rec is not None and rec.act_id == "IT_2000"

    def test_it_2000_provision_carries_warn_dead_warning(self):
        """PARTIALLY_ACTIVE IT Act must carry a dead_warning (WARN path)."""
        out = law_status_guard.annotate_provisions(
            [{"act": "Information Technology Act", "key": "it_66a"}]
        )
        assert out[0].get("_law_status") == "PARTIALLY_ACTIVE"
        assert "dead_warning" in out[0], \
            "PARTIALLY_ACTIVE IT Act provision must carry dead_warning via WARN path"
        warn = out[0]["dead_warning"]
        assert "66A" in warn or "PARTIALLY" in warn or "status" in warn.lower(), \
            f"dead_warning must mention the partial status; got: {warn!r}"

    def test_it_act_1999_not_matched_to_it_2000_year_guard(self):
        """Year guard: IT Act 1999 (hypothetical) must not map to IT_2000."""
        status, rec = law_status_guard.check_provision(
            {"act": "Information Technology Act, 1999"}
        )
        assert status == "NOT_IN_REGISTRY", \
            f"Year 1999 ≠ IT_2000 canonical year 2000; got {status!r}"

    # ── POCSO Act 2012 ─────────────────────────────────────────────────────────

    def test_pocso_short_code_matches_pocso_2012(self):
        status, rec = law_status_guard.check_provision({"act": "POCSO"})
        assert status == "ACTIVE", f"Short alias 'POCSO' must match POCSO_2012; got {status!r}"
        assert rec is not None and rec.act_id == "POCSO_2012"

    def test_pocso_full_name_matches(self):
        status, rec = law_status_guard.check_provision(
            {"act": "Protection of Children from Sexual Offences Act, 2012"}
        )
        assert status == "ACTIVE", \
            f"Long form POCSO must match POCSO_2012; got {status!r}"
        assert rec is not None and rec.act_id == "POCSO_2012"

    def test_pocso_provision_has_no_dead_warning(self):
        out = law_status_guard.annotate_provisions([{"act": "POCSO", "key": "pocso_4"}])
        assert out[0].get("_law_status") == "ACTIVE"
        assert "dead_warning" not in out[0]
        assert "registry_gap_note" not in out[0]

    # ── PMLA Act 2002 ──────────────────────────────────────────────────────────

    def test_pmla_short_code_matches_pmla_2002(self):
        status, rec = law_status_guard.check_provision({"act": "PMLA"})
        assert status == "ACTIVE", f"Short alias 'PMLA' must match PMLA_2002; got {status!r}"
        assert rec is not None and rec.act_id == "PMLA_2002"

    def test_prevention_of_money_laundering_act_matches(self):
        status, rec = law_status_guard.check_provision(
            {"act": "Prevention of Money Laundering Act, 2002"}
        )
        assert status == "ACTIVE", \
            f"Long form PMLA must match PMLA_2002; got {status!r}"
        assert rec is not None and rec.act_id == "PMLA_2002"

    def test_pmla_provision_has_no_dead_warning(self):
        out = law_status_guard.annotate_provisions([{"act": "PMLA", "key": "pmla_3"}])
        assert out[0].get("_law_status") == "ACTIVE"
        assert "dead_warning" not in out[0]
        assert "registry_gap_note" not in out[0]

    # ── Graduate Fix 1: STATE_NOT_CHECKED must still not get registry_gap_note ─

    def test_state_not_checked_has_no_registry_gap_note(self):
        """State provisions must not receive registry_gap_note — only central NOT_IN_REGISTRY ones."""
        state_prov = {"act": "Rajasthan Tenancy Act", "state": "RJ", "key": "rj_ten_12"}
        out = law_status_guard.annotate_provisions([state_prov])
        assert out[0].get("_law_status") == "STATE_NOT_CHECKED"
        assert "registry_gap_note" not in out[0], \
            "STATE_NOT_CHECKED provisions must not receive registry_gap_note"
