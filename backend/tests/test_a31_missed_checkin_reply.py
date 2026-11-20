"""
test_a31_missed_checkin_reply.py
A31 — the server tells the app what happened to a missed-check-in alert.

The journey screen used to say "Your trusted circle has been notified" on the
phone's own timer. For the screen to say only what is true, the server's
reply to POST /api/journey/status/{token}/missed-checkin now states:
  - which selected people an alert record exists for (alerted_link_ids);
  - how many people were selected for the journey (selected);
  - when nothing was raised, why (skipped_reason).

Also covered: an AUTOMATIC report must respect the owner's "Do nothing"
choice for missed check-ins. Before this change the app's automatic report
reached this endpoint and alerted the circle anyway. A deliberate
"Raise alert now" (trigger "manual") still goes through, and a request with
no body (older app builds) behaves exactly as before.

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


def _fut(m: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=m)).isoformat()


def _ago(m: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=m)).isoformat()


def _rec(**over) -> dict:
    r = {
        "token": "TOK", "user_id": _OWNER["id"], "status": "in_progress",
        "destination": "College Main Gate", "expected_checkin_at": _ago(6),
        "expires_at": _fut(1400), "sharing_revoked_at": None, "safe_at": None,
        "recipient_link_ids": ["L1", "L2", "L3"], "auto_notify_on_no_response": True,
    }
    r.update(over)
    return r


def _db(rec, links=None):
    """links: {link_id: link_doc or None}."""
    links = links if links is not None else {i: {"id": i, "owner_id": _OWNER["id"]} for i in ("L1", "L2", "L3")}
    m = MagicMock()
    m.safety_journeys.find_one = AsyncMock(return_value=rec)

    async def _find_link(q):
        return links.get(q["id"])
    m.trusted_circle_links.find_one = AsyncMock(side_effect=_find_link)
    return m


def _body(trigger):
    return jr_module.MissedCheckinIn(trigger=trigger) if trigger else None


class TestFanOutReportsWhoWasAlerted:
    @pytest.mark.asyncio
    async def test_returns_only_links_an_alert_exists_for(self):
        """L1: alert created. L2: refused (no permission / not accepted). L3: link missing."""
        rec = _rec()
        links = {"L1": {"id": "L1"}, "L2": {"id": "L2"}, "L3": None}

        async def _create(**kw):
            return {"id": "alert-1"} if kw["link"]["id"] == "L1" else None

        with patch.object(jr_module, "db", _db(rec, links)), \
             patch.object(jr_module, "create_alert_and_notify", new=AsyncMock(side_effect=_create)):
            out = await jr_module._notify_linked_recipients(_OWNER, rec, "missed_checkin")
        assert out == ["L1"]

    @pytest.mark.asyncio
    async def test_one_failure_does_not_hide_the_others(self):
        rec = _rec()

        async def _create(**kw):
            if kw["link"]["id"] == "L2":
                raise RuntimeError("db write failed")
            return {"id": "a"}

        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "create_alert_and_notify", new=AsyncMock(side_effect=_create)):
            out = await jr_module._notify_linked_recipients(_OWNER, rec, "missed_checkin")
        assert out == ["L1", "L3"]

    @pytest.mark.asyncio
    async def test_nobody_selected_returns_an_empty_list(self):
        rec = _rec(recipient_link_ids=[])
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "create_alert_and_notify", new=AsyncMock()) as create:
            out = await jr_module._notify_linked_recipients(_OWNER, rec, "missed_checkin")
        assert out == []
        create.assert_not_awaited()


class TestMissedCheckinReply:
    @pytest.mark.asyncio
    async def test_reply_lists_who_was_alerted_and_how_many_were_selected(self):
        rec = _rec()
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock(return_value=["L1", "L3"])):
            out = await jr_module.report_missed_checkin("TOK", body=_body("auto"), user=_OWNER)
        assert out == {"ok": True, "alerted_link_ids": ["L1", "L3"], "selected": 3}

    @pytest.mark.asyncio
    async def test_sharing_withdrawn_raises_nothing_and_says_why(self):
        rec = _rec(sharing_revoked_at=_ago(2))
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            out = await jr_module.report_missed_checkin("TOK", body=_body("auto"), user=_OWNER)
        notify.assert_not_awaited()
        assert out["skipped_reason"] == "sharing_withdrawn"
        assert out["alerted_link_ids"] == [] and out["selected"] == 3
        assert out["skipped"]  # older app builds read this key

    @pytest.mark.asyncio
    async def test_journey_already_safe_raises_nothing_and_says_why(self):
        rec = _rec(status="safe", safe_at=_ago(2))
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            out = await jr_module.report_missed_checkin("TOK", body=_body("manual"), user=_OWNER)
        notify.assert_not_awaited()
        assert out["skipped_reason"] == "journey_completed"


class TestDoNothingChoiceIsRespected:
    @pytest.mark.asyncio
    async def test_automatic_report_is_skipped(self):
        rec = _rec(auto_notify_on_no_response=False)
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            out = await jr_module.report_missed_checkin("TOK", body=_body("auto"), user=_OWNER)
        notify.assert_not_awaited()
        assert out["skipped_reason"] == "auto_notify_off"
        assert out["alerted_link_ids"] == []

    @pytest.mark.asyncio
    async def test_manual_raise_still_goes_through(self):
        rec = _rec(auto_notify_on_no_response=False)
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock(return_value=["L1"])) as notify:
            out = await jr_module.report_missed_checkin("TOK", body=_body("manual"), user=_OWNER)
        notify.assert_awaited_once()
        assert out["alerted_link_ids"] == ["L1"]

    @pytest.mark.asyncio
    async def test_no_body_keeps_the_old_behaviour(self):
        """Older app builds send no body. Nothing changes for them."""
        rec = _rec(auto_notify_on_no_response=False)
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock(return_value=["L1"])) as notify:
            out = await jr_module.report_missed_checkin("TOK", body=None, user=_OWNER)
        notify.assert_awaited_once()
        assert out["ok"] is True

    @pytest.mark.asyncio
    async def test_automatic_report_goes_through_when_auto_notify_is_on(self):
        rec = _rec(auto_notify_on_no_response=True)
        with patch.object(jr_module, "db", _db(rec)), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock(return_value=[])) as notify:
            await jr_module.report_missed_checkin("TOK", body=_body("auto"), user=_OWNER)
        notify.assert_awaited_once()


class TestOwnershipUnchanged:
    @pytest.mark.asyncio
    async def test_another_user_is_refused(self):
        from fastapi import HTTPException
        with patch.object(jr_module, "db", _db(_rec())), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as notify:
            with pytest.raises(HTTPException) as e:
                await jr_module.report_missed_checkin("TOK", body=_body("manual"), user={"id": "other-999"})
        assert e.value.status_code == 403
        notify.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unknown_journey_is_404(self):
        from fastapi import HTTPException
        with patch.object(jr_module, "db", _db(None)):
            with pytest.raises(HTTPException) as e:
                await jr_module.report_missed_checkin("NOPE", body=None, user=_OWNER)
        assert e.value.status_code == 404


class TestHttpShape:
    def _client(self):
        app = FastAPI()
        app.include_router(jr_module.router, prefix="/api")
        app.dependency_overrides[current_user] = lambda: _OWNER
        return TestClient(app, raise_server_exceptions=False)

    def _post(self, **kw):
        with patch.object(jr_module, "db", _db(_rec())), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock(return_value=["L1"])):
            return self._client().post("/api/journey/status/TOK/missed-checkin", **kw)

    def test_no_body_is_accepted(self):
        r = self._post()
        assert r.status_code == 200, r.text
        assert r.json()["alerted_link_ids"] == ["L1"]

    @pytest.mark.parametrize("trigger", ["auto", "manual"])
    def test_known_triggers_are_accepted(self, trigger):
        assert self._post(json={"trigger": trigger}).status_code == 200

    def test_unknown_trigger_is_rejected(self):
        assert self._post(json={"trigger": "whatever"}).status_code == 422
