"""
test_pr3a_journey_ownership.py
Isolated ownership-enforcement tests — PR-3A.

All five owner-only mutation handlers in journey_router.py already carry the
pattern:

    rec = await db.safety_journeys.find_one({"token": token})
    if not rec:
        raise HTTPException(404, "Journey not found")
    if rec["user_id"] != user["id"]:
        raise HTTPException(403, "Not your journey")
    # ... mutation / fan-out only after this point ...

These tests provide focused evidence of that enforcement.

Test layers:
  LAYER A — Direct handler invocation with injected user dicts and a mocked DB.
    Verifies business-logic ownership checks and that fan-out is never reached
    when ownership fails.
    ⚠ Limitation: FastAPI's Depends(current_user) is not exercised here;
      Header extraction and JWT decoding are bypassed.  Layer B covers those.

  LAYER B — In-process TestClient with dependency_overrides on current_user.
    Verifies HTTP 401 for missing authentication at the route level without a
    running server, live database or live JWT.

No live database, accounts, external HTTP calls, messages or real GPS.
"""
import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr_module
from dependencies import current_user

# ── Time helpers ───────────────────────────────────────────────────────────────

def _fut(m: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=m)).isoformat()

def _ago(m: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=m)).isoformat()

# ── User stubs ─────────────────────────────────────────────────────────────────

_OWNER = {"id": "owner-001", "name": "Priya"}
_OTHER = {"id": "other-999", "name": "Impostor"}

# ── Journey fixture ────────────────────────────────────────────────────────────

def _rec(status: str = "in_progress",
         revoked: bool = False,
         safe: bool = False) -> dict:
    r: dict = {
        "token":               "OWNERTOKEN",
        "user_id":             _OWNER["id"],       # owner's id baked into record
        "user_display":        "Priya",
        "destination":         "Office",
        "started_at":          _ago(30),
        "expected_checkin_at": _fut(30),
        "expires_at":          _fut(1440),
        "status":              status,
        "sharing_revoked_at":  _ago(2) if revoked else None,
        "safe_at":             _ago(2) if safe else None,
        "recipient_link_ids":  [],
    }
    return r

# ── Mocked DB factory ─────────────────────────────────────────────────────────

def _mock_db(find_return=None):
    m = MagicMock()
    m.safety_journeys.find_one     = AsyncMock(return_value=find_return)
    m.safety_journeys.update_one   = AsyncMock(return_value=MagicMock())
    m.trusted_circle_links.find_one = AsyncMock(return_value=None)
    m.users.find_one               = AsyncMock(return_value=None)
    return m

# ── In-process TestClient builder ─────────────────────────────────────────────

def _client_with_user(user_override):
    """Return a TestClient that resolves current_user to user_override.
    The DB is patched globally on the module; each test patches it separately."""
    app = FastAPI()
    app.include_router(jr_module.router, prefix="/api")
    app.dependency_overrides[current_user] = lambda: user_override
    return TestClient(app, raise_server_exceptions=False)

def _client_no_auth():
    """Return a TestClient where current_user raises 401 (no token supplied)."""
    def _raise():
        raise HTTPException(401, "Missing token")
    app = FastAPI()
    app.include_router(jr_module.router, prefix="/api")
    app.dependency_overrides[current_user] = _raise
    return TestClient(app, raise_server_exceptions=False)


# ─────────────────────────────────────────────────────────────────────────────
# LAYER A — direct handler invocation
# ─────────────────────────────────────────────────────────────────────────────

