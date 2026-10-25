"""
test_f1_heartbeat_worker.py
Isolated F1 tests — heartbeat endpoint and missed check-in deadline worker.

Covers:
  1. record_heartbeat route handler (unit tests, direct invocation)
  2. deadline_worker._run_once (unit tests, mocked DB, no live HTTP)

All storage interactions are mocked via AsyncMock + MagicMock.
No live database, no running server, no real HTTP, no accounts, no notifications.
"""
from __future__ import annotations

import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr_module
from api.journey_router import record_heartbeat
from api.deadline_worker import _run_once, _GRACE_MINUTES

# ── Time helpers ──────────────────────────────────────────────────────────────

def _ago(m: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=m)).isoformat()

def _fut(m: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=m)).isoformat()

# ── Fixture constants ───────────────────────────────────────────────────────────

OWNER   = {"id": "owner-001", "name": "Priya"}
OTHER   = {"id": "other-999", "name": "Eve"}
TOKEN   = "TESTTOKEN1"
LINK_ID = "link-abc"


def _open_rec() -> dict:
    return {
        "token":                      TOKEN,
        "user_id":                    OWNER["id"],
        "user_display":               "Priya",
        "destination":                "MG Road",
        "status":                     "in_progress",
        "started_at":                 _ago(30),
        "expected_checkin_at":        _fut(30),      # not yet overdue
        "expires_at":                 _fut(1440),
        "sharing_revoked_at":         None,
        "safe_at":                    None,
        "missed_checkin_notified_at": None,
        "recipient_link_ids":         [LINK_ID],
    }


def _overdue_rec(**overrides) -> dict:
    r = _open_rec()
    # expected_checkin_at is GRACE_MINUTES+1 ago → past deadline+grace
    r["expected_checkin_at"] = _ago(_GRACE_MINUTES + 1)
    r.update(overrides)
    return r


# ── Async cursor mock ───────────────────────────────────────────────────────────

class _AsyncCursor:
    def __init__(self, items):
        self._items = list(items)
    def __aiter__(self):
        return self._gen()
    async def _gen(self):
        for item in self._items:
            yield item


def _mk_db(
    find_one_returns=None,
    find_returns=(),
    update_modified: int = 1,
    users_returns=None,
) -> MagicMock:
    m = MagicMock()
    m.safety_journeys.find_one   = AsyncMock(return_value=find_one_returns)
    m.safety_journeys.find.return_value = _AsyncCursor(find_returns)
    upd = MagicMock()
    upd.modified_count = update_modified
    m.safety_journeys.update_one = AsyncMock(return_value=upd)
    m.users.find_one             = AsyncMock(return_value=users_returns)
    return m


# ══════════════════════════════════════════════════════════════════════════════
# 1. Heartbeat endpoint (record_heartbeat)
# ══════════════════════════════════════════════════════════════════════════════

class TestHeartbeatEndpoint:

    @pytest.mark.asyncio
    async def test_200_for_open_in_progress_journey(self):
        db = _mk_db(find_one_returns=_open_rec())
        with patch.object(jr_module, "db", db):
            result = await record_heartbeat(TOKEN, user=OWNER)
        assert result["ok"] is True
        assert "heartbeat_at" in result

    @pytest.mark.asyncio
    async def test_sets_last_heartbeat_at_in_db(self):
        db = _mk_db(find_one_returns=_open_rec())
        with patch.object(jr_module, "db", db):
            await record_heartbeat(TOKEN, user=OWNER)
        _, update_doc = db.safety_journeys.update_one.call_args[0]
        assert "last_heartbeat_at" in update_doc.get("$set", {}), \
            "update must set last_heartbeat_at"

    @pytest.mark.asyncio
    async def test_does_not_touch_expected_checkin_at(self):
        """Heartbeat MUST NOT modify the check-in deadline — it is immutable."""
        db = _mk_db(find_one_returns=_open_rec())
        with patch.object(jr_module, "db", db):
            await record_heartbeat(TOKEN, user=OWNER)
        _, update_doc = db.safety_journeys.update_one.call_args[0]
        for op_value in update_doc.values():
            assert "expected_checkin_at" not in op_value, \
                "heartbeat must never modify the check-in deadline"

    @pytest.mark.asyncio
    async def test_409_for_safe_journey(self):
        from fastapi import HTTPException
        safe_rec = _open_rec()
        safe_rec["status"] = "safe"
        db = _mk_db(find_one_returns=safe_rec)
        with patch.object(jr_module, "db", db):
            with pytest.raises(HTTPException) as exc:
                await record_heartbeat(TOKEN, user=OWNER)
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_409_for_revoked_journey(self):
        from fastapi import HTTPException
        revoked = _open_rec()
        revoked["sharing_revoked_at"] = _ago(2)
        db = _mk_db(find_one_returns=revoked)
        with patch.object(jr_module, "db", db):
            with pytest.raises(HTTPException) as exc:
                await record_heartbeat(TOKEN, user=OWNER)
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_403_for_wrong_owner(self):
        from fastapi import HTTPException
        db = _mk_db(find_one_returns=_open_rec())
        with patch.object(jr_module, "db", db):
            with pytest.raises(HTTPException) as exc:
                await record_heartbeat(TOKEN, user=OTHER)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_404_for_missing_journey(self):
        from fastapi import HTTPException
        db = _mk_db(find_one_returns=None)
        with patch.object(jr_module, "db", db):
            with pytest.raises(HTTPException) as exc:
                await record_heartbeat("nonexistent", user=OWNER)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_overdue_journey_still_gets_200(self):
        """An overdue but open journey is still in_progress and not closed.
        Heartbeat is accepted — overdueness doesn't close the journey."""
        db = _mk_db(find_one_returns=_overdue_rec())
        with patch.object(jr_module, "db", db):
            result = await record_heartbeat(TOKEN, user=OWNER)
        assert result["ok"] is True


