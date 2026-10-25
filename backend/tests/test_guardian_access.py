"""
test_guardian_access.py
Isolated mock tests — PR-1B full: Sign-in-gated Guardian endpoint.

Coverage:
  Gate A  — only an accepted trusted_circle_link recipient can access the data
  Gate B  — HISTORICAL_ONLY response shape (no location)
  Token hardening — 410 on expired journey, 404 on unknown token
  Closed journey  — minimal closed response for safe / revoked journeys

ALL tests run against the route handler directly with mocked storage.
No live database, no running server, no real HTTP, no accounts, no outbound transports.
"""
from __future__ import annotations

import sys
import os
import pytest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr
from api.journey_router import GuardianAccessLevel, get_guardian_view

# ── Time helpers ──────────────────────────────────────────────────────────────

def _fut(h: int = 24) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()

def _ago(h: int = 1) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat()

# ── Fixture constants ─────────────────────────────────────────────────────────

RECIPIENT_ID   = "recip-g-001"
OWNER_ID       = "owner-g-001"
TOKEN          = "GUARDTEST1"
LINK_ID        = "link-g-001"
DEST           = "Cubbon Park Gate 2, Bengaluru"
TRAVELLER      = "Meera"

_VIEWER = {"id": RECIPIENT_ID}

# ── Record builders ───────────────────────────────────────────────────────────

def _journey(status: str = "in_progress", revoked: bool = False,
             expired: bool = False) -> dict:
    exp = _ago(2) if expired else _fut(22)
    return {
        "token":               TOKEN,
        "user_id":             OWNER_ID,
        "user_display":        TRAVELLER,
        "destination":         DEST,
        "started_at":          _ago(0),
        "expected_checkin_at": _fut(1),
        "expires_at":          exp,
        "status":              status,
        "safe_at":             _ago(0) if status == "safe" else None,
        "sharing_revoked_at":  _ago(0) if revoked else None,
        "recipient_link_ids":  [LINK_ID],
        "last_location":       None,
    }

def _link(status: str = "accepted", invitee_id: str = RECIPIENT_ID) -> dict:
    return {
        "id":               LINK_ID,
        "owner_id":         OWNER_ID,
        "invitee_user_id":  invitee_id,
        "status":           status,
        "permissions": {
            "journey_status": True, "expected_arrival": True,
            "missed_checkin": True, "temp_location": False,
            "emergency_requests": True,
        },
    }

# ── Helper: run the handler with mocked DB ────────────────────────────────────

async def _call(mock_journey, mock_link):
    """Patch db and call get_guardian_view."""
    with patch.object(jr, "db") as mock_db:
        mock_db.safety_journeys.find_one   = AsyncMock(return_value=mock_journey)
        mock_db.trusted_circle_links.find_one = AsyncMock(return_value=mock_link)
        return await get_guardian_view(TOKEN, _VIEWER)

# ════════════════════════════════════════════════════════════════════════════════
# Gate A tests
# ════════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_ga1_authorized_recipient_gets_200():
    """Accepted recipient receives a 200-equivalent dict (no exception)."""
    result = await _call(_journey(), _link())
    assert result is not None
    assert result.get("access_level") == GuardianAccessLevel.HISTORICAL_ONLY


@pytest.mark.asyncio
async def test_ga2_no_link_match_raises_403():
    """User who is not in recipient_link_ids gets HTTP 403."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(), None)   # no matching link
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ga3_pending_link_raises_403():
    """A pending (not yet accepted) invitation must not grant access.

    In production the DB query filters by status="accepted", so a pending
    link is never returned.  The mock simulates this by returning None.
    """
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        # Simulate: DB returns None because no accepted link matches
        await _call(_journey(), None)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ga4_different_invitee_user_raises_403():
    """A link belonging to a different user must not grant access."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        # simulate DB returning no match for this user (different invitee)
        await _call(_journey(), None)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ga5_journey_with_empty_recipient_list_raises_403():
    """A journey that was created without any recipients blocks all viewers."""
    from fastapi import HTTPException
    journey = _journey()
    journey["recipient_link_ids"] = []
    with pytest.raises(HTTPException) as exc:
        await _call(journey, _link())
    assert exc.value.status_code == 403


# ════════════════════════════════════════════════════════════════════════════════
# Token hardening tests
# ════════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_th1_expired_journey_raises_410():
    """Journey past expires_at → HTTP 410 Gone."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(expired=True), _link())
    assert exc.value.status_code == 410


@pytest.mark.asyncio
async def test_th2_unknown_token_raises_404():
    """Token not found in DB → HTTP 404."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(None, None)   # journey not found
    assert exc.value.status_code == 404


