"""
test_a12_journey_expiry.py
A12 — how long a journey is kept, and who can delete it.

A journey record holds her destination and her last known coordinates.
Nothing ever deleted one: past its expires_at it was refused with 410 and
then kept for ever. Mongo can delete it, but only from a real date, and
expires_at is an ISO string.

Four lifetimes, following what safety apps of this kind do:
  * the live trail goes the moment she marks safe or stops sharing;
  * an ordinary journey is kept JOURNEY_RETENTION_DAYS after its deadline;
  * a journey where her circle was alerted is kept INCIDENT_RETENTION_DAYS;
  * anonymous counts are kept, because they name nobody.
Plus her own control: deleting one journey, or all of them, immediately.

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
        deadline = datetime.fromisoformat(doc["expected_checkin_at"])
        expected = deadline + timedelta(days=jr.JOURNEY_RETENTION_DAYS)
        assert abs((doc["purge_at"] - expected).total_seconds()) < 2
        assert doc["incident"] is False

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
        assert stored["purge_at"] == new_deadline + timedelta(days=jr.JOURNEY_RETENTION_DAYS)

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
        assert stored["purge_at"] > _now() + timedelta(days=jr.JOURNEY_RETENTION_DAYS - 1)


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
        assert isinstance(pipeline, list), "needs an update pipeline to read each record's own created_at"
        terms = pipeline[0]["$set"]["purge_at"]["$max"]
        floor_ms = terms[0]["$add"][1]
        assert floor_ms == jr.BACKFILL_MIN_DAYS * 24 * 3600 * 1000, "nothing may vanish the minute this lands"
        window = terms[1]["$add"][1]["$cond"]
        assert window[1] == jr.INCIDENT_RETENTION_DAYS * 24 * 3600 * 1000
        assert window[2] == jr.JOURNEY_RETENTION_DAYS * 24 * 3600 * 1000

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


# ── a journey where her circle was alerted ───────────────────────────────────

class TestIncidentIsKeptLonger:
    @pytest.mark.asyncio
    async def test_an_alert_extends_the_journey_to_the_incident_window(self):
        deadline = _now() + timedelta(minutes=5)
        rec = {"token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
               "expected_checkin_at": deadline.isoformat(), "incident": False}
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value=rec)
        with patch.object(jr, "db", db):
            await jr.mark_journey_incident("TOK")
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]
        assert stored["incident"] is True
        assert stored["purge_at"] == deadline + timedelta(days=jr.INCIDENT_RETENTION_DAYS)
        assert jr.INCIDENT_RETENTION_DAYS > jr.JOURNEY_RETENTION_DAYS

    @pytest.mark.asyncio
    async def test_marking_the_same_journey_twice_changes_nothing(self):
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value={"token": "TOK", "incident": True})
        with patch.object(jr, "db", db):
            await jr.mark_journey_incident("TOK")
        db.safety_journeys.update_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_bookkeeping_never_blocks_an_alert(self):
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(side_effect=RuntimeError("db down"))
        with patch.object(jr, "db", db):
            await jr.mark_journey_incident("TOK")   # must not raise

    @pytest.mark.asyncio
    async def test_extending_an_incident_keeps_the_longer_window(self):
        deadline = _now() + timedelta(minutes=10)
        rec = {"token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
               "sharing_revoked_at": None, "expected_checkin_at": deadline.isoformat(),
               "incident": True}
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value=rec)
        with patch.object(jr, "db", db):
            await jr.extend_checkin("TOK", jr.ExtendIn(additional_mins=15), user=_OWNER)
        stored = db.safety_journeys.update_one.await_args.args[1]["$set"]
        new_deadline = datetime.fromisoformat(stored["expected_checkin_at"])
        assert stored["purge_at"] == new_deadline + timedelta(days=jr.INCIDENT_RETENTION_DAYS)


# ── the anonymous count that outlives the journey ────────────────────────────

class TestAnonymousStat:
    @pytest.mark.asyncio
    async def test_it_names_nobody_and_locates_nobody(self):
        rec = {
            "user_id": _OWNER["id"], "token": "TOK", "user_display": "Priya",
            "destination": "Gachibowli", "recipient_link_ids": ["L1", "L2"],
            "started_at": (_now() - timedelta(minutes=30)).isoformat(),
            "expected_checkin_at": (_now() + timedelta(minutes=15)).isoformat(),
            "last_location": {"lat": 17.46, "lng": 78.34},
        }
        db = _fake_db()
        db.journey_stats.insert_one = AsyncMock()
        with patch.object(jr, "db", db):
            await jr._record_journey_stat(rec, "safe")
        stat = db.journey_stats.insert_one.await_args.args[0]
        blob = str(stat).lower()
        for forbidden in ["owner-001", "tok", "priya", "gachibowli", "17.4", "78.3", "l1"]:
            assert forbidden not in blob, f"{forbidden} must not be in an anonymous record"
        assert stat["outcome"] == "safe"
        assert stat["planned_mins"] == 45
        assert 29 <= stat["actual_mins"] <= 31
        assert stat["recipient_count"] == 2
        assert stat["had_live_location"] is True

    @pytest.mark.asyncio
    async def test_a_missed_check_in_is_counted_as_an_alert(self):
        db = _fake_db()
        db.journey_stats.insert_one = AsyncMock()
        with patch.object(jr, "db", db):
            await jr._record_journey_stat({"started_at": _now().isoformat()}, "missed_checkin")
        assert db.journey_stats.insert_one.await_args.args[0]["had_alert"] is True

    @pytest.mark.asyncio
    async def test_counting_never_breaks_a_journey_ending(self):
        db = _fake_db()
        db.journey_stats.insert_one = AsyncMock(side_effect=RuntimeError("db down"))
        with patch.object(jr, "db", db):
            await jr._record_journey_stat({"started_at": _now().isoformat()}, "safe")   # must not raise


# ── her own control ──────────────────────────────────────────────────────────

class TestSheCanDelete:
    @pytest.mark.asyncio
    async def test_she_deletes_one_journey_immediately(self):
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value={"token": "TOK", "user_id": _OWNER["id"]})
        db.safety_journeys.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
        with patch.object(jr, "db", db):
            out = await jr.delete_journey("TOK", user=_OWNER)
        assert out == {"ok": True, "deleted": 1}
        assert db.safety_journeys.delete_one.await_args.args[0] == {"token": "TOK", "user_id": _OWNER["id"]}

    @pytest.mark.asyncio
    async def test_she_cannot_delete_someone_else_s_journey(self):
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value={"token": "TOK", "user_id": "someone-else"})
        db.safety_journeys.delete_one = AsyncMock()
        with patch.object(jr, "db", db):
            with pytest.raises(Exception) as e:
                await jr.delete_journey("TOK", user=_OWNER)
        assert "403" in str(e.value) or "Not your journey" in str(e.value)
        db.safety_journeys.delete_one.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_deleting_one_that_is_already_gone_is_not_an_error(self):
        db = _fake_db()
        db.safety_journeys.find_one = AsyncMock(return_value=None)
        with patch.object(jr, "db", db):
            assert await jr.delete_journey("TOK", user=_OWNER) == {"ok": True, "deleted": 0}

    @pytest.mark.asyncio
    async def test_she_deletes_her_whole_history_but_not_a_running_journey(self):
        db = _fake_db()
        db.safety_journeys.delete_many = AsyncMock(return_value=MagicMock(deleted_count=12))
        db.safety_journeys.count_documents = AsyncMock(return_value=1)
        with patch.object(jr, "db", db):
            out = await jr.delete_journey_history(user=_OWNER)
        assert out == {"ok": True, "deleted": 12, "still_running": 1}
        assert db.safety_journeys.delete_many.await_args.args[0] == {
            "user_id": _OWNER["id"], "status": {"$ne": "in_progress"},
        }


# ── the settings themselves ──────────────────────────────────────────────────

class TestRetentionSettings:
    def test_the_defaults_are_the_agreed_windows(self):
        assert jr.JOURNEY_RETENTION_DAYS == 30
        assert jr.INCIDENT_RETENTION_DAYS == 90
        assert jr.BACKFILL_MIN_DAYS == 7

    def test_they_can_be_changed_without_a_code_change(self, monkeypatch):
        monkeypatch.setenv("JOURNEY_RETENTION_DAYS", "45")
        assert jr._retention_days("JOURNEY_RETENTION_DAYS", 30) == 45

    def test_nonsense_falls_back_to_the_default(self, monkeypatch):
        monkeypatch.setenv("JOURNEY_RETENTION_DAYS", "soon")
        assert jr._retention_days("JOURNEY_RETENTION_DAYS", 30) == 30

    def test_zero_or_negative_is_never_accepted(self, monkeypatch):
        monkeypatch.setenv("JOURNEY_RETENTION_DAYS", "0")
        assert jr._retention_days("JOURNEY_RETENTION_DAYS", 30) == 1
