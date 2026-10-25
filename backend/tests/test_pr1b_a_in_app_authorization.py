"""
test_pr1b_a_in_app_authorization.py
Isolated authorization tests — PR-1B-A: Existing in-app location authorization.

Verifies that alerts_router applies the consent gate uniformly to ALL
location-bearing fields (last_location, destination, area, accuracy) across
both the list and detail endpoints.

ALL tests use mocked storage — no live database, no running server,
no real HTTP, no accounts created, no messages sent.
"""
from __future__ import annotations

import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.alerts_router as ar_module
from api.alerts_router import (
    _sanitize_location,
    _exact_location_permission_live,
    _public_alert,
    list_alerts,
    get_alert,
)

# ── Time helpers ──────────────────────────────────────────────────────────────

def _ago(m: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=m)).isoformat()

def _fut(m: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=m)).isoformat()

# ── Fixture constants ─────────────────────────────────────────────────────────

RECIPIENT     = {"id": "recip-001", "name": "Arjun"}
OWNER_ID      = "owner-111"
LINK_ID       = "link-abc"
JOURNEY_TOKEN = "JOURNEYTOKEN1"
ALERT_ID      = "alert-xyz"

# ── Fixture builders ──────────────────────────────────────────────────────────

def _link(temp_location: bool = True, status: str = "accepted") -> dict:
    return {
        "id": LINK_ID,
        "invitee_user_id": RECIPIENT["id"],
        "status": status,
        "permissions": {
            "journey_status":    True,
            "missed_checkin":    True,
            "emergency_requests": True,
            "expected_arrival":  True,
            "temp_location":     temp_location,
        },
    }


def _journey(status: str = "in_progress", revoked: bool = False) -> dict:
    return {
        "token":             JOURNEY_TOKEN,
        "user_id":           OWNER_ID,
        "status":            status,
        "sharing_revoked_at": _ago(2) if revoked else None,
    }


def _alert(type_: str = "journey_status") -> dict:
    return {
        "id":                ALERT_ID,
        "type":              type_,
        "owner_id":          OWNER_ID,
        "owner_name":        "Priya",
        "recipient_user_id": RECIPIENT["id"],
        "link_id":           LINK_ID,
        "journey_token":     JOURNEY_TOKEN,
        "payload": {
            "destination":    "MG Road, Bengaluru",
            "eta":            _fut(30),
            "journey_status": "in_progress",
            "last_location": {
                "lat":         12.971,
                "lng":         77.594,
                "accuracy":    12.5,
                "area":        "Koramangala, Bengaluru",
                "age_minutes": 3,
            },
        },
        "state":           "QUEUED",
        "created_at":      _ago(10),
        "read_at":         None,
        "acknowledged_at": None,
    }


# ── Async cursor mock ─────────────────────────────────────────────────────────

class _AsyncCursor:
    """Minimal async-iterable cursor that supports .sort().limit() chaining."""
    def __init__(self, items):
        self._items = list(items)

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for item in self._items:
            yield item


def _mock_db_for_list(alerts=(), links=(), journeys=()) -> MagicMock:
    m = MagicMock()
    m.safety_alerts.find.return_value        = _AsyncCursor(alerts)
    m.trusted_circle_links.find.return_value = _AsyncCursor(links)
    m.safety_journeys.find.return_value      = _AsyncCursor(journeys)
    return m


def _mock_db_for_detail(
    alert=None, link=None, journey=None, owner=None
) -> MagicMock:
    m = MagicMock()
    m.safety_alerts.find_one        = AsyncMock(return_value=alert)
    m.trusted_circle_links.find_one = AsyncMock(return_value=link)
    m.safety_journeys.find_one      = AsyncMock(return_value=journey)
    m.users.find_one                = AsyncMock(return_value=owner)
    return m


# ═════════════════════════════════════════════════════════════════════════════
# 1. Pure unit tests — _exact_location_permission_live
# ═════════════════════════════════════════════════════════════════════════════

