"""
test_a30_journey_create_idempotent.py
A30 — creating a journey is safe to retry.

The app now retries POST /api/journey/status until the server accepts the
journey (before this it tried once, silently). A retry can follow an attempt
that actually reached the server but whose reply was lost. Without a guard
that would create a second journey with its own deadline, which would later
alert the trusted circle for a journey the owner had already ended safely.

The app sends the same `client_ref` with every attempt for one journey.
These tests show that the server:
  - returns the SAME journey for a repeated client_ref, with no second record
    and no second "journey started" notification;
  - scopes the lookup to the signed-in user and to in-progress journeys;
  - still creates a journey normally when no client_ref is sent (older app
    builds) or when the earlier journey has expired;
  - tells the app the deadline it is holding and its own clock.

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
_REF = "ho-owner-001-1795000000000"


def _fut(m: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=m)).isoformat()


def _ago(m: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=m)).isoformat()


def _existing(expires_at: str | None = None) -> dict:
    return {
        "token":               "EXISTINGTOKEN",
        "user_id":             _OWNER["id"],
        "client_ref":          _REF,
        "status":              "in_progress",
        "destination":         "College Main Gate",
        "expected_checkin_at": _fut(25),
        "expires_at":          expires_at or _fut(1400),
        "recipient_link_ids":  ["link-1"],
    }


def _mock_db(find_return=None):
    m = MagicMock()
    m.safety_journeys.find_one = AsyncMock(return_value=find_return)
    m.safety_journeys.insert_one = AsyncMock(return_value=MagicMock())
    return m


def _body(**over):
    data = dict(destination="College Main Gate", duration_mins=30, recipient_link_ids=["link-1"], client_ref=_REF)
    data.update(over)
    return jr_module.JourneyIn(**data)


class TestFirstCreate:
    @pytest.mark.asyncio
    async def test_creates_and_notifies_once(self):
        db = _mock_db(find_return=None)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            out = await jr_module.create_journey(_body(), user=_OWNER)
        db.safety_journeys.insert_one.assert_awaited_once()
        notify.assert_awaited_once()
        assert out["created"] is True
        assert out["token"]

    @pytest.mark.asyncio
    async def test_stores_the_client_ref(self):
        db = _mock_db(find_return=None)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            await jr_module.create_journey(_body(), user=_OWNER)
        doc = db.safety_journeys.insert_one.await_args.args[0]
        assert doc["client_ref"] == _REF
        assert doc["user_id"] == _OWNER["id"]

    @pytest.mark.asyncio
    async def test_reply_carries_deadline_and_server_clock(self):
        db = _mock_db(find_return=None)
        before = datetime.now(timezone.utc)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            out = await jr_module.create_journey(_body(duration_mins=30), user=_OWNER)
        server_time = datetime.fromisoformat(out["server_time"])
        deadline = datetime.fromisoformat(out["expected_checkin_at"])
        assert before <= server_time <= datetime.now(timezone.utc)
        assert deadline - server_time == timedelta(minutes=30)


class TestRetryWithSameRef:
    @pytest.mark.asyncio
    async def test_returns_the_same_journey(self):
        db = _mock_db(find_return=_existing())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            out = await jr_module.create_journey(_body(), user=_OWNER)
        assert out["token"] == "EXISTINGTOKEN"
        assert out["created"] is False
        assert out["status_url"] == "/api/journey/status/EXISTINGTOKEN"

    @pytest.mark.asyncio
    async def test_no_second_record_and_no_second_notification(self):
        db = _mock_db(find_return=_existing())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            await jr_module.create_journey(_body(), user=_OWNER)
        db.safety_journeys.insert_one.assert_not_awaited()
        notify.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_returns_the_deadline_already_held(self):
        rec = _existing()
        db = _mock_db(find_return=rec)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            out = await jr_module.create_journey(_body(duration_mins=5), user=_OWNER)
        assert out["expected_checkin_at"] == rec["expected_checkin_at"]

    @pytest.mark.asyncio
    async def test_lookup_is_scoped_to_user_ref_and_in_progress(self):
        db = _mock_db(find_return=_existing())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            await jr_module.create_journey(_body(), user=_OWNER)
        query = db.safety_journeys.find_one.await_args.args[0]
        assert query == {"user_id": _OWNER["id"], "client_ref": _REF, "status": "in_progress"}


class TestNotReused:
    @pytest.mark.asyncio
    async def test_expired_journey_is_not_reused(self):
        db = _mock_db(find_return=_existing(expires_at=_ago(10)))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            out = await jr_module.create_journey(_body(), user=_OWNER)
        assert out["created"] is True
        assert out["token"] != "EXISTINGTOKEN"
        db.safety_journeys.insert_one.assert_awaited_once()
        notify.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_client_ref_skips_the_lookup(self):
        """Older app builds send no client_ref and must behave exactly as before."""
        db = _mock_db(find_return=_existing())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            out = await jr_module.create_journey(_body(client_ref=None), user=_OWNER)
        db.safety_journeys.find_one.assert_not_awaited()
        db.safety_journeys.insert_one.assert_awaited_once()
        notify.assert_awaited_once()
        assert out["created"] is True
        assert db.safety_journeys.insert_one.await_args.args[0]["client_ref"] is None


class TestClientRefValidation:
    def _client(self):
        app = FastAPI()
        app.include_router(jr_module.router, prefix="/api")
        app.dependency_overrides[current_user] = lambda: _OWNER
        return TestClient(app, raise_server_exceptions=False)

    def _post(self, **over):
        payload = {"destination": "College Main Gate", "duration_mins": 30}
        payload.update(over)
        db = _mock_db(find_return=None)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            return self._client().post("/api/journey/status", json=payload)

    def test_valid_ref_is_accepted(self):
        r = self._post(client_ref=_REF)
        assert r.status_code == 201 or r.status_code == 200, r.text
        assert r.json()["created"] is True

    def test_missing_ref_is_accepted(self):
        r = self._post()
        assert r.status_code in (200, 201), r.text

    @pytest.mark.parametrize("bad", ["short", "has space in it", "x" * 81, "drop;table--users", "ref/with/slash"])
    def test_malformed_ref_is_rejected(self, bad):
        assert self._post(client_ref=bad).status_code == 422
