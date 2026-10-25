"""
test_pr1a_guardian_containment.py
Isolated tests — PR-1A: Anonymous Guardian location containment.

Scope:
  - _status_html() is a pure function; tested directly with in-memory fixtures.
  - No live HTTP, no live DB, no DB writes, no outbound transports.
  - Tokens and coordinates are never printed in failure messages.

Coverage:
  1. Active journey with location present            → no location in HTML
  2. Forwarded / re-used token                       → same restriction
  3. recipient_link_ids present on record            → does not unlock location
  4. Safe journey                                    → no location
  5. Revoked journey                                 → no location
  6. No map / tile / Leaflet request                 → confirmed
  7. Non-location fields still render                → confirmed
  8. Expired path (via _expired_html)                → no location, name only
  9. Overdue status                                  → no location
 10. No last_location field on record               → notice still shown
 11. Token value not echoed in HTML body            → confirmed
"""
import sys
import os
import re
import pytest
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from api.journey_router import _status_html, _expired_html, _not_found_html


# ── Time helpers ──────────────────────────────────────────────────────────────

def _future(mins: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=mins)).isoformat()

def _past(mins: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=mins)).isoformat()


# ── Record factories ──────────────────────────────────────────────────────────
# Coordinates are deliberately unrecognisable in error output — represented
# only as variables, never interpolated into assert messages.

_TEST_LAT = 19.0760
_TEST_LNG = 72.8777
_TEST_AREA = "Mumbai Central"
_TEST_TOKEN = "TESTTKN"     # kept short; never exposed in asserts

def _make_location() -> dict:
    return {
        "lat": _TEST_LAT,
        "lng": _TEST_LNG,
        "area": _TEST_AREA,
        "accuracy": 15.0,
        "updated_at": _past(5),
    }

def _active_rec(with_location: bool = True) -> dict:
    r: dict = {
        "token": _TEST_TOKEN,
        "user_display": "Priya",
        "destination": "Office",
        "started_at": _past(30),
        "expected_checkin_at": _future(30),
        "expires_at": _future(1440),
        "status": "in_progress",
        "sharing_revoked_at": None,
        "safe_at": None,
    }
    if with_location:
        r["last_location"] = _make_location()
    return r

def _safe_rec() -> dict:
    r = _active_rec()
    r["status"] = "safe"
    r["safe_at"] = _past(2)
    return r

def _revoked_rec() -> dict:
    r = _active_rec()
    r["sharing_revoked_at"] = _past(2)
    return r

def _overdue_rec() -> dict:
    r = _active_rec()
    r["expected_checkin_at"] = _past(10)
    return r

def _expired_rec() -> dict:
    r = _active_rec()
    r["expires_at"] = _past(60)
    return r


# ── Assertions ────────────────────────────────────────────────────────────────
# None of these functions print coordinate values in messages.

_TILE_TOKENS = [
    "tile.openstreetmap.org",
    "unpkg.com/leaflet",
    "leaflet",
    "L.map(",
    "L.marker(",
    "L.circle(",
    "L.tileLayer(",
    "setView([",
]

_LOCATION_FIELD_TOKENS = [
    "Last known area",
    "±",                 # accuracy note
    "\u00b1",            # unicode ±
    "accuracy",
]

def _coord_pattern() -> re.Pattern:
    # Matches the fixture lat/lng as numeric strings
    return re.compile(
        r"19\.0\d+|72\.8\d+"
    )

def _assert_no_location_in(html: str) -> None:
    """Assert the HTML carries no location data. No coordinates in messages."""
    assert _TEST_AREA not in html,                      "Area name present in HTML"
    assert not _coord_pattern().search(html),           "Coordinates present in HTML"
    for tok in _TILE_TOKENS:
        assert tok not in html,                         f"Map/tile token in HTML: (redacted)"
    for tok in _LOCATION_FIELD_TOKENS:
        assert tok not in html,                         f"Location field token in HTML: (redacted)"

def _assert_notice(html: str) -> None:
    assert "Location is unavailable through this shared link." in html

def _assert_non_location_fields(html: str) -> None:
    assert "Priya" in html,                             "Traveller name missing"
    # Destination is redacted — the generic label must be present, not the raw value
    assert "Destination on file" in html,               "Generic destination label missing"
    assert "Destination" in html,                       "Destination field heading missing"
    assert "Journey started" in html,                   "Journey-started label missing"
    assert "Expected check-in" in html,                 "Expected check-in label missing"


