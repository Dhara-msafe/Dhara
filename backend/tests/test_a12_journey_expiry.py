"""
test_a12_journey_expiry.py
A12 — journeys, and the locations in them, are deleted when they expire.

A journey record holds her destination and her last known coordinates.
Nothing ever deleted one: past its expires_at it was refused with 410 and
then kept for ever. Mongo can delete it, but only from a real date, and
expires_at is an ISO string.

Covered here:
  * creating a journey stores purge_at as a real date;
  * extending a journey pushes purge_at out, so a record can never be
    deleted while the journey is still running;
  * the TTL index is created with expireAfterSeconds=0 and never stops the
    app booting;
  * older records are given a purge_at once;
  * marking safe still clears the coordinates immediately (PR-2A), which is
    the part that does not wait for expiry.

Isolated: direct handler invocation with a mocked DB.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr

_OWNER = {"id": "owner-001", "name": "Priya Sharma"}


def _now():
    return datetime.now(timezone.utc)


def _fake_db():
    db = MagicMock()
    db.safety_journeys.insert_one = AsyncMock()
    db.safety_journeys.update_one = AsyncMock(return_value=MagicMock())
    db.safety_journeys.find_one = AsyncMock(return_value=None)
    db.safety_links.find = MagicMock(return_value=_empty_cursor())
    return db


def _empty_cursor():
    class _C:
        def __aiter__(self): return self
        async def __anext__(self): raise StopAsyncIteration
    return _C()


# ── a new journey ────────────────────────────────────────────────────────────

class TestCreate:
    @pytest.mark.asyncio
    async def test_a_new_journey_has_a_real_delete_date(self):
        db = _fake_db()
        with patch.object(jr, "db", db), \
             patch.object(jr, "_notify_linked_recipients", new=AsyncMock(return_value=[])):
            await jr.create_journey(
                jr.JourneyIn(destination="Gachibowli", duration_mins=45, recipient_link_ids=[]),
                user=_OWNER,
            )
        doc = db.safety_journeys.insert_one.await_args.args[0]
        assert isinstance(doc["purge_at"], datetime), "Mongo's TTL monitor ignores strings"
        assert doc["purge_at"].tzinfo is not None
        # the same moment the ISO string already describes
        assert abs((doc["purge_at"] - datetime.fromisoformat(doc["expires_at"])).total_seconds()) < 2

    @pytest.mark.asyncio
    async def test_the_delete_date_is_after_the_check_in_deadline(self):
        db = _fake_db()
        with patch.object(jr, "db", db), \
             patch.object(jr, "_notify_linked_recipients", new=AsyncMock(return_value=[])):
            await jr.create_journey(
                jr.JourneyIn(destination="Gachibowli", duration_mins=45, recipient_link_ids=[]),
                user=_OWNER,
            )
        doc = db.safety_journeys.insert_one.await_args.args[0]
        deadline = datetime.fromisoformat(doc["expected_checkin_at"])
        assert doc["purge_at"] > deadline


# ── extending ────────────────────────────────────────────────────────────────

class TestExtend:
    @pytest.mark.asyncio
    async def test_extending_pushes_the_delete_date_out(self):
        deadline = _now() + timedelta(minutes=10)
        rec = {"token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
               "sharing_revoked_at": None, "expected_checkin_at": deadline.isoformat()}
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value=rec)
        with patch.object(jr, "db", db):
            await jr.extend_checkin("TOK", jr.ExtendIn(additional_mins=120), user=_OWNER)
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]
        new_deadline = datetime.fromisoformat(stored["expected_checkin_at"])
        assert isinstance(stored["purge_at"], datetime)
        assert stored["purge_at"] > new_deadline, "a running journey must not be deleted"
        assert stored["purge_at"] == new_deadline + timedelta(hours=jr._PURGE_GRACE_HOURS)

    @pytest.mark.asyncio
    async def test_extending_an_overdue_journey_still_leaves_time(self):
        # Deadline already passed: the delete date must be measured from now,
        # not from a moment in the past.
        rec = {"token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
               "sharing_revoked_at": None,
               "expected_checkin_at": (_now() - timedelta(hours=20)).isoformat()}
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value=rec)
        with patch.object(jr, "db", db):
            await jr.extend_checkin("TOK", jr.ExtendIn(additional_mins=30), user=_OWNER)
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]
        assert stored["purge_at"] > _now() + timedelta(hours=jr._PURGE_GRACE_HOURS - 1)


# ── the index ────────────────────────────────────────────────────────────────

class TestIndex:
    @pytest.mark.asyncio
    async def test_the_index_deletes_at_the_stored_moment(self):
        db = MagicMock()
        db.safety_journeys.create_index = AsyncMock()
        await jr.ensure_journey_ttl_index(db)
        kwargs = db.safety_journeys.create_index.await_args.kwargs
        assert db.safety_journeys.create_index.await_args.args[0] == "purge_at"
        assert kwargs["expireAfterSeconds"] == 0
        assert kwargs["name"] == "safety_journeys_ttl"

    @pytest.mark.asyncio
    async def test_a_database_problem_never_stops_the_app_booting(self):
        db = MagicMock()
        db.safety_journeys.create_index = AsyncMock(side_effect=RuntimeError("no primary"))
        await jr.ensure_journey_ttl_index(db)   # must not raise


# ── older records ────────────────────────────────────────────────────────────

class TestBackfill:
    @pytest.mark.asyncio
    async def test_records_without_a_delete_date_are_given_one(self):
        db = MagicMock()
        db.safety_journeys.update_many = AsyncMock(return_value=MagicMock(modified_count=7))
        assert await jr.backfill_journey_purge_at(db) == 7
        filt, pipeline = db.safety_journeys.update_many.await_args.args
        assert filt == {"purge_at": {"$exists": False}}
        assert isinstance(pipeline, list), "needs an update pipeline to read each record's own expires_at"
        setter = pipeline[0]["$set"]["purge_at"]["$ifNull"]
        assert setter[0]["$dateFromString"]["dateString"] == "$expires_at"
        assert setter[1]["$dateFromString"]["dateString"] == "$created_at"

    @pytest.mark.asyncio
    async def test_records_that_already_have_one_are_left_alone(self):
        db = MagicMock()
        db.safety_journeys.update_many = AsyncMock(return_value=MagicMock(modified_count=0))
        assert await jr.backfill_journey_purge_at(db) == 0

    @pytest.mark.asyncio
    async def test_a_database_problem_never_stops_the_app_booting(self):
        db = MagicMock()
        db.safety_journeys.update_many = AsyncMock(side_effect=RuntimeError("not supported"))
        assert await jr.backfill_journey_purge_at(db) == 0


# ── what does not wait for expiry ────────────────────────────────────────────

class TestSafeClearsLocationNow:
    @pytest.mark.asyncio
    async def test_marking_safe_removes_the_coordinates_immediately(self):
        rec = {"token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
               "last_location": {"lat": 17.4, "lng": 78.3}}
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value=rec)
        with patch.object(jr, "db", db), \
             patch.object(jr, "_notify_linked_recipients", new=AsyncMock(return_value=[])):
            out = await jr.mark_safe("TOK", user=_OWNER)
        upd = db.safety_journeys.update_one.await_args.args[1]
        assert upd["$unset"] == {"last_location": ""}
        assert upd["$set"]["location_log"] == []
        assert out["ok"] is True
