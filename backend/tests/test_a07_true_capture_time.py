"""
test_a07_true_capture_time.py
A07 — the server stores when a location was really taken.

Before this change PATCH /api/journey/status/{token}/location stamped every
upload with the time it ARRIVED. A fix that was delayed, retried or sent
later from the phone's queue then looked brand new to the trusted person.
The app also had a made-up "demo" coordinate that could be uploaded.

The app now sends `age_seconds` (how old the fix is at the moment of sending)
and `source`. These tests show that the server:
  - stores capture time and arrival time separately, and puts the true
    capture time in `updated_at`, which every reader already uses;
  - is unaffected by a wrong phone clock, because it receives an age;
  - refuses anything that is not a real device fix;
  - never lets an older fix replace a newer one;
  - still throttles on arrival time;
  - behaves exactly as before for older app builds that send neither field.

Isolated: direct handler invocation and an in-process TestClient, with a
mocked DB. No live database, accounts, messages or network.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr_module
from dependencies import current_user

_OWNER = {"id": "owner-001", "name": "Priya Sharma"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(delta_s: float) -> str:
    return (_now() + timedelta(seconds=delta_s)).isoformat()


def _rec(last=None, **over) -> dict:
    r = {
        "token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
        "sharing_revoked_at": None, "expires_at": _iso(80_000),
    }
    if last is not None:
        r["last_location"] = last
    r.update(over)
    return r


def _db(rec):
    m = MagicMock()
    m.safety_journeys.find_one = AsyncMock(return_value=rec)
    m.safety_journeys.update_one = AsyncMock(return_value=MagicMock())
    return m


def _body(**over):
    data = dict(lat=17.4652, lng=78.3488, accuracy=12, area="Gachibowli, Hyderabad", source="gps")
    data.update(over)
    return jr_module.LocationIn(**data)


async def _call(rec, **body_over):
    db = _db(rec)
    with patch.object(jr_module, "db", db):
        out = await jr_module.update_location("TOK", _body(**body_over), user=_OWNER)
    stored = None
    if db.safety_journeys.update_one.await_count:
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]["last_location"]
    return out, stored, db


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


class TestTrueCaptureTime:
    @pytest.mark.asyncio
    async def test_fresh_fix_is_stored_as_just_taken(self):
        out, stored, _ = await _call(_rec(), age_seconds=0)
        assert abs((_dt(stored["captured_at"]) - _now()).total_seconds()) < 5
        assert stored["captured_at"] == stored["updated_at"]
        assert out["ok"] is True and "skipped" not in out

    @pytest.mark.asyncio
    async def test_a_20_minute_old_fix_is_stored_as_20_minutes_old(self):
        _, stored, _ = await _call(_rec(), age_seconds=1200)
        age = (_now() - _dt(stored["updated_at"])).total_seconds()
        assert 1195 <= age <= 1205, "must not look like it was just taken"

    @pytest.mark.asyncio
    async def test_capture_and_arrival_times_are_kept_apart(self):
        _, stored, _ = await _call(_rec(), age_seconds=300)
        gap = (_dt(stored["received_at"]) - _dt(stored["captured_at"])).total_seconds()
        assert 299 <= gap <= 301
        assert abs((_dt(stored["received_at"]) - _now()).total_seconds()) < 5

    @pytest.mark.asyncio
    async def test_reply_reports_both_times(self):
        out, stored, _ = await _call(_rec(), age_seconds=60)
        assert out["captured_at"] == stored["captured_at"]
        assert out["received_at"] == stored["received_at"]
        assert out["updated_at"] == stored["captured_at"]

    @pytest.mark.asyncio
    async def test_source_is_recorded(self):
        _, stored, _ = await _call(_rec(), age_seconds=0)
        assert stored["source"] == "gps"

    @pytest.mark.asyncio
    async def test_alert_payload_age_uses_the_true_capture_time(self):
        """_notify_linked_recipients computes age_minutes from updated_at."""
        _, stored, _ = await _call(_rec(), age_seconds=600)
        rec = _rec(last=stored, recipient_link_ids=["L1"], destination="Gate")
        db = _db(rec)
        db.trusted_circle_links.find_one = AsyncMock(return_value={"id": "L1"})
        seen = {}

        async def _create(**kw):
            seen.update(kw["payload"]["last_location"])
            return {"id": "a"}

        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "create_alert_and_notify", new=AsyncMock(side_effect=_create)):
            await jr_module._notify_linked_recipients(_OWNER, rec, "missed_checkin")
        assert seen["age_minutes"] in (9, 10)


class TestOnlyRealDeviceFixes:
    @pytest.mark.parametrize("source", ["demo", "server", "cached", "manual"])
    @pytest.mark.asyncio
    async def test_non_device_source_is_refused_and_nothing_is_stored(self, source):
        out, stored, db = await _call(_rec(), source=source, age_seconds=0)
        assert out == {"ok": True, "skipped": "not_a_device_fix"}
        assert stored is None
        db.safety_journeys.update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_demo_cannot_replace_a_real_fix(self):
        real = {"lat": 17.4, "lng": 78.3, "updated_at": _iso(-120), "captured_at": _iso(-120), "received_at": _iso(-120)}
        out, stored, _ = await _call(_rec(last=real), source="demo", lat=13.0827, lng=80.2707)
        assert out["skipped"] == "not_a_device_fix" and stored is None


class TestOlderFixNeverReplacesNewer:
    @pytest.mark.asyncio
    async def test_delayed_older_fix_is_skipped(self):
        """Stored fix was taken 1 min ago. A queued fix taken 5 min ago arrives now."""
        newer = {"lat": 1, "lng": 1, "updated_at": _iso(-60), "captured_at": _iso(-60), "received_at": _iso(-60)}
        out, stored, db = await _call(_rec(last=newer), age_seconds=300)
        assert out == {"ok": True, "skipped": "older_than_current"}
        db.safety_journeys.update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_newer_fix_replaces_older(self):
        older = {"lat": 1, "lng": 1, "updated_at": _iso(-600), "captured_at": _iso(-600), "received_at": _iso(-600)}
        out, stored, _ = await _call(_rec(last=older), age_seconds=30)
        assert "skipped" not in out
        assert stored["lat"] == 17.4652

    @pytest.mark.asyncio
    async def test_works_against_a_record_written_before_this_change(self):
        """Old records have only updated_at (arrival time)."""
        legacy = {"lat": 1, "lng": 1, "updated_at": _iso(-600)}
        out, stored, _ = await _call(_rec(last=legacy), age_seconds=30)
        assert "skipped" not in out and stored is not None


class TestThrottleStillOnArrival:
    @pytest.mark.asyncio
    async def test_second_upload_within_25_seconds_is_throttled(self):
        last = {"lat": 1, "lng": 1, "updated_at": _iso(-900), "captured_at": _iso(-900), "received_at": _iso(-10)}
        out, _, db = await _call(_rec(last=last), age_seconds=0)
        assert out == {"ok": True, "skipped": "throttled"}
        db.safety_journeys.update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_old_capture_time_does_not_defeat_the_throttle_window(self):
        """Arrived 40 s ago, so not throttled, even though it was captured long before."""
        last = {"lat": 1, "lng": 1, "updated_at": _iso(-900), "captured_at": _iso(-900), "received_at": _iso(-40)}
        out, stored, _ = await _call(_rec(last=last), age_seconds=0)
        assert "skipped" not in out and stored is not None


class TestOlderAppBuilds:
    @pytest.mark.asyncio
    async def test_no_age_and_no_source_behaves_as_before(self):
        db = _db(_rec())
        with patch.object(jr_module, "db", db):
            out = await jr_module.update_location(
                "TOK", jr_module.LocationIn(lat=17.4, lng=78.3, accuracy=10, area="X"), user=_OWNER)
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]["last_location"]
        assert out["ok"] is True and "skipped" not in out
        assert abs((_dt(stored["updated_at"]) - _now()).total_seconds()) < 5
        assert stored["source"] == "unknown"


class TestClosedJourneysUnchanged:
    @pytest.mark.asyncio
    async def test_safe_journey_stores_nothing(self):
        out, stored, _ = await _call(_rec(status="safe"), age_seconds=0)
        assert "skipped" in out and stored is None

    @pytest.mark.asyncio
    async def test_write_filter_still_guards_safe_and_revoked(self):
        _, _, db = await _call(_rec(), age_seconds=0)
        flt = db.safety_journeys.update_one.await_args.args[0]
        assert flt == {"token": "TOK", "status": {"$ne": "safe"}, "sharing_revoked_at": None}

    @pytest.mark.asyncio
    async def test_another_user_is_refused(self):
        from fastapi import HTTPException
        with patch.object(jr_module, "db", _db(_rec())):
            with pytest.raises(HTTPException) as e:
                await jr_module.update_location("TOK", _body(), user={"id": "other-999"})
        assert e.value.status_code == 403


class TestHttpValidation:
    def _patch(self, **over):
        payload = {"lat": 17.4, "lng": 78.3, "accuracy": 10, "area": "X"}
        payload.update(over)
        app = FastAPI()
        app.include_router(jr_module.router, prefix="/api")
        app.dependency_overrides[current_user] = lambda: _OWNER
        with patch.object(jr_module, "db", _db(_rec())):
            return TestClient(app, raise_server_exceptions=False).patch("/api/journey/status/TOK/location", json=payload)

    def test_age_and_source_are_accepted(self):
        r = self._patch(age_seconds=42, source="gps")
        assert r.status_code == 200, r.text
        assert "captured_at" in r.json()

    @pytest.mark.parametrize("age", [-1, 86_401, 10**9])
    def test_impossible_age_is_rejected(self, age):
        assert self._patch(age_seconds=age, source="gps").status_code == 422

    @pytest.mark.parametrize("source", ["GPS", "g p s", "x" * 21, "gps;drop"])
    def test_malformed_source_is_rejected(self, source):
        assert self._patch(source=source).status_code == 422
