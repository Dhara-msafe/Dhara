"""
test_a11_upload_rules.py
A11 — the rules a location upload must keep, beyond what A07 already covers.

A07's file (test_a07_true_capture_time.py) already covers the four things the
task row lists: the capture time is stored, a non-device fix is refused, a
stale fix never replaces a newer one, and the 25-second throttle holds. This
file covers what nothing else does:

  * the stored trail is capped and keeps the NEWEST points, so a long
    journey cannot grow the record without limit;
  * impossible coordinates are refused by the model, not stored;
  * the exact words the app matches on. useJourneyGPS decides whether to
    hold a reading, let it go, or stop the journey from the server's reply
    (A10, A14), so those strings are a contract between the two sides;
  * a location upload never changes how long the journey is kept (A12);
  * what reaches the database is only what the journey needs.

Isolated: direct handler invocation with a mocked DB. No live database,
accounts or network.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr

_OWNER = {"id": "owner-001", "name": "Priya Sharma"}


def _now():
    return datetime.now(timezone.utc)


def _iso(delta_s: float) -> str:
    return (_now() + timedelta(seconds=delta_s)).isoformat()


def _rec(last=None, **over):
    r = {"token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
         "sharing_revoked_at": None, "expires_at": _iso(80_000)}
    if last is not None:
        r["last_location"] = last
    r.update(over)
    return r


def _body(**over):
    data = dict(lat=17.4652, lng=78.3488, accuracy=12, area="Gachibowli, Hyderabad", source="gps")
    data.update(over)
    return jr.LocationIn(**data)


async def _call(rec, **body_over):
    db = MagicMock()
    db.safety_journeys.find_one = AsyncMock(return_value=rec)
    db.safety_journeys.update_one = AsyncMock(return_value=MagicMock())
    with patch.object(jr, "db", db):
        out = await jr.update_location("TOK", _body(**body_over), user=_OWNER)
    return out, db


# ── the trail cannot grow without limit ──────────────────────────────────────

class TestTrailIsBounded:
    @pytest.mark.asyncio
    async def test_the_log_keeps_only_the_newest_points(self):
        _, db = await _call(_rec())
        push = db.safety_journeys.update_one.await_args.args[1]["$push"]["location_log"]
        assert push["$slice"] == -20, "negative slice keeps the NEWEST entries"
        assert len(push["$each"]) == 1

    @pytest.mark.asyncio
    async def test_a_long_journey_writes_one_point_per_upload(self):
        # 25 s throttle × a 3-hour journey is ~430 uploads; the record must
        # still hold 20 points, not 430.
        _, db = await _call(_rec())
        assert db.safety_journeys.update_one.await_count == 1

    @pytest.mark.asyncio
    async def test_the_last_position_is_replaced_not_appended(self):
        _, db = await _call(_rec())
        setter = db.safety_journeys.update_one.await_args.args[1]["$set"]
        assert set(setter.keys()) == {"last_location"}


# ── impossible coordinates never reach the database ──────────────────────────

class TestCoordinatesAreChecked:
    @pytest.mark.parametrize("lat,lng", [
        (91, 78.3), (-91, 78.3), (17.4, 181), (17.4, -181), (999, 999),
    ])
    def test_a_point_that_cannot_exist_is_refused(self, lat, lng):
        with pytest.raises(ValidationError):
            _body(lat=lat, lng=lng)

    def test_the_edges_of_the_world_are_allowed(self):
        for lat, lng in [(90, 180), (-90, -180), (0, 0)]:
            _body(lat=lat, lng=lng)

    def test_a_negative_accuracy_is_refused(self):
        with pytest.raises(ValidationError):
            _body(accuracy=-1)

    def test_a_very_long_area_name_is_refused(self):
        with pytest.raises(ValidationError):
            _body(area="x" * 201)

    @pytest.mark.asyncio
    async def test_an_empty_area_is_stored_as_words_not_as_nothing(self):
        _, db = await _call(_rec(), area="   ")
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]["last_location"]
        assert stored["area"] == "Unknown area"


# ── the words the app matches on ─────────────────────────────────────────────

class TestRepliesTheAppDependsOn:
    """useJourneyGPS reads these to decide: hold the reading, let it go, or
    stop the journey. Changing a string here breaks the app silently."""

    @pytest.mark.asyncio
    async def test_too_soon_says_throttled(self):
        last = {"lat": 17.4, "lng": 78.3, "updated_at": _iso(-5), "received_at": _iso(-5)}
        out, db = await _call(_rec(last))
        assert out["skipped"] == "throttled", "A10 holds the reading and retries on this word"
        db.safety_journeys.update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_fix_the_phone_did_not_take_says_not_a_device_fix(self):
        out, db = await _call(_rec(), source="cached")
        assert out["skipped"] == "not_a_device_fix", "A10 lets this reading go"
        db.safety_journeys.update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_older_reading_says_older_than_current(self):
        last = {"lat": 17.4, "lng": 78.3, "captured_at": _iso(-60),
                "updated_at": _iso(-60), "received_at": _iso(-40)}
        out, _ = await _call(_rec(last), age_seconds=600)
        assert out["skipped"] == "older_than_current"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("rec_over", [
        {"status": "safe"},
        {"sharing_revoked_at": _iso(-30)},
    ])
    async def test_a_finished_journey_says_so_in_words_a14_recognises(self, rec_over):
        out, db = await _call(_rec(**rec_over))
        skipped = out["skipped"]
        reason = skipped.lower()
        assert "completed" in reason or "withdrawn" in reason, (
            "A14 reads these words to stop the journey on the phone; "
            f"got {skipped!r}"
        )
        db.safety_journeys.update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_stored_reading_says_nothing_was_skipped(self):
        out, _ = await _call(_rec())
        assert "skipped" not in out
        assert out["ok"] is True
        assert out["captured_at"] and out["updated_at"]

    @pytest.mark.asyncio
    async def test_a_journey_that_is_gone_is_a_404(self):
        db = MagicMock()
        db.safety_journeys.find_one = AsyncMock(return_value=None)
        with patch.object(jr, "db", db):
            with pytest.raises(Exception) as e:
                await jr.update_location("TOK", _body(), user=_OWNER)
        assert "404" in str(e.value) or "not found" in str(e.value).lower()

    @pytest.mark.asyncio
    async def test_someone_else_s_journey_is_a_403_and_stores_nothing(self):
        _, db = (None, None)
        db = MagicMock()
        db.safety_journeys.find_one = AsyncMock(return_value=_rec(**{"user_id": "someone-else"}))
        db.safety_journeys.update_one = AsyncMock()
        with patch.object(jr, "db", db):
            with pytest.raises(Exception):
                await jr.update_location("TOK", _body(), user=_OWNER)
        db.safety_journeys.update_one.assert_not_awaited()


# ── what an upload must NOT do ───────────────────────────────────────────────

class TestAnUploadStaysInItsLane:
    @pytest.mark.asyncio
    async def test_it_never_changes_how_long_the_journey_is_kept(self):
        _, db = await _call(_rec())
        written = db.safety_journeys.update_one.await_args.args[1]
        assert "purge_at" not in written.get("$set", {}), (
            "a position upload must not extend or shorten retention (A12)"
        )

    @pytest.mark.asyncio
    async def test_it_never_changes_the_journey_s_status_or_deadline(self):
        _, db = await _call(_rec())
        setter = db.safety_journeys.update_one.await_args.args[1]["$set"]
        for field in ["status", "expected_checkin_at", "safe_at", "sharing_revoked_at",
                      "missed_checkin_notified_at", "incident"]:
            assert field not in setter

    @pytest.mark.asyncio
    async def test_the_write_cannot_resurrect_a_journey_that_just_closed(self):
        # The filter mirrors the read-time check, so a safe/revoke landing
        # between the two is a no-op rather than a restored position.
        _, db = await _call(_rec())
        filt = db.safety_journeys.update_one.await_args.args[0]
        assert filt["status"] == {"$ne": "safe"}
        assert filt["sharing_revoked_at"] is None
        assert filt["token"] == "TOK"

    @pytest.mark.asyncio
    async def test_only_the_journey_s_own_fields_are_stored(self):
        _, db = await _call(_rec())
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]["last_location"]
        assert set(stored.keys()) == {
            "lat", "lng", "accuracy", "area", "updated_at", "captured_at",
            "received_at", "source",
        }
