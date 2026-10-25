"""
test_pr1a_route_level.py
Route-level tests — Updated for PR-1B1: Guardian static privacy notice.

PR-1B1 intentional semantic changes (previously documented in journey_router.py
docstring; reproduced here for test-suite continuity):

  1. HTTP 404 for an unknown token  → HTTP 200
     Returning 404 would confirm the token has no matching journey.
     All token values must receive an identical response.

  2. HTTP 410 for an expired journey → HTTP 200
     Returning 410 would disclose expiry state, which requires a DB lookup
     and implicitly confirms token validity.  No DB query is performed now.

  3. Traveller name, generic destination label ("Destination on file"),
     started-at / check-in / safe-at timestamps, status labels, and a
     30-second meta-refresh tag were previously returned for valid tokens.
     None of those are disclosed after PR-1B1.

  4. The PR-1A "Location is unavailable through this shared link." notice
     is superseded; the route now returns a single generic privacy notice.

Helper functions _status_html, _expired_html, _not_found_html are retained
as tested pure functions (test_pr1a_guardian_containment.py still passes
unchanged) but are no longer called by journey_status_page.

The route handler is called directly — no running server, no live HTTP,
no real database, no accounts, no outbound transports.
"""
from __future__ import annotations

import sys
import os
import re
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr_module

# ── Sensitive test values (never interpolated into assert messages) ─────────────

_DEST_ADDR    = "14 MG Road, Fort, Mumbai 400001"
_DEST_COORDS  = "19.0760,72.8777"
_LAT          = 19.0760
_LNG          = 72.8777
_TOKEN        = "ROUTETEST"
_RANDOM_TOKEN = "XGARBAGEX99ZZ"

def _coord_re() -> re.Pattern:
    return re.compile(r"19\.07\d+|72\.87\d+")

# ── Time helpers ──────────────────────────────────────────────────────

def _fut(mins: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=mins)).isoformat()

def _ago(mins: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=mins)).isoformat()

# ── Record builders (used only for the no-DB-call verification test) ───────

def _base_rec() -> dict:
    return {
        "token":               _TOKEN,
        "user_display":        "Priya",
        "destination":         _DEST_ADDR,
        "started_at":          _ago(30),
        "expected_checkin_at": _fut(30),
        "expires_at":          _fut(1440),
        "status":              "in_progress",
        "sharing_revoked_at":  None,
        "safe_at":             None,
        "last_location": {
            "lat": _LAT, "lng": _LNG,
            "area": "Fort, Mumbai", "accuracy": 15.0,
        },
    }

# ── Assertion helpers ─────────────────────────────────────────────────

def _get_html(response) -> str:
    if hasattr(response, "body"):
        return response.body.decode()
    return str(response)

def _assert_private_notice(html: str) -> None:
    """PR-1B1: the generic privacy notice must be present in every response."""
    assert "Journey details are private" in html, \
        "Generic privacy-notice heading missing"
    assert "Open DHARA and sign in" in html, \
        "Sign-in prompt missing from privacy notice"

def _assert_no_journey_metadata(html: str) -> None:
    """No name, destination, timestamp labels, status labels, or refresh tag."""
    assert "Priya"                        not in html, "Traveller name leaked"
    assert "14 MG Road"                  not in html, "Street address leaked"
    assert "Destination on file"         not in html, "Destination label leaked"
    for label in [
        "Journey in progress", "Arrived safely",
        "Sharing turned off",  "Check-in overdue",
    ]:
        assert label                     not in html, f"Status label leaked: {label}"
    for label in ["Journey started", "Expected check-in", "Marked safe at"]:
        assert label                     not in html, f"Timestamp label leaked: {label}"
    assert 'http-equiv="refresh"'        not in html, "Auto-refresh tag leaked"
    assert "http-equiv='refresh'"        not in html, "Auto-refresh tag leaked"

def _assert_no_location(html: str) -> None:
    assert not _coord_re().search(html),         "Numeric coordinates leaked"
    assert "Fort, Mumbai" not in html,           "Area name leaked via location"
    for tok in ["leaflet", "tile.openstreetmap.org", "L.map(", "L.marker("]:
        assert tok not in html,                  "Map token leaked"


# ── Route-level tests ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_r1_valid_token_returns_200_with_notice():
    """A token that would previously match an active journey returns HTTP 200
    with the generic privacy notice."""
    response = await jr_module.journey_status_page(_TOKEN)
    assert response.status_code == 200
    _assert_private_notice(_get_html(response))


