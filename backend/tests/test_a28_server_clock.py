"""
test_a28_server_clock.py
A28 — the countdown and the location age come from the server's clock.

Her phone's clock can be wrong, and so can a guardian's. The countdown on the
journey screen and the "X min ago" on the guardian screen must agree with the
moment deadline_worker.py will actually act, not with a phone.

The app side does the counting; this file covers what the server has to send
for it to be possible:
  * extend returns the new deadline AND the server's own time;
  * the guardian view returns the server's time and an age it worked out
    itself, from the true capture time (A07).

Isolated: direct handler invocation with a mocked DB. No live database,
accounts or network.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr_module

_OWNER = {"id": "owner-001", "name": "Priya Sharma"}
_GUARDIAN = {"id": "guardian-002", "name": "Asha"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(delta_s: float) -> str:
    return (_now() + timedelta(seconds=delta_s)).isoformat()


def _parse(s: str) -> datetime:
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# ── the helper ───────────────────────────────────────────────────────────────

class TestAgeSeconds:
    def test_a_five_minute_old_reading(self):
        assert jr_module._age_seconds(_iso(-300), _now()) == pytest.approx(300, abs=2)

    def test_a_reading_just_taken(self):
        assert jr_module._age_seconds(_iso(0), _now()) == 0

    def test_a_reading_stamped_ahead_is_never_negative(self):
        assert jr_module._age_seconds(_iso(120), _now()) == 0

    def test_nothing_to_measure(self):
        assert jr_module._age_seconds(None, _now()) is None
        assert jr_module._age_seconds("", _now()) is None
        assert jr_module._age_seconds("not a time", _now()) is None

    def test_a_naive_timestamp_is_read_as_utc(self):
        naive = (_now() - timedelta(minutes=3)).replace(tzinfo=None).isoformat()
        assert jr_module._age_seconds(naive, _now()) == pytest.approx(180, abs=2)


# ── extend ───────────────────────────────────────────────────────────────────

class TestExtendReply:
    @pytest.mark.asyncio
    async def test_extend_returns_the_new_deadline_and_the_server_clock(self):
        rec = {
            "token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
            "sharing_revoked_at": None, "expected_checkin_at": _iso(600),
        }
        db = MagicMock()
        db.safety_journeys.find_one = AsyncMock(return_value=rec)
        db.safety_journeys.update_one = AsyncMock(return_value=MagicMock())
        with patch.object(jr_module, "db", db):
            out = await jr_module.extend_checkin(
                "TOK", jr_module.ExtendIn(additional_mins=15), user=_OWNER,
            )
        assert out["ok"] is True
        assert "server_time" in out, "the phone cannot measure its offset without this"
        # the new deadline is 15 minutes past the old one, and server_time is now
        assert _parse(out["expected_checkin_at"]) - _parse(rec["expected_checkin_at"]) == timedelta(minutes=15)
        assert abs((_now() - _parse(out["server_time"])).total_seconds()) < 5
        # and the stored deadline is the one reported
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]
        assert stored["expected_checkin_at"] == out["expected_checkin_at"]


# ── guardian view ────────────────────────────────────────────────────────────

def _guardian_db(rec):
    db = MagicMock()
    db.safety_journeys.find_one = AsyncMock(return_value=rec)
    return db


async def _guardian(rec, link_perms={"temp_location": True}):
    link = {"id": "L1", "permissions": link_perms}
    db = _guardian_db(rec)
    with patch.object(jr_module, "db", db), \
         patch.object(jr_module, "_guardian_access_check",
                      new=AsyncMock(return_value=(rec, "HISTORICAL_ONLY", link))):
        return await jr_module.get_guardian_view("TOK", user=_GUARDIAN)


def _active(last=None, **over):
    rec = {
        "token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
        "sharing_revoked_at": None, "safe_at": None,
        "started_at": _iso(-1800), "expected_checkin_at": _iso(600),
        "user_display": "Priya", "destination": "Gachibowli",
    }
    if last is not None:
        rec["last_location"] = last
    rec.update(over)
    return rec


class TestGuardianView:
    @pytest.mark.asyncio
    async def test_the_view_states_the_server_time(self):
        out = await _guardian(_active())
        assert abs((_now() - _parse(out["server_time"])).total_seconds()) < 5

    @pytest.mark.asyncio
    async def test_a_closed_journey_states_it_too(self):
        out = await _guardian(_active(status="safe", safe_at=_iso(-60)))
        assert "server_time" in out

    @pytest.mark.asyncio
    async def test_the_age_is_worked_out_from_the_true_capture_time(self):
        last = {"lat": 17.46, "lng": 78.34, "accuracy": 12, "area": "Gachibowli",
                "updated_at": _iso(-420), "received_at": _iso(-10)}
        out = await _guardian(_active(last))
        assert out["last_location"]["age_seconds"] == pytest.approx(420, abs=3)

    @pytest.mark.asyncio
    async def test_a_fresh_reading_reads_as_zero_not_as_the_arrival_time(self):
        last = {"lat": 17.46, "lng": 78.34, "updated_at": _iso(0), "received_at": _iso(0)}
        out = await _guardian(_active(last))
        assert out["last_location"]["age_seconds"] == 0

    @pytest.mark.asyncio
    async def test_an_unreadable_timestamp_gives_no_age_rather_than_a_wrong_one(self):
        last = {"lat": 17.46, "lng": 78.34, "updated_at": "nonsense"}
        out = await _guardian(_active(last))
        assert out["last_location"]["age_seconds"] is None

    @pytest.mark.asyncio
    async def test_no_location_permission_still_gets_no_location(self):
        last = {"lat": 17.46, "lng": 78.34, "updated_at": _iso(-60)}
        out = await _guardian(_active(last), link_perms={"temp_location": False})
        assert "last_location" not in out
        assert "destination" not in out
        assert "server_time" in out
