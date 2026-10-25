"""
test_pr1a_route_level.py
Route-level tests — PR-1A destination redaction and Guardian route checks.

Calls the async route handler directly (no running server, no live HTTP,
no real database, no accounts, no outbound transports).

The route function is called with ``await``; ``db`` is patched at the
``api.journey_router`` module level with an AsyncMock so no MongoDB
connection is attempted.

Coverage:
  R1  Active journey with synthetic street address + coord string in
      destination: neither appears in the anonymous response.
  R2  Forwarded token calls the same code path — no destination unlocked.
  R3  Browser-supplied recipient_link_id on the record does not unlock
      destination or location.
  R4  Expired journey reaches the expiry branch and returns HTTP 410.
  R5  Safe journey: no destination, no location in HTML response.
  R6  Revoked journey: no destination, no location in HTML response.
  R7  Traveller name, check-in time and status label still present
      (non-sensitive metadata preserved).
  R8  Token value is not echoed anywhere in the HTML response body.
"""
import sys
import os
import re
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr_module

# ── Time helpers (shared with existing fixture module) ────────────────────────

def _fut(mins: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=mins)).isoformat()

def _ago(mins: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=mins)).isoformat()


# ── Sensitive test values (never interpolated into assert messages) ───────────

_DEST_ADDR   = "14 MG Road, Fort, Mumbai 400001"    # street address
_DEST_COORDS = "19.0760,72.8777"                     # coord string as destination
_LAT         = 19.0760
_LNG         = 72.8777
_TOKEN       = "ROUTETEST"

def _coord_re() -> re.Pattern:
    return re.compile(r"19\.07\d+|72\.87\d+")


# ── Record factories ──────────────────────────────────────────────────────────

def _base_rec(destination: str = _DEST_ADDR) -> dict:
    return {
        "token":               _TOKEN,
        "user_display":        "Priya",
        "destination":         destination,
        "started_at":          _ago(30),
        "expected_checkin_at": _fut(30),
        "expires_at":          _fut(1440),
        "status":              "in_progress",
        "sharing_revoked_at":  None,
        "safe_at":             None,
        "last_location": {
            "lat":        _LAT,
            "lng":        _LNG,
            "area":       "Fort, Mumbai",
            "accuracy":   15.0,
            "updated_at": _ago(5),
        },
    }

def _expired_rec() -> dict:
    r = _base_rec()
    r["expires_at"] = _ago(60)
    return r

def _safe_rec() -> dict:
    r = _base_rec()
    r["status"]  = "safe"
    r["safe_at"] = _ago(2)
    return r

def _revoked_rec() -> dict:
    r = _base_rec()
    r["sharing_revoked_at"] = _ago(2)
    return r


# ── Shared response assertions ────────────────────────────────────────────────

def _get_html(response) -> str:
    """Extract text from an HTMLResponse. Works for both sync and async."""
    if hasattr(response, "body"):
        return response.body.decode()
    return str(response)

def _assert_no_destination(html: str) -> None:
    assert "14 MG Road"   not in html, "Street address leaked"
    assert "Fort, Mumbai"  not in html, "Area/suburb leaked via destination"
    assert "Mumbai 400001" not in html, "Pin code leaked"
    assert _DEST_COORDS    not in html, "Coordinate string leaked via destination"

def _assert_no_coords(html: str) -> None:
    assert not _coord_re().search(html), "Numeric coordinates leaked"

def _assert_no_map(html: str) -> None:
    for tok in ["leaflet", "tile.openstreetmap.org", "L.map(", "L.marker("]:
        assert tok not in html, f"Map token leaked (redacted)"

def _assert_location_notice(html: str) -> None:
    assert "Location is unavailable through this shared link." in html

def _assert_destination_redacted(html: str) -> None:
    assert "Destination on file" in html, "Generic destination label missing"

def _assert_non_sensitive_present(html: str) -> None:
    assert "Priya"             in html, "Traveller name missing"
    assert "Journey started"   in html, "Journey-started label missing"
    assert "Expected check-in" in html, "Check-in label missing"