class TestExactLocationPermissionLive:

    def test_open_journey_with_consent_grants(self):
        assert _exact_location_permission_live(_link(), _journey()) is True

    def test_no_temp_location_denies(self):
        assert _exact_location_permission_live(_link(temp_location=False), _journey()) is False

    def test_non_accepted_link_pending_denies(self):
        assert _exact_location_permission_live(_link(status="pending"), _journey()) is False

    def test_non_accepted_link_declined_denies(self):
        assert _exact_location_permission_live(_link(status="declined"), _journey()) is False

    def test_no_link_denies(self):
        assert _exact_location_permission_live(None, _journey()) is False

    def test_safe_journey_denies_even_with_consent(self):
        assert _exact_location_permission_live(_link(), _journey(status="safe")) is False

    def test_revoked_journey_denies_even_with_consent(self):
        assert _exact_location_permission_live(_link(), _journey(revoked=True)) is False

    def test_no_journey_object_does_not_deny(self):
        """None journey means no journey attached (alert type with no journey) — NOT a closed journey.
        Consent check should pass on an open-ended invitation or standalone alert."""
        assert _exact_location_permission_live(_link(), None) is True


# ═════════════════════════════════════════════════════════════════════════════
# 2. Pure unit tests — _sanitize_location
# ═════════════════════════════════════════════════════════════════════════════

_FULL_PAYLOAD: dict = {
    "destination":    "MG Road, Bengaluru",
    "eta":            "2099-01-01T10:00:00",
    "journey_status": "in_progress",
    "last_location": {
        "lat":         12.971,
        "lng":         77.594,
        "accuracy":    12.5,
        "area":        "Koramangala, Bengaluru",
        "age_minutes": 3,
    },
}


class TestSanitizeLocation:

    # ── Eligible recipient ────────────────────────────────────────────────────

    def test_eligible_recipient_gets_last_location(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey())
        assert "last_location" in out
        assert out["last_location"]["lat"] == 12.971

    def test_eligible_recipient_gets_destination(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey())
        assert "destination" in out
        assert out["destination"] == "MG Road, Bengaluru"

    def test_eligible_recipient_gets_area_and_accuracy_via_last_location(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey())
        loc = out["last_location"]
        assert loc["area"] == "Koramangala, Bengaluru"
        assert loc["accuracy"] == 12.5

    # ── No temp_location consent ──────────────────────────────────────────────

    def test_no_consent_strips_last_location(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(temp_location=False), _journey())
        assert "last_location" not in out

    def test_no_consent_strips_destination(self):
        """PR-1B-A core: destination is location data — must be stripped without consent."""
        out = _sanitize_location(_FULL_PAYLOAD, _link(temp_location=False), _journey())
        assert "destination" not in out

    # ── Safe journey ──────────────────────────────────────────────────────────

    def test_safe_journey_strips_last_location(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey(status="safe"))
        assert "last_location" not in out

    def test_safe_journey_strips_destination(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey(status="safe"))
        assert "destination" not in out

    # ── Revoked journey ───────────────────────────────────────────────────────

    def test_revoked_journey_strips_last_location(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey(revoked=True))
        assert "last_location" not in out

    def test_revoked_journey_strips_destination(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey(revoked=True))
        assert "destination" not in out

    # ── No link ───────────────────────────────────────────────────────────────

    def test_no_link_strips_last_location(self):
        out = _sanitize_location(_FULL_PAYLOAD, None)
        assert "last_location" not in out

    def test_no_link_strips_destination(self):
        out = _sanitize_location(_FULL_PAYLOAD, None)
        assert "destination" not in out

    # ── Non-location fields preserved ─────────────────────────────────────────

    def test_non_location_fields_preserved_without_consent(self):
        """eta and journey_status must survive even when location is redacted."""
        out = _sanitize_location(_FULL_PAYLOAD, _link(temp_location=False), _journey())
        assert "eta" in out
        assert "journey_status" in out

    def test_non_location_fields_preserved_on_safe_journey(self):
        out = _sanitize_location(_FULL_PAYLOAD, _link(), _journey(status="safe"))
        assert "eta" in out
        assert "journey_status" in out

    # ── Edge cases ────────────────────────────────────────────────────────────

    def test_empty_payload_handled_gracefully(self):
        out = _sanitize_location({}, _link(), _journey())
        assert out == {}

    def test_none_payload_handled_gracefully(self):
        out = _sanitize_location(None, _link(), _journey())  # type: ignore[arg-type]
        assert out == {}

    def test_destination_only_payload_stripped_without_consent(self):
        """Destination-only payload (no last_location) still stripped when no consent."""
        out = _sanitize_location({"destination": "Some Place"}, _link(temp_location=False), _journey())
        assert "destination" not in out

    def test_destination_only_payload_visible_with_consent(self):
        out = _sanitize_location({"destination": "Some Place"}, _link(), _journey())
        assert out.get("destination") == "Some Place"

    def test_location_only_payload_stripped_without_consent(self):
        """last_location-only payload stripped when no consent."""
        payload = {"last_location": {"lat": 12.0, "lng": 77.0}}
        out = _sanitize_location(payload, _link(temp_location=False), _journey())
        assert "last_location" not in out


