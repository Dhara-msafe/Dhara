"""WAVE T4 — channel-specific outbound policy across release profiles.

Proves each channel's behaviour independently in internal_qa, closed_testing
and production, and that the profile can only RESTRICT (never enable) a send.
Pure unit tests on services.outbound_guard — no network, no DB.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import outbound_guard as og  # noqa: E402

ALL = og.CHANNELS


def _env(monkeypatch, mode=None, profile=None, email_key=None):
    for k, v in (("OUTBOUND_MODE", mode), ("OUTBOUND_PROFILE", profile), ("EMERGENT_EMAIL_KEY", email_key)):
        if v is None:
            monkeypatch.delenv(k, raising=False)
        else:
            monkeypatch.setenv(k, v)


# ── Expected per-profile decisions (profile layer only, ignoring master) ──────
EXPECTED = {
    "internal_qa": {
        og.DIALLER: "simulate", og.SMS: "simulate", og.RESET_EMAIL: "simulate",
        og.EMAIL: "simulate", og.EXTERNAL_SHARE: "simulate", og.OPS_ALERT: "simulate",
        og.PUSH: "disabled", og.REMINDER: "disabled", og.GUARDIAN: "disabled",
    },
    "closed_testing": {
        og.DIALLER: "live", og.SMS: "live", og.RESET_EMAIL: "live",
        og.EMAIL: "live", og.EXTERNAL_SHARE: "live", og.OPS_ALERT: "live",
        og.PUSH: "disabled", og.REMINDER: "disabled", og.GUARDIAN: "disabled",
    },
    "production": {c: "live" for c in ALL},
}


@pytest.mark.parametrize("profile", list(EXPECTED))
def test_channel_decision_matrix(monkeypatch, profile):
    _env(monkeypatch, mode="live", profile=profile, email_key="k")
    for ch in ALL:
        assert og.channel_decision(ch) == EXPECTED[profile][ch], f"{profile}/{ch}"


def test_internal_qa_never_sends_even_in_live_mode(monkeypatch):
    # "QA builds must not send real outbound communications."
    _env(monkeypatch, mode="live", profile="internal_qa")
    for ch in ALL:
        assert og.should_send(ch) is False, ch


def test_closed_testing_live_enables_only_the_allowed_channels(monkeypatch):
    _env(monkeypatch, mode="live", profile="closed_testing", email_key="k")
    live = {c for c in ALL if og.should_send(c)}
    assert live == {og.DIALLER, og.SMS, og.RESET_EMAIL, og.EMAIL, og.EXTERNAL_SHARE, og.OPS_ALERT}
    for ch in (og.PUSH, og.REMINDER, og.GUARDIAN):
        assert og.should_send(ch) is False, ch


def test_closed_testing_without_live_master_sends_nothing(monkeypatch):
    # Profile enables channels, but the master switch is still simulate.
    _env(monkeypatch, mode="simulate", profile="closed_testing")
    for ch in ALL:
        assert og.should_send(ch) is False, ch


def test_production_live_sends_every_channel(monkeypatch):
    _env(monkeypatch, mode="live", profile="production", email_key="k")
    for ch in ALL:
        assert og.should_send(ch) is True, ch


def test_profile_only_restricts_never_enables(monkeypatch):
    # simulate master → no channel may send under ANY profile.
    for profile in EXPECTED:
        _env(monkeypatch, mode="simulate", profile=profile, email_key="k")
        assert not any(og.should_send(c) for c in ALL), profile


def test_channel_effective_reports_disabled_vs_simulate(monkeypatch):
    _env(monkeypatch, mode="simulate", profile="internal_qa")
    assert og.channel_effective(og.PUSH) == "disabled"
    assert og.channel_effective(og.DIALLER) == "simulate"
    _env(monkeypatch, mode="live", profile="production", email_key="k")
    assert og.channel_effective(og.PUSH) == "live"


def test_derived_profile_backward_compat(monkeypatch):
    _env(monkeypatch, mode="live", profile=None, email_key="k")
    assert og.outbound_profile() == "production"
    _env(monkeypatch, mode="simulate", profile=None)
    assert og.outbound_profile() == "internal_qa"


# ── Startup validation ───────────────────────────────────────────────────────
def test_production_requires_live_mode(monkeypatch):
    _env(monkeypatch, mode="simulate", profile="production", email_key="k")
    with pytest.raises(RuntimeError, match="requires OUTBOUND_MODE=live"):
        og.validate_outbound_config()


def test_production_requires_email_key(monkeypatch):
    _env(monkeypatch, mode="live", profile="production", email_key=None)
    with pytest.raises(RuntimeError, match="EMERGENT_EMAIL_KEY"):
        og.validate_outbound_config()


def test_production_ok_when_complete(monkeypatch):
    _env(monkeypatch, mode="live", profile="production", email_key="k")
    assert og.validate_outbound_config() == "live"


def test_invalid_profile_refuses_start(monkeypatch):
    _env(monkeypatch, mode="simulate", profile="staging")
    with pytest.raises(RuntimeError, match="OUTBOUND_PROFILE"):
        og.validate_outbound_config()


def test_closed_testing_simulate_is_allowed_but_warns(monkeypatch):
    _env(monkeypatch, mode="simulate", profile="closed_testing")
    assert og.validate_outbound_config() == "simulate"


def test_policy_snapshot_shape(monkeypatch):
    _env(monkeypatch, mode="simulate", profile="internal_qa")
    snap = og.policy_snapshot()
    assert snap["mode"] == "simulate" and snap["profile"] == "internal_qa"
    assert snap["channels"][og.PUSH] == "disabled"
    assert snap["channels"][og.DIALLER] == "simulate"