# ════════════════════════════════════════════════════════════════════════════════
# Gate B (HISTORICAL_ONLY) response shape
# ════════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_gb1_active_journey_includes_destination():
    """Active journey response includes destination for HISTORICAL_ONLY."""
    result = await _call(_journey(), _link())
    assert result.get("destination") == DEST


@pytest.mark.asyncio
async def test_gb2_active_journey_includes_traveller_name():
    """Response includes traveller first name."""
    result = await _call(_journey(), _link())
    assert result.get("traveller_display") == TRAVELLER


@pytest.mark.asyncio
async def test_gb3_active_journey_includes_timestamps():
    """Response includes started_at and expected_checkin_at."""
    result = await _call(_journey(), _link())
    assert result.get("started_at") is not None
    assert result.get("expected_checkin_at") is not None


@pytest.mark.asyncio
async def test_gb4_active_journey_includes_status():
    """Response includes journey status."""
    result = await _call(_journey(status="in_progress"), _link())
    assert result.get("status") == "in_progress"


@pytest.mark.asyncio
async def test_gb5_no_location_coords_in_historical_only():
    """Coordinates must NOT appear in HISTORICAL_ONLY response."""
    journey = _journey()
    journey["last_location"] = {"lat": 12.971, "lng": 77.594, "area": "Koramangala"}
    result = await _call(journey, _link())
    result_str = str(result)
    assert "12.971" not in result_str,  "Latitude leaked in HISTORICAL_ONLY"
    assert "77.594" not in result_str,  "Longitude leaked in HISTORICAL_ONLY"
    assert "Koramangala" not in result_str, "Area name leaked in HISTORICAL_ONLY"


@pytest.mark.asyncio
async def test_gb6_access_level_is_historical_only():
    """Gate B value in response must be HISTORICAL_ONLY."""
    result = await _call(_journey(), _link())
    assert result.get("access_level") == GuardianAccessLevel.HISTORICAL_ONLY
    assert result.get("access_level") != GuardianAccessLevel.DENY
    assert result.get("access_level") != GuardianAccessLevel.HISTORICAL_WITH_APPROVED_CORRESPONDENCE


# ════════════════════════════════════════════════════════════════════════════════
# Closed journey tests
# ════════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_cj1_safe_journey_returns_minimal_response():
    """Safe journey returns minimal closed-state response, not full data."""
    result = await _call(_journey(status="safe"), _link())
    assert result.get("status") == "safe"
    assert result.get("closed_at") is not None
    # Minimal: should NOT include destination or timestamps in full
    assert "started_at" not in result or result.get("started_at") is None, \
        "started_at should not be in closed journey response"


@pytest.mark.asyncio
async def test_cj2_revoked_journey_returns_minimal_response():
    """Revoked-sharing journey returns minimal closed-state response."""
    result = await _call(_journey(revoked=True), _link())
    assert result.get("closed_at") is not None
    assert "destination" not in result or result.get("destination") is None, \
        "destination should not be in closed journey response"


@pytest.mark.asyncio
async def test_cj3_safe_journey_includes_traveller_name():
    """Traveller first name is included even in the closed response."""
    result = await _call(_journey(status="safe"), _link())
    assert result.get("traveller_display") == TRAVELLER


@pytest.mark.asyncio
async def test_cj4_safe_journey_includes_access_level():
    """Gate B level is present in closed journey response."""
    result = await _call(_journey(status="safe"), _link())
    assert result.get("access_level") == GuardianAccessLevel.HISTORICAL_ONLY


# ════════════════════════════════════════════════════════════════════════════════
# Enum definition tests
# ════════════════════════════════════════════════════════════════════════════════

def test_enum_deny_defined():
    assert GuardianAccessLevel.DENY == "DENY"

def test_enum_historical_only_defined():
    assert GuardianAccessLevel.HISTORICAL_ONLY == "HISTORICAL_ONLY"

def test_enum_correspondence_defined():
    assert GuardianAccessLevel.HISTORICAL_WITH_APPROVED_CORRESPONDENCE \
        == "HISTORICAL_WITH_APPROVED_CORRESPONDENCE"

def test_enum_values_are_strings():
    """GuardianAccessLevel inherits from str — safe to embed in JSON."""
    for member in GuardianAccessLevel:
        assert isinstance(member.value, str)