# ═════════════════════════════════════════════════════════════════════════════
# 3. Pure unit tests — _public_alert
# ═════════════════════════════════════════════════════════════════════════════

class TestPublicAlert:

    def test_eligible_gets_full_payload_and_token(self):
        out = _public_alert(_alert(), _link(), _journey())
        assert out["access_revoked"] is False
        assert out["payload"].get("destination") == "MG Road, Bengaluru"
        assert "last_location" in out["payload"]
        assert out["journey_token"] == JOURNEY_TOKEN

    def test_no_temp_location_consent_strips_location_fields(self):
        out = _public_alert(_alert(), _link(temp_location=False), _journey())
        assert out["access_revoked"] is False  # type-perm (journey_status) still granted
        assert "destination" not in out["payload"]
        assert "last_location" not in out["payload"]

    def test_no_temp_location_consent_withholds_journey_token(self):
        """journey_token is a bearer credential — must not be given without temp_location."""
        out = _public_alert(_alert(), _link(temp_location=False), _journey())
        assert out["journey_token"] is None

    def test_type_permission_denied_gives_no_payload_no_token(self):
        """Non-accepted link → access_revoked=True, payload={}, journey_token=None."""
        out = _public_alert(_alert(), _link(status="declined"), _journey())
        assert out["access_revoked"] is True
        assert out["payload"] == {}
        assert out["journey_token"] is None
        assert out["state"] == "ACCESS_REVOKED"

    def test_safe_journey_strips_location_and_withholds_token(self):
        out = _public_alert(_alert(), _link(), _journey(status="safe"))
        assert "destination" not in out["payload"]
        assert "last_location" not in out["payload"]
        assert out["journey_token"] is None

    def test_revoked_journey_strips_location_and_withholds_token(self):
        out = _public_alert(_alert(), _link(), _journey(revoked=True))
        assert "destination" not in out["payload"]
        assert "last_location" not in out["payload"]
        assert out["journey_token"] is None

    def test_non_location_fields_preserved_without_location_consent(self):
        out = _public_alert(_alert(), _link(temp_location=False), _journey())
        assert "eta" in out["payload"]
        assert "journey_status" in out["payload"]

    def test_no_link_revokes_all(self):
        out = _public_alert(_alert(), None, _journey())
        assert out["access_revoked"] is True
        assert out["payload"] == {}
        assert out["journey_token"] is None

    def test_required_fields_always_present(self):
        out = _public_alert(_alert(), _link(), _journey())
        for field in ("id", "type", "title", "created_at", "state", "access_revoked"):
            assert field in out, f"missing required field: {field}"


# ═════════════════════════════════════════════════════════════════════════════
# 4. Route-level tests — list_alerts  (GET /api/alerts)
# ═════════════════════════════════════════════════════════════════════════════