# ══════════════════════════════════════════════════════════════════════════════
# 2. Deadline worker — _run_once
# ══════════════════════════════════════════════════════════════════════════════

class TestDeadlineWorkerRunOnce:

    @pytest.mark.asyncio
    async def test_sends_alert_for_overdue_journey(self):
        """Overdue, unnotified, open journey → _notify_linked_recipients called once."""
        rec = _overdue_rec()
        db  = _mk_db(find_returns=[rec], update_modified=1, users_returns=OWNER)
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock) as mock_notify:
            count = await _run_once(db)
        assert count == 1
        mock_notify.assert_called_once()
        pseudo_user, called_rec, alert_type = mock_notify.call_args[0]
        assert pseudo_user["id"] == OWNER["id"], "pseudo-user must carry owner id"
        assert alert_type == "missed_checkin", "alert type must be missed_checkin"

    @pytest.mark.asyncio
    async def test_sets_missed_checkin_notified_at(self):
        """Worker must persist missed_checkin_notified_at before sending alerts."""
        rec = _overdue_rec()
        db  = _mk_db(find_returns=[rec], update_modified=1, users_returns=OWNER)
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock):
            await _run_once(db)
        _, update_doc = db.safety_journeys.update_one.call_args[0]
        assert "missed_checkin_notified_at" in update_doc.get("$set", {}), \
            "worker must set missed_checkin_notified_at atomically"

    @pytest.mark.asyncio
    async def test_atomic_guard_prevents_duplicate(self):
        """modified_count == 0 → another run already claimed this journey.
        No alert must be sent."""
        rec = _overdue_rec()
        db  = _mk_db(find_returns=[rec], update_modified=0, users_returns=OWNER)
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock) as mock_notify:
            count = await _run_once(db)
        assert count == 0
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_owner_not_found_skips_journey(self):
        """If the owner record has been deleted, skip the journey without crashing."""
        rec = _overdue_rec()
        db  = _mk_db(find_returns=[rec], update_modified=1, users_returns=None)
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock) as mock_notify:
            count = await _run_once(db)
        assert count == 0
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_cursor_returns_zero(self):
        """No overdue journeys in the cursor → count == 0."""
        db = _mk_db(find_returns=[])
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock) as mock_notify:
            count = await _run_once(db)
        assert count == 0
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_processes_multiple_overdue_journeys(self):
        """Two distinct overdue journeys → two independent alert fan-outs."""
        rec1 = _overdue_rec()
        rec2 = dict(_overdue_rec())
        rec2["token"] = "TOKEN2"
        db = _mk_db(find_returns=[rec1, rec2], update_modified=1, users_returns=OWNER)
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock) as mock_notify:
            count = await _run_once(db)
        assert count == 2
        assert mock_notify.call_count == 2

    @pytest.mark.asyncio
    async def test_query_filter_gates_on_all_required_fields(self):
        """Verify the DB query includes every required filter key."""
        db = _mk_db(find_returns=[])
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock):
            await _run_once(db)
        query = db.safety_journeys.find.call_args[0][0]
        assert query.get("status")                     == "in_progress"
        assert query.get("sharing_revoked_at")         is None
        assert query.get("missed_checkin_notified_at") is None
        expected_checkin_filter = query.get("expected_checkin_at", {})
        assert "$lt" in expected_checkin_filter, \
            "query must use $lt to filter on the grace-extended cutoff"

    @pytest.mark.asyncio
    async def test_atomic_guard_filter_checks_notified_at_is_none(self):
        """The update_one call used as the atomic guard must include
        missed_checkin_notified_at: None in its filter to prevent duplicate claims."""
        rec = _overdue_rec()
        db  = _mk_db(find_returns=[rec], update_modified=1, users_returns=OWNER)
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock):
            await _run_once(db)
        filter_doc, _ = db.safety_journeys.update_one.call_args[0]
        assert filter_doc.get("missed_checkin_notified_at") is None, \
            "atomic guard filter must include missed_checkin_notified_at: None"

    @pytest.mark.asyncio
    async def test_heartbeat_field_not_evaluated(self):
        """F1 invariant: the worker must NOT filter or inspect last_heartbeat_at.
        A journey with a recent heartbeat must still fire the alert if overdue."""
        rec = _overdue_rec(last_heartbeat_at=_ago(1))  # heartbeat 1 min ago
        db  = _mk_db(find_returns=[rec], update_modified=1, users_returns=OWNER)
        with patch("api.journey_router._notify_linked_recipients",
                   new_callable=AsyncMock) as mock_notify:
            count = await _run_once(db)
        assert count == 1, "recent heartbeat must not suppress the missed-checkin alert"
        mock_notify.assert_called_once()

    @pytest.mark.asyncio
    async def test_grace_period_constant_is_5_minutes(self):
        """Hard requirement from spec: grace period is exactly 5 minutes."""
        assert _GRACE_MINUTES == 5, f"Expected 5, got {_GRACE_MINUTES}"