# ── Test classes ──────────────────────────────────────────────────────────────

class TestLocationSuppressedInStatusHtml:
    """Direct unit tests of the pure _status_html function."""

    def test_active_journey_with_location_no_coords(self):
        html = _status_html(_active_rec(), "Journey in progress", "#d97706", "🟡")
        _assert_no_location_in(html)
        _assert_notice(html)

    def test_forwarded_token_same_suppression(self):
        """Token re-use (forwarded link) hits the same code path — no branch exists
        to distinguish a 'forwarded' call from the original recipient's call."""
        rec = _active_rec()
        html1 = _status_html(rec, "Journey in progress", "#d97706", "🟡")
        html2 = _status_html(rec, "Journey in progress", "#d97706", "🟡")
        _assert_no_location_in(html1)
        _assert_no_location_in(html2)
        assert html1 == html2,  "Identical record must yield identical HTML"

    def test_recipient_link_ids_present_does_not_unlock(self):
        """recipient_link_ids on the record must not alter the HTML output."""
        rec = _active_rec()
        rec["recipient_link_ids"] = ["circle_link_abc123", "circle_link_def456"]
        html = _status_html(rec, "Journey in progress", "#d97706", "🟡")
        _assert_no_location_in(html)
        _assert_notice(html)

    def test_safe_journey_no_location(self):
        html = _status_html(_safe_rec(), "Arrived safely", "#16a34a", "✅")
        _assert_no_location_in(html)
        _assert_notice(html)

    def test_revoked_journey_no_location(self):
        html = _status_html(_revoked_rec(), "Sharing turned off by traveller", "#6b7280", "🔒")
        _assert_no_location_in(html)
        _assert_notice(html)

    def test_overdue_journey_no_location(self):
        html = _status_html(_overdue_rec(), "Check-in overdue — please call them", "#dc2626", "🔴")
        _assert_no_location_in(html)
        _assert_notice(html)

    def test_no_last_location_field_notice_still_shown(self):
        """When the DB record has no last_location at all, the notice must still appear."""
        html = _status_html(_active_rec(with_location=False), "Journey in progress", "#d97706", "🟡")
        _assert_no_location_in(html)
        _assert_notice(html)

    def test_no_map_tile_script_in_any_state(self):
        for rec, lbl in [
            (_active_rec(), "Journey in progress"),
            (_safe_rec(), "Arrived safely"),
            (_revoked_rec(), "Sharing turned off"),
        ]:
            html = _status_html(rec, lbl, "#888", "·")
            for tok in _TILE_TOKENS:
                assert tok not in html, f"Map token found in state={rec['status']}: (redacted)"

    def test_non_location_fields_preserved(self):
        """Traveller name, destination, and timestamps must still render."""
        html = _status_html(_active_rec(), "Journey in progress", "#d97706", "🟡")
        _assert_non_location_fields(html)

    def test_token_not_echoed_in_html(self):
        html = _status_html(_active_rec(), "Journey in progress", "#d97706", "🟡")
        # Token should not appear anywhere in the HTML (never was, still isn't)
        assert _TEST_TOKEN not in html, "Journey token echoed in HTML"


class TestExpiredAndNotFoundBehaviorPreserved:
    """Expiry and 404 paths are unchanged; verified to carry no location data."""

    def test_expired_html_no_location(self):
        html = _expired_html(_expired_rec())
        assert not _coord_pattern().search(html),  "Coordinates in expired HTML"
        assert _TEST_AREA not in html,             "Area in expired HTML"
        # Expired page shows only the traveller name and a generic message
        assert "Priya" in html,                    "Traveller name missing from expired HTML"
        assert "expired" in html.lower(),          "No expiry message"

    def test_not_found_html_no_location(self):
        html = _not_found_html()
        assert not _coord_pattern().search(html),  "Coordinates in not-found HTML"
        assert _TEST_AREA not in html,             "Area in not-found HTML"
        assert "112" in html,                      "Emergency number missing"

    def test_expired_html_does_not_contain_last_location(self):
        """_expired_html never read last_location; confirm it still does not."""
        rec = _expired_rec()
        # Add a deliberately provocative location to the record
        rec["last_location"] = _make_location()
        html = _expired_html(rec)
        assert not _coord_pattern().search(html)
        assert _TEST_AREA not in html