# ── Route-level tests (call async handler directly) ──────────────────────────

@pytest.mark.asyncio
async def test_r1_active_journey_street_address_not_in_response():
    """R1: destination containing a full street address must not appear in HTML."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_base_rec(_DEST_ADDR))
        response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    _assert_no_destination(html)
    _assert_no_coords(html)
    _assert_no_map(html)
    _assert_location_notice(html)
    _assert_destination_redacted(html)


@pytest.mark.asyncio
async def test_r1b_destination_as_coordinate_string_not_in_response():
    """R1: destination that itself is a coordinate string must not appear."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_base_rec(_DEST_COORDS))
        response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    assert _DEST_COORDS not in html, "Coordinate-as-destination string leaked"
    _assert_no_coords(html)


@pytest.mark.asyncio
async def test_r2_forwarded_token_no_destination():
    """R2: re-using (forwarding) the same token hits the same code path — no unlock."""
    rec = _base_rec()
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=rec)
        r1 = await jr_module.journey_status_page(_TOKEN)
        r2 = await jr_module.journey_status_page(_TOKEN)
    h1, h2 = _get_html(r1), _get_html(r2)
    _assert_no_destination(h1)
    _assert_no_destination(h2)
    assert h1 == h2, "Identical record must produce identical HTML on repeat calls"


@pytest.mark.asyncio
async def test_r3_recipient_link_id_on_record_no_unlock():
    """R3: presence of recipient_link_ids in the DB record does not unlock destination."""
    rec = _base_rec()
    rec["recipient_link_ids"] = ["circle_link_abc123"]
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=rec)
        response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    _assert_no_destination(html)
    _assert_location_notice(html)
    _assert_destination_redacted(html)


@pytest.mark.asyncio
async def test_r4_expired_journey_returns_410():
    """R4: expired journey returns HTTP 410 and does not contain destination or coords."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_expired_rec())
        response = await jr_module.journey_status_page(_TOKEN)
    assert response.status_code == 410, f"Expected 410, got {response.status_code}"
    html = _get_html(response)
    _assert_no_destination(html)
    _assert_no_coords(html)
    assert "expired" in html.lower(), "Expiry message missing from 410 body"


@pytest.mark.asyncio
async def test_r5_safe_journey_no_destination_no_coords():
    """R5: safe journey discloses no destination or coordinates."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_safe_rec())
        response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    _assert_no_destination(html)
    _assert_no_coords(html)
    _assert_no_map(html)
    _assert_destination_redacted(html)
    assert "Arrived safely" in html, "Safe status label missing"


@pytest.mark.asyncio
async def test_r6_revoked_journey_no_destination_no_coords():
    """R6: revoked journey discloses no destination or coordinates."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_revoked_rec())
        response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    _assert_no_destination(html)
    _assert_no_coords(html)
    _assert_no_map(html)
    _assert_destination_redacted(html)
    assert "Sharing turned off" in html, "Revocation label missing"


@pytest.mark.asyncio
async def test_r7_non_sensitive_metadata_preserved():
    """R7: traveller name, check-in labels and status still render."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_base_rec())
        response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    _assert_non_sensitive_present(html)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_r8_token_not_echoed_in_response_body():
    """R8: the journey token must not appear anywhere in the HTML body."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=_base_rec())
        response = await jr_module.journey_status_page(_TOKEN)
    html = _get_html(response)
    assert _TOKEN not in html, "Journey token echoed in HTML body"


@pytest.mark.asyncio
async def test_r9_unknown_token_returns_404():
    """Unknown token: existing 404 behavior preserved."""
    with patch.object(jr_module, "db") as mock_db:
        mock_db.safety_journeys.find_one = AsyncMock(return_value=None)
        response = await jr_module.journey_status_page("NOSUCHTOKEN")
    assert response.status_code == 404
    html = _get_html(response)
    assert "112" in html, "Emergency number missing from 404 body"
