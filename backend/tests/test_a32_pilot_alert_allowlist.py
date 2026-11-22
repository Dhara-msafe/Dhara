"""
test_a32_pilot_alert_allowlist.py
A32 — real missed-check-in push for named pilot accounts only.

The pilot needs a guardian's phone to actually buzz when a check-in is
missed. The deployment runs OUTBOUND_PROFILE=sms_only, where push is
DISABLED for everyone, and switching the whole profile would turn push on
for every account on a production deployment.

PILOT_ALERT_USER_IDS names the accounts that may receive a real push. The
guard stays narrow on purpose:
  * push only — SMS, dialler, email and share are untouched (DLT unchanged);
  * the master switch still wins (OUTBOUND_MODE must be "live");
  * only on DEPLOYMENT_ENV=production, so a preview can never reach a phone;
  * unset or empty = today's behaviour, everywhere.

Isolated: no network, no database, no accounts. The relay client and the
simulated-dispatch recorder are mocked.
"""
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import push as push_module
from services import outbound_guard as og

PILOT = "pilot-guardian-001"
OTHER = "someone-else-002"
DATA = {"title": "Safety alert", "message": "Priya has an update for you in DHARA."}


@pytest.fixture
def env(monkeypatch):
    """Start from the real pilot deployment: live master switch, sms_only."""
    monkeypatch.setenv("OUTBOUND_MODE", "live")
    monkeypatch.setenv("OUTBOUND_PROFILE", "sms_only")
    monkeypatch.setenv("DEPLOYMENT_ENV", "production")
    monkeypatch.delenv(og.PILOT_LIST_ENV, raising=False)
    return monkeypatch


@pytest.fixture
def relay():
    """Mocked relay + recorder. Yields (post, simulated)."""
    resp = AsyncMock()
    resp.status_code = 200
    resp.raise_for_status = lambda: None
    with patch.object(push_module._client, "post", new=AsyncMock(return_value=resp)) as post, \
         patch.object(push_module, "record_simulated", new=AsyncMock()) as sim:
        yield post, sim


def _sent_ids(post):
    ids = []
    for call in post.call_args_list:
        ids += call.kwargs["json"].get("recipients", [])
    return ids


# ── the list itself ──────────────────────────────────────────────────────────

def test_list_is_empty_by_default(env):
    assert og.pilot_user_ids() == frozenset()
    assert og.pilot_override_active() is False


@pytest.mark.parametrize("raw,expected", [
    ("a,b", {"a", "b"}),
    (" a , b ,, ", {"a", "b"}),
    ("a b\nc", {"a", "b", "c"}),
    ("a,a,b", {"a", "b"}),
    ("", set()),
    ("   ", set()),
])
def test_list_parsing(env, raw, expected):
    env.setenv(og.PILOT_LIST_ENV, raw)
    assert og.pilot_user_ids() == frozenset(expected)


def test_list_is_capped(env):
    env.setenv(og.PILOT_LIST_ENV, ",".join(f"u{i}" for i in range(60)))
    assert len(og.pilot_user_ids()) == og.PILOT_LIST_MAX


# ── when the allow-list may act ──────────────────────────────────────────────

def test_listed_account_may_receive_push(env):
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    assert og.should_send_to(og.PUSH, PILOT) is True
    assert og.should_send_to(og.PUSH, OTHER) is False
    assert og.should_send(og.PUSH) is False, "push must stay off for everyone else"


def test_master_switch_still_wins(env):
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    env.setenv("OUTBOUND_MODE", "simulate")
    assert og.should_send_to(og.PUSH, PILOT) is False


def test_preview_can_never_reach_a_phone(env):
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    env.setenv("DEPLOYMENT_ENV", "preview")
    assert og.should_send_to(og.PUSH, PILOT) is False


@pytest.mark.parametrize("channel", [og.SMS, og.DIALLER, og.EMAIL, og.GUARDIAN,
                                     og.REMINDER, og.EXTERNAL_SHARE, og.RESET_EMAIL])
def test_other_channels_are_untouched(env, channel):
    """Guardian SMS still waits for DLT; the allow-list must not open it."""
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    assert og.should_send_to(channel, PILOT) is og.should_send(channel)


def test_empty_user_id_is_never_allowed(env):
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    assert og.should_send_to(og.PUSH, "") is False


def test_production_profile_unchanged(env):
    """With the production profile push is live for everyone, list or no list."""
    env.setenv("OUTBOUND_PROFILE", "production")
    assert og.should_send_to(og.PUSH, OTHER) is True


def test_snapshot_reports_the_count_and_never_the_ids(env):
    env.setenv(og.PILOT_LIST_ENV, f"{PILOT},second-account")
    snap = og.policy_snapshot()
    assert snap["pilot_allowlist"] == {"active": True, "channels": ["push"], "count": 2}
    assert PILOT not in str(snap)


# ── what actually goes out ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_nothing_real_is_sent_without_a_list(env, relay):
    post, sim = relay
    await push_module.send_push(recipients=[PILOT, OTHER], data=DATA)
    post.assert_not_awaited()
    assert sim.await_count == 1


@pytest.mark.asyncio
async def test_only_the_listed_account_gets_a_real_push(env, relay):
    post, sim = relay
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    await push_module.send_push(recipients=[OTHER, PILOT, "third-003"], data=DATA)
    assert _sent_ids(post) == [PILOT]
    blocked = sim.await_args.args[1]
    assert blocked == f"{OTHER},third-003"


@pytest.mark.asyncio
async def test_a_blocked_recipient_does_not_stop_the_allowed_one(env, relay):
    post, sim = relay
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    with patch.object(push_module, "record_simulated", new=AsyncMock(side_effect=RuntimeError("db down"))):
        with pytest.raises(RuntimeError):
            await push_module.send_push(recipients=[OTHER, PILOT], data=DATA)
    # recording failure is the only error path; the relay contract itself is
    # unchanged, so a clean run still delivers:
    await push_module.send_push(recipients=[OTHER, PILOT], data=DATA)
    assert _sent_ids(post) == [PILOT]


@pytest.mark.asyncio
async def test_listed_account_can_register_its_device(env, relay):
    post, sim = relay
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    assert (await push_module.register_device(PILOT, "android", "tok-1"))["status"] == "registered"
    assert (await push_module.register_device(OTHER, "android", "tok-2"))["status"] == "simulated"


@pytest.mark.asyncio
async def test_unregister_follows_the_same_rule(env, relay):
    post, sim = relay
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    await push_module.unregister_device(PILOT)
    assert post.await_count == 1
    await push_module.unregister_device(OTHER)
    assert post.await_count == 1
    assert sim.await_count == 1


@pytest.mark.asyncio
async def test_no_recipients_is_still_a_no_op(env, relay):
    post, sim = relay
    env.setenv(og.PILOT_LIST_ENV, PILOT)
    await push_module.send_push(recipients=[], data=DATA)
    post.assert_not_awaited()
    sim.assert_not_awaited()