class TestListAlertsEndpoint:

    @pytest.mark.asyncio
    async def test_eligible_gets_location_in_list(self):
        db = _mock_db_for_list(
            alerts=[_alert()],
            links=[_link()],
            journeys=[_journey()],
        )
        with patch.object(ar_module, "db", db):
            result = await list_alerts(filter="all", user=RECIPIENT)
        assert len(result) == 1
        payload = result[0]["payload"]
        assert payload.get("destination") == "MG Road, Bengaluru"
        assert "last_location" in payload

    @pytest.mark.asyncio
    async def test_no_consent_strips_location_in_list(self):
        db = _mock_db_for_list(
            alerts=[_alert()],
            links=[_link(temp_location=False)],
            journeys=[_journey()],
        )
        with patch.object(ar_module, "db", db):
            result = await list_alerts(filter="all", user=RECIPIENT)
        assert len(result) == 1
        payload = result[0]["payload"]
        assert "last_location" not in payload
        assert "destination" not in payload

    @pytest.mark.asyncio
    async def test_no_consent_withholds_token_in_list(self):
        db = _mock_db_for_list(
            alerts=[_alert()],
            links=[_link(temp_location=False)],
            journeys=[_journey()],
        )
        with patch.object(ar_module, "db", db):
            result = await list_alerts(filter="all", user=RECIPIENT)
        assert result[0]["journey_token"] is None

    @pytest.mark.asyncio
    async def test_safe_journey_strips_location_in_list(self):
        db = _mock_db_for_list(
            alerts=[_alert()],
            links=[_link()],
            journeys=[_journey(status="safe")],
        )
        with patch.object(ar_module, "db", db):
            result = await list_alerts(filter="all", user=RECIPIENT)
        payload = result[0]["payload"]
        assert "last_location" not in payload
        assert "destination" not in payload

    @pytest.mark.asyncio
    async def test_revoked_journey_strips_location_in_list(self):
        db = _mock_db_for_list(
            alerts=[_alert()],
            links=[_link()],
            journeys=[_journey(revoked=True)],
        )
        with patch.object(ar_module, "db", db):
            result = await list_alerts(filter="all", user=RECIPIENT)
        payload = result[0]["payload"]
        assert "last_location" not in payload
        assert "destination" not in payload

    @pytest.mark.asyncio
    async def test_missing_link_revokes_alert_in_list(self):
        """Alert with no live link record in DB → access_revoked=True, payload={}."""
        db = _mock_db_for_list(
            alerts=[_alert()],
            links=[],           # link deleted / never stored
            journeys=[_journey()],
        )
        with patch.object(ar_module, "db", db):
            result = await list_alerts(filter="all", user=RECIPIENT)
        assert result[0]["access_revoked"] is True
        assert result[0]["payload"] == {}

    @pytest.mark.asyncio
    async def test_per_alert_isolation_in_list(self):
        """Two alerts sharing one link: one with open journey, one with revoked journey.
        Each must be sanitized independently — the open alert must not be redacted
        just because the other journey is closed."""
        alert_open   = _alert()
        alert_closed = dict(_alert())
        alert_closed["id"]            = "alert-closed"
        alert_closed["journey_token"] = "CLOSED_TOKEN"

        j_open   = _journey()
        j_closed = dict(_journey(revoked=True))
        j_closed["token"] = "CLOSED_TOKEN"

        db = _mock_db_for_list(
            alerts=[alert_open, alert_closed],
            links=[_link()],
            journeys=[j_open, j_closed],
        )
        with patch.object(ar_module, "db", db):
            results = await list_alerts(filter="all", user=RECIPIENT)
        assert len(results) == 2

        r_open   = next(r for r in results if r["id"] == ALERT_ID)
        r_closed = next(r for r in results if r["id"] == "alert-closed")

        # Open journey alert — location must be visible
        assert "last_location" in r_open["payload"]
        assert r_open["payload"].get("destination") == "MG Road, Bengaluru"

        # Closed journey alert — location must be stripped
        assert "last_location" not in r_closed["payload"]
        assert "destination"   not in r_closed["payload"]

    @pytest.mark.asyncio
    async def test_empty_alert_list_returns_empty(self):
        db = _mock_db_for_list(alerts=[], links=[], journeys=[])
        with patch.object(ar_module, "db", db):
            result = await list_alerts(filter="all", user=RECIPIENT)
        assert result == []


# ═════════════════════════════════════════════════════════════════════════════
# 5. Route-level tests — get_alert  (GET /api/alerts/{alert_id})
# ═════════════════════════════════════════════════════════════════════════════

