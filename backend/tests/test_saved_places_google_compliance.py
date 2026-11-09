"""
Saved Places — Google Places (New) storage-compliance fields.

Pure offline unit tests (no DB, no network, no live Google key needed) for:
  - SavedPlaceIn / SavedPlacePatchIn accepting the new optional
    google_place_id / coords_source fields, and rejecting an invalid
    coords_source.
  - _is_places_cache_stale(): the 30-day cache-cap rule — only Google-
    sourced coordinates (coords_source == "google") are ever subject to it;
    OSM/manual-pin coordinates, and pre-existing docs with no coords_source
    at all, are never flagged stale.

See api/safety_router.py for the full design rationale and
PLACES_CACHE_MAX_DAYS / VALID_COORDS_SOURCES constants.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.safety_router import (  # noqa: E402
    PLACES_CACHE_MAX_DAYS,
    SavedPlaceIn,
    SavedPlacePatchIn,
    _is_places_cache_stale,
)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TestSavedPlaceInValidation:
    def test_accepts_no_google_fields_unchanged_contract(self):
        """Pre-existing callers (OSM search, manual pin) that never set these
        new fields must keep working exactly as before."""
        body = SavedPlaceIn(label="Home", latitude=19.07, longitude=72.87)
        assert body.google_place_id is None
        assert body.coords_source is None

    @pytest.mark.parametrize("source", ["google", "osm", "manual"])
    def test_accepts_each_valid_coords_source(self, source):
        body = SavedPlaceIn(label="Home", coords_source=source)
        assert body.coords_source == source

    def test_rejects_invalid_coords_source(self):
        with pytest.raises(ValidationError):
            SavedPlaceIn(label="Home", coords_source="bing")

    def test_accepts_google_place_id(self):
        body = SavedPlaceIn(label="Home", google_place_id="ChIJ_test_place_id")
        assert body.google_place_id == "ChIJ_test_place_id"


class TestSavedPlacePatchInValidation:
    def test_all_new_fields_optional(self):
        body = SavedPlacePatchIn()
        assert body.google_place_id is None
        assert body.coords_source is None

    def test_rejects_invalid_coords_source(self):
        with pytest.raises(ValidationError):
            SavedPlacePatchIn(coords_source="apple_maps")


class TestPlacesCacheStaleness:
    def test_fresh_google_coords_not_stale(self):
        doc = {"coords_source": "google", "coords_cached_at": _iso(_now())}
        assert _is_places_cache_stale(doc) is False

    def test_google_coords_past_cap_are_stale(self):
        cached = _now() - timedelta(days=PLACES_CACHE_MAX_DAYS + 1)
        doc = {"coords_source": "google", "coords_cached_at": _iso(cached)}
        assert _is_places_cache_stale(doc) is True

    def test_google_coords_exactly_at_cap_not_yet_stale(self):
        """'up to 30 consecutive calendar days' — day 30 itself is still
        within the allowed cache window, staleness starts after it."""
        cached = _now() - timedelta(days=PLACES_CACHE_MAX_DAYS)
        doc = {"coords_source": "google", "coords_cached_at": _iso(cached)}
        assert _is_places_cache_stale(doc) is False

    @pytest.mark.parametrize("source", ["osm", "manual"])
    def test_non_google_sources_never_stale_regardless_of_age(self, source):
        ancient = _now() - timedelta(days=PLACES_CACHE_MAX_DAYS * 10)
        doc = {"coords_source": source, "coords_cached_at": _iso(ancient)}
        assert _is_places_cache_stale(doc) is False

    def test_missing_coords_cached_at_never_stale(self):
        doc = {"coords_source": "google", "coords_cached_at": None}
        assert _is_places_cache_stale(doc) is False

    def test_pre_existing_doc_with_no_coords_source_field_never_stale(self):
        """Docs created before this field existed must not be retroactively
        flagged — there is nothing to refresh them from."""
        doc = {"place_id": "legacy-1", "label": "Old saved place"}
        assert _is_places_cache_stale(doc) is False

    def test_unparseable_timestamp_fails_safe_not_stale(self):
        doc = {"coords_source": "google", "coords_cached_at": "not-a-date"}
        assert _is_places_cache_stale(doc) is False