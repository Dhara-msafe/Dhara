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

def _link(status: str = "accepted", invitee_id: str = RECIPIENT_ID,
          journey_status: bool = True, temp_location: bool = False) -> dict:
    return {
        "id":               LINK_ID,
        "owner_id":         OWNER_ID,
        "invitee_user_id":  invitee_id,
        "status":           status,
        "permissions": {
            "journey_status":    journey_status,
            "expected_arrival":  True,
            "missed_checkin":    True,
            "temp_location":     temp_location,
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
async def test_gb1_destination_absent_without_location_permission():
    """Destination key must not appear when temp_location=False (default)."""
    result = await _call(_journey(), _link(temp_location=False))
    assert "destination" not in result, "destination present without temp_location permission"


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

# ════════════════════════════════════════════════════════════════════════════════
# Focused permission-correctness tests (authorization correction batch)
#
# DB-query modeling note: all tests use AsyncMock(return_value=X) for
# db.trusted_circle_links.find_one.  The mock bypasses real MongoDB query
# filtering.  Passing None models the expected DB return value when the query
# would find no matching document (e.g. status≠accepted, link not in journey).
# It does NOT verify that the MongoDB query itself filters those fields; the
# query predicate is visible in _guardian_access_check but is not exercised by
# these mocks.  Application-level checks (journey_status flag, temp_location
# flag) occur AFTER the mock returns and ARE verified by these tests.
# ════════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_perm1_status_permission_granted_allows_view():
    """Accepted, selected recipient with journey_status=True sees metadata."""
    result = await _call(_journey(), _link(journey_status=True))
    assert result.get("traveller_display") == TRAVELLER
    assert result.get("status") == "in_progress"
    assert result.get("access_level") == GuardianAccessLevel.HISTORICAL_ONLY


@pytest.mark.asyncio
async def test_perm2_false_status_permission_denies_metadata():
    """journey_status=False must deny; application-level check, not DB filter."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(), _link(journey_status=False))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_perm2b_missing_permissions_key_denies():
    """Missing permissions dict entirely must deny — no silent default grant."""
    from fastapi import HTTPException
    link = _link()
    del link["permissions"]
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(), link)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_perm3_status_allowed_location_denied_omits_destination():
    """journey_status=True, temp_location=False → destination key absent."""
    result = await _call(_journey(), _link(journey_status=True, temp_location=False))
    assert "destination" not in result, "destination must not appear without temp_location"
    # Other permitted metadata still present
    assert result.get("traveller_display") == TRAVELLER
    assert result.get("status") == "in_progress"


@pytest.mark.asyncio
async def test_perm3b_location_permitted_includes_destination():
    """journey_status=True, temp_location=True → destination present."""
    result = await _call(_journey(), _link(journey_status=True, temp_location=True))
    assert result.get("destination") == DEST


@pytest.mark.asyncio
async def test_perm4_not_selected_for_journey_denied():
    """Accepted contact whose link ID is not in journey.recipient_link_ids is denied.

    Mock models DB returning None (no row matched because the link's id is not
    in recipient_link_ids).  MongoDB filtering behavior is NOT verified here.
    """
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(), None)   # DB returns None → 403
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_perm5_revoked_relationship_denied():
    """Revoked/declined link must deny.

    Mock models DB returning None because the query filters status='accepted'.
    MongoDB filtering behavior is NOT verified; the application-level check on
    the returned None is what raises 403.
    """
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(), None)   # models: DB finds no accepted link
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_perm6_permission_withdrawal_affects_next_read():
    """Permission withdrawal is evaluated on every call, not cached."""
    # First read: journey_status=True → allowed
    result = await _call(_journey(), _link(journey_status=True))
    assert result.get("traveller_display") == TRAVELLER

    # Second read: journey_status removed → denied
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(), _link(journey_status=False))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_perm7_closed_journey_requires_status_permission():
    """Closed (safe) journey must not bypass journey_status permission check."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await _call(_journey(status="safe"), _link(journey_status=False))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_perm7b_closed_journey_location_denied_omits_destination():
    """Closed journey with journey_status=True, temp_location=False → no destination."""
    result = await _call(_journey(status="safe"), _link(journey_status=True, temp_location=False))
    assert "destination" not in result
    assert result.get("status") == "safe"
    assert result.get("traveller_display") == TRAVELLER


# ════════════════════════════════════════════════════════════════════════════════
# Closed-journey destination suppression with temp_location=True
# Authorization correction: temp_location must not restore destination after
# safe or sharing-revoked.  Synthetic DEST address is present in the stored
# record to confirm the value is suppressed, not merely absent from the DB row.
# ════════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_dest1_safe_journey_no_destination_with_location_permission():
    """Safe journey must not return destination even when temp_location=True.

    DEST is explicitly set in the stored record; absence in the response
    confirms suppression, not a missing DB field.
    """
    result = await _call(
        _journey(status="safe"),
        _link(journey_status=True, temp_location=True),
    )
    assert "destination" not in result, \
        f"destination must not appear in safe response; got: {result}"
    assert result.get("status") == "safe"
    assert result.get("traveller_display") == TRAVELLER


@pytest.mark.asyncio
async def test_dest2_revoked_journey_no_destination_with_location_permission():
    """Sharing-revoked journey must not return destination even when temp_location=True."""
    result = await _call(
        _journey(revoked=True),
        _link(journey_status=True, temp_location=True),
    )
    assert "destination" not in result, \
        f"destination must not appear in revoked response; got: {result}"
    assert result.get("closed_at") is not None


@pytest.mark.asyncio
async def test_dest3_active_journey_destination_present_when_permitted():
    """Active journey with journey_status=True and temp_location=True returns destination.

    Confirms the fix does not remove destination from the active path.
    """
    result = await _call(
        _journey(status="in_progress"),
        _link(journey_status=True, temp_location=True),
    )
    assert result.get("destination") == DEST
    assert result.get("status") == "in_progress"


@pytest.mark.asyncio
async def test_dest4_active_journey_no_destination_without_location_permission():
    """Active journey with temp_location=False must not include destination key."""
    result = await _call(
        _journey(status="in_progress"),
        _link(journey_status=True, temp_location=False),
    )
    assert "destination" not in result
    assert result.get("traveller_display") == TRAVELLER