@pytest.mark.asyncio
async def test_r2_unknown_token_returns_200_not_404():
    """PR-1B1 semantic change: unknown tokens no longer return HTTP 404.
    A 404 would confirm the token has no matching journey (existence leak).
    The generic notice is identical for valid and invalid tokens."""
    response = await jr_module.journey_status_page(_RANDOM_TOKEN)
    assert response.status_code == 200, (
        f"Expected 200 (no existence confirmation), got {response.status_code}"
    )
    _assert_private_notice(_get_html(response))


@pytest.mark.asyncio
async def test_r3_expired_token_returns_200_not_410():
    """PR-1B1 semantic change: the handler no longer reads the DB so it
    cannot know or disclose expiry state.  Expired tokens get HTTP 200."""
    response = await jr_module.journey_status_page(_TOKEN)
    assert response.status_code == 200, (
        f"Expected 200 (no expiry disclosure), got {response.status_code}"
    )
    _assert_private_notice(_get_html(response))


@pytest.mark.asyncio
async def test_r4_no_traveller_name_in_response():
    """Traveller name never disclosed to anonymous visitors after PR-1B1."""
    response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    assert "Priya" not in html, "Traveller name leaked"
    _assert_private_notice(html)


@pytest.mark.asyncio
async def test_r5_no_destination_in_response():
    """Destination (address, generic label, or coordinate string) not disclosed."""
    response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    assert "14 MG Road"         not in html, "Street address leaked"
    assert "Destination on file" not in html, "Destination label leaked"
    assert _DEST_COORDS          not in html, "Coordinate-as-destination leaked"
    _assert_private_notice(html)


@pytest.mark.asyncio
async def test_r6_no_status_labels_in_response():
    """Status labels for all journey states are not disclosed."""
    response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    for label in [
        "Journey in progress", "Arrived safely",
        "Sharing turned off",  "Check-in overdue",
    ]:
        assert label not in html, f"Status label leaked: {label}"
    _assert_private_notice(html)


@pytest.mark.asyncio
async def test_r7_no_timestamp_labels_in_response():
    """Timestamp field headings (Journey started, Expected check-in, Marked
    safe at) are not disclosed."""
    response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    for label in ["Journey started", "Expected check-in", "Marked safe at"]:
        assert label not in html, f"Timestamp label leaked: {label}"
    _assert_private_notice(html)


@pytest.mark.asyncio
async def test_r8_no_location_in_response():
    """No coordinates, area names, or map/tile artefacts in the response."""
    response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    _assert_no_location(html)
    _assert_private_notice(html)


@pytest.mark.asyncio
async def test_r9_no_auto_refresh_in_response():
    """PR-1B1: the static page carries no journey-derived 30-second refresh."""
    response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    assert 'http-equiv="refresh"'  not in html, "Auto-refresh tag leaked"
    assert "http-equiv='refresh'"  not in html, "Auto-refresh tag (single-quote form) leaked"
    _assert_private_notice(html)


@pytest.mark.asyncio
async def test_r10_no_db_query_made():
    """PR-1B1: the handler must NOT query the database for any token value."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_base_rec())
        response = await jr_module.journey_status_page(_TOKEN)
    mock_db.safety_journeys.find_one.assert_not_called()
    assert response.status_code == 200
    _assert_private_notice(_get_html(response))


@pytest.mark.asyncio
async def test_r11_token_not_echoed_in_response():
    """Token value must not appear anywhere in the HTML body."""
    response = await jr_module.journey_status_page(_TOKEN)
    assert _TOKEN not in _get_html(response), "Journey token echoed in HTML"


@pytest.mark.asyncio
async def test_r12_forwarded_token_identical_response():
    """Forwarded / reused token produces the same static HTML on every call."""
    r1 = await jr_module.journey_status_page(_TOKEN)
    r2 = await jr_module.journey_status_page(_TOKEN)
    h1, h2 = _get_html(r1), _get_html(r2)
    assert h1 == h2, "Static response must be identical on repeat calls"
    _assert_private_notice(h1)


@pytest.mark.asyncio
async def test_r13_comprehensive_no_metadata_no_location():
    """Combined: verify the full set of no-disclosure requirements in one pass."""
    response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    _assert_private_notice(html)
    _assert_no_journey_metadata(html)
    _assert_no_location(html)
    assert response.status_code == 200