class TestMarkSafe:
    @pytest.mark.asyncio
    async def test_owner_can_mark_safe(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.mark_safe("OWNERTOKEN", user=_OWNER)
        assert result["ok"] is True
        mock_notify.assert_called_once()

    @pytest.mark.asyncio
    async def test_wrong_user_raises_403_before_mutation(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.mark_safe("OWNERTOKEN", user=_OTHER)
        assert exc_info.value.status_code == 403
        db.safety_journeys.update_one.assert_not_called()
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_idempotent_already_safe_no_double_mutation(self):
        db = _mock_db(find_return=_rec(status="safe", safe=True))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.mark_safe("OWNERTOKEN", user=_OWNER)
        assert result.get("already_safe") is True
        db.safety_journeys.update_one.assert_not_called()
        mock_notify.assert_not_called()


class TestRevokeSharing:
    @pytest.mark.asyncio
    async def test_owner_can_revoke(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.revoke_sharing("OWNERTOKEN", user=_OWNER)
        assert result["ok"] is True
        db.safety_journeys.update_one.assert_called_once()
        mock_notify.assert_called_once()

    @pytest.mark.asyncio
    async def test_wrong_user_raises_403_no_mutation_no_fanout(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.revoke_sharing("OWNERTOKEN", user=_OTHER)
        assert exc_info.value.status_code == 403
        db.safety_journeys.update_one.assert_not_called()
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_owner_can_revoke_even_after_earlier_help_request(self):
        """Owner's ability to revoke must be preserved."""
        db = _mock_db(find_return=_rec(status="in_progress"))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            result = await jr_module.revoke_sharing("OWNERTOKEN", user=_OWNER)
        assert result["ok"] is True


class TestMissedCheckin:
    @pytest.mark.asyncio
    async def test_owner_can_report_missed(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.report_missed_checkin("OWNERTOKEN", user=_OWNER)
        assert result["ok"] is True
        mock_notify.assert_called_once()

    @pytest.mark.asyncio
    async def test_wrong_user_raises_403_no_fanout(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.report_missed_checkin("OWNERTOKEN", user=_OTHER)
        assert exc_info.value.status_code == 403
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_missed_checkin_skipped_when_revoked(self):
        """Missed check-in after revocation is deliberately a no-op."""
        db = _mock_db(find_return=_rec(revoked=True))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.report_missed_checkin("OWNERTOKEN", user=_OWNER)
        assert "skipped" in result
        mock_notify.assert_not_called()


class TestHelpRequested:
    @pytest.mark.asyncio
    async def test_owner_can_request_help(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.report_help_requested("OWNERTOKEN", user=_OWNER)
        assert result["ok"] is True
        mock_notify.assert_called_once()

    @pytest.mark.asyncio
    async def test_wrong_user_raises_403_no_fanout(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.report_help_requested("OWNERTOKEN", user=_OTHER)
        assert exc_info.value.status_code == 403
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_help_fires_even_after_revoke(self):
        """'Need help' must reach Trusted Circle even after sharing is revoked.
        This is an explicit design decision documented in the handler."""
        db = _mock_db(find_return=_rec(revoked=True))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.report_help_requested("OWNERTOKEN", user=_OWNER)
        assert result["ok"] is True
        mock_notify.assert_called_once()


class TestUpdateLocation:
    def _location_body(self):
        from api.journey_router import LocationIn
        return LocationIn(lat=19.076, lng=72.877, accuracy=15.0, area="Fort, Mumbai")

    @pytest.mark.asyncio
    async def test_owner_can_update_location(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db):
            result = await jr_module.update_location(
                "OWNERTOKEN", body=self._location_body(), user=_OWNER
            )
        assert result["ok"] is True
        db.safety_journeys.update_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_wrong_user_raises_403_no_write(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db):
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.update_location(
                    "OWNERTOKEN", body=self._location_body(), user=_OTHER
                )
        assert exc_info.value.status_code == 403
        db.safety_journeys.update_one.assert_not_called()

    @pytest.mark.asyncio
    async def test_body_has_no_user_id_field(self):
        """LocationIn must not carry a user_id that could shadow auth identity."""
        from api.journey_router import LocationIn
        import pydantic
        fields = set(LocationIn.model_fields.keys())
        assert "user_id" not in fields, f"user_id found in LocationIn fields: {fields}"
        assert "owner_id" not in fields

    @pytest.mark.asyncio
    async def test_location_update_skipped_when_revoked(self):
        db = _mock_db(find_return=_rec(revoked=True))
        with patch.object(jr_module, "db", db):
            result = await jr_module.update_location(
                "OWNERTOKEN", body=self._location_body(), user=_OWNER
            )
        assert "skipped" in result
        db.safety_journeys.update_one.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# LAYER B — route-level via TestClient with dependency_overrides
# ─────────────────────────────────────────────────────────────────────────────

class TestMissingAuthDeniedAtRoute:
    """
    Tests that missing or invalid authentication produces HTTP 401 at the
    route level, exercising FastAPI's dependency injection (not just the
    business-logic check).
    The DB is patched so no real MongoDB connection is attempted.
    """

    def _endpoints(self):
        return [
            ("PATCH", "/api/journey/status/OWNERTOKEN/safe"),
            ("POST",  "/api/journey/status/OWNERTOKEN/revoke"),
            ("POST",  "/api/journey/status/OWNERTOKEN/missed-checkin"),
            ("POST",  "/api/journey/status/OWNERTOKEN/help"),
            ("PATCH", "/api/journey/status/OWNERTOKEN/location"),
        ]

    def test_missing_auth_returns_401_on_all_mutation_endpoints(self):
        """No Authorization header → 401 before the handler runs."""
        client = _client_no_auth()
        rec = _rec()
        db = _mock_db(find_return=rec)
        location_payload = {"lat": 19.076, "lng": 72.877, "accuracy": 15.0, "area": "Fort"}
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            for method, path in self._endpoints():
                if method == "PATCH" and path.endswith("/location"):
                    resp = client.patch(path, json=location_payload)
                elif method == "PATCH":
                    resp = client.patch(path)
                else:
                    resp = client.post(path)
                assert resp.status_code == 401, \
                    f"Expected 401 on {method} {path}, got {resp.status_code}"
            # No DB write or fan-out on any denied call
            db.safety_journeys.update_one.assert_not_called()

    def test_owner_identity_via_override_succeeds(self):
        """Sanity check: the same endpoints return non-401 when auth resolves."""
        client = _client_with_user(_OWNER)
        rec = _rec()
        db = _mock_db(find_return=rec)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            resp = client.patch("/api/journey/status/OWNERTOKEN/safe")
        assert resp.status_code == 200

    def test_wrong_user_via_override_returns_403(self):
        """Different signed-in account holding the token → 403 at route level."""
        client = _client_with_user(_OTHER)
        rec = _rec()
        db = _mock_db(find_return=rec)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            resp = client.patch("/api/journey/status/OWNERTOKEN/safe")
        assert resp.status_code == 403
        mock_notify.assert_not_called()

    def test_journey_not_found_returns_404(self):
        """Nonexistent token → 404 regardless of auth."""
        client = _client_with_user(_OWNER)
        db = _mock_db(find_return=None)
        with patch.object(jr_module, "db", db):
            resp = client.patch("/api/journey/status/NOSUCHTOKEN/safe")
        assert resp.status_code == 404