class TestGetAlertEndpoint:

    @pytest.mark.asyncio
    async def test_eligible_gets_full_location_in_detail(self):
        db = _mock_db_for_detail(
            alert=_alert(), link=_link(), journey=_journey(),
        )
        with patch.object(ar_module, "db", db):
            result = await get_alert(ALERT_ID, user=RECIPIENT)
        assert result["payload"].get("destination") == "MG Road, Bengaluru"
        assert "last_location" in result["payload"]

    @pytest.mark.asyncio
    async def test_eligible_gets_journey_token_in_detail(self):
        db = _mock_db_for_detail(
            alert=_alert(), link=_link(), journey=_journey(),
        )
        with patch.object(ar_module, "db", db):
            result = await get_alert(ALERT_ID, user=RECIPIENT)
        assert result["journey_token"] == JOURNEY_TOKEN

    @pytest.mark.asyncio
    async def test_no_consent_strips_location_in_detail(self):
        db = _mock_db_for_detail(
            alert=_alert(), link=_link(temp_location=False), journey=_journey(),
        )
        with patch.object(ar_module, "db", db):
            result = await get_alert(ALERT_ID, user=RECIPIENT)
        assert "destination" not in result["payload"]
        assert "last_location" not in result["payload"]

    @pytest.mark.asyncio
    async def test_no_consent_withholds_token_in_detail(self):
        db = _mock_db_for_detail(
            alert=_alert(), link=_link(temp_location=False), journey=_journey(),
        )
        with patch.object(ar_module, "db", db):
            result = await get_alert(ALERT_ID, user=RECIPIENT)
        assert result["journey_token"] is None

    @pytest.mark.asyncio
    async def test_safe_journey_strips_location_in_detail(self):
        db = _mock_db_for_detail(
            alert=_alert(), link=_link(), journey=_journey(status="safe"),
        )
        with patch.object(ar_module, "db", db):
            result = await get_alert(ALERT_ID, user=RECIPIENT)
        assert "destination" not in result["payload"]
        assert "last_location" not in result["payload"]
        assert result["journey_token"] is None

    @pytest.mark.asyncio
    async def test_revoked_journey_strips_location_in_detail(self):
        db = _mock_db_for_detail(
            alert=_alert(), link=_link(), journey=_journey(revoked=True),
        )
        with patch.object(ar_module, "db", db):
            result = await get_alert(ALERT_ID, user=RECIPIENT)
        assert "destination" not in result["payload"]
        assert "last_location" not in result["payload"]
        assert result["journey_token"] is None

    @pytest.mark.asyncio
    async def test_no_link_revokes_in_detail(self):
        db = _mock_db_for_detail(alert=_alert(), link=None, journey=_journey())
        with patch.object(ar_module, "db", db):
            result = await get_alert(ALERT_ID, user=RECIPIENT)
        assert result["access_revoked"] is True
        assert result["payload"] == {}
        assert result["journey_token"] is None

    @pytest.mark.asyncio
    async def test_wrong_recipient_raises_403(self):
        from fastapi import HTTPException
        impostor = {"id": "impostor-999", "name": "Evil"}
        db = _mock_db_for_detail(alert=_alert())
        with patch.object(ar_module, "db", db):
            with pytest.raises(HTTPException) as exc:
                await get_alert(ALERT_ID, user=impostor)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_nonexistent_alert_raises_404(self):
        from fastapi import HTTPException
        db = _mock_db_for_detail(alert=None)
        with patch.object(ar_module, "db", db):
            with pytest.raises(HTTPException) as exc:
                await get_alert("does-not-exist", user=RECIPIENT)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_detail_list_consistency_no_consent(self):
        """Detail and list must apply IDENTICAL sanitization for the same
        alert + link (no temp_location) + open journey combination."""
        alert   = _alert()
        link    = _link(temp_location=False)
        journey = _journey()

        db_detail = _mock_db_for_detail(alert=alert, link=link, journey=journey)
        db_list   = _mock_db_for_list(alerts=[alert], links=[link], journeys=[journey])

        with patch.object(ar_module, "db", db_detail):
            detail_result = await get_alert(ALERT_ID, user=RECIPIENT)
        with patch.object(ar_module, "db", db_list):
            list_results = await list_alerts(filter="all", user=RECIPIENT)
        list_result = list_results[0]

        for key in ("destination", "last_location"):
            assert key not in detail_result["payload"], f"detail leaked {key}"
            assert key not in list_result["payload"],   f"list leaked {key}"
        assert detail_result["journey_token"] is None, "detail leaked journey_token"
        assert list_result["journey_token"] is None,   "list leaked journey_token"

    @pytest.mark.asyncio
    async def test_detail_list_consistency_eligible(self):
        """Detail and list must BOTH show full location for an eligible recipient."""
        alert   = _alert()
        link    = _link()
        journey = _journey()

        db_detail = _mock_db_for_detail(alert=alert, link=link, journey=journey)
        db_list   = _mock_db_for_list(alerts=[alert], links=[link], journeys=[journey])

        with patch.object(ar_module, "db", db_detail):
            detail_result = await get_alert(ALERT_ID, user=RECIPIENT)
        with patch.object(ar_module, "db", db_list):
            list_results = await list_alerts(filter="all", user=RECIPIENT)
        list_result = list_results[0]

        for key in ("destination", "last_location"):
            assert key in detail_result["payload"], f"detail missing {key}"
            assert key in list_result["payload"],   f"list missing {key}"
        assert detail_result["journey_token"] == JOURNEY_TOKEN, "detail missing journey_token"
        assert list_result["journey_token"] == JOURNEY_TOKEN,   "list missing journey_token"
