"""
Nearest Help — Google Places (New) Nearby Search / Text Search.
Tests /api/geo/nearby (police/hospital) and /api/geo/search-text (Sakhi One
Stop Centres), and confirms the external-Maps-only path these replaced is
gone from the backend (that fallback now lives entirely in the frontend —
see app/women/nearest-help.tsx — there's nothing server-side to test there).

NOTE: Same convention as test_head_out_places_autocomplete.py — these
exercise the CURRENT state of FEATURE_GOOGLE_PLACES_V1 in backend/.env.
Default-off / invalid-param assertions run always (FastAPI validates query
params before the flag check, so those never depend on deployment state).
ON-state response-shape assertions are skipped automatically if the flag is
off (main agent/tester flips it temporarily and re-runs).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/') or "https://dhara-shield-2.preview.emergentagent.com"

# Mumbai — same reference point used elsewhere in this suite.
LAT, LNG = 19.0760, 72.8777


@pytest.fixture
def api_client():
    session = requests.Session()
    return session


class TestGeoNearbyValidation:
    """Query-param validation runs before the feature-flag check, so these
    always return 422 regardless of FEATURE_GOOGLE_PLACES_V1's state."""

    def test_invalid_category_rejected(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/nearby", params={
            "category": "school", "lat": LAT, "lng": LNG
        })
        assert r.status_code == 422

    def test_missing_lat_lng_rejected(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/nearby", params={"category": "police"})
        assert r.status_code == 422

    def test_out_of_range_lat_rejected(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/nearby", params={
            "category": "hospital", "lat": 999, "lng": LNG
        })
        assert r.status_code == 422

    def test_radius_out_of_bounds_rejected(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/nearby", params={
            "category": "police", "lat": LAT, "lng": LNG, "radius_meters": 1,
        })
        assert r.status_code == 422


class TestGeoNearbyFlagState:
    @pytest.mark.parametrize("category", ["police", "hospital"])
    def test_nearby_response(self, api_client, category):
        r = api_client.get(f"{BASE_URL}/api/geo/nearby", params={
            "category": category, "lat": LAT, "lng": LNG
        })
        if r.status_code == 503:
            assert r.json().get("detail") == "Nearby search is not enabled"
            pytest.skip("FEATURE_GOOGLE_PLACES_V1 is OFF (current/default state) — 503 confirmed correct")
        assert r.status_code == 200
        data = r.json()
        assert data.get("provider") == "google"  # no OSM equivalent behind this endpoint
        assert "results" in data and isinstance(data["results"], list)
        if data["results"]:
            first = data["results"][0]
            for field in ("place_id", "name", "address", "latitude", "longitude", "distance_meters"):
                assert field in first
            # Sorted nearest-first.
            distances = [res["distance_meters"] for res in data["results"]]
            assert distances == sorted(distances)


class TestGeoSearchTextValidation:
    def test_query_too_short_rejected(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/search-text", params={"query": "ab"})
        assert r.status_code == 422

    def test_missing_query_rejected(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/search-text")
        assert r.status_code == 422


class TestGeoSearchTextFlagState:
    def test_search_text_with_location(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/search-text", params={
            "query": "Sakhi One Stop Centre women", "lat": LAT, "lng": LNG,
        })
        if r.status_code == 503:
            assert r.json().get("detail") == "Text search is not enabled"
            pytest.skip("FEATURE_GOOGLE_PLACES_V1 is OFF (current/default state) — 503 confirmed correct")
        assert r.status_code == 200
        data = r.json()
        assert data.get("provider") == "google"
        assert "results" in data and isinstance(data["results"], list)
        if data["results"]:
            # Location bias was supplied — distance should be computed.
            assert data["results"][0]["distance_meters"] is not None

    def test_search_text_without_location(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/search-text", params={
            "query": "Sakhi One Stop Centre women",
        })
        if r.status_code == 503:
            pytest.skip("FEATURE_GOOGLE_PLACES_V1 is OFF — nothing further to check without a live key")
        assert r.status_code == 200
        data = r.json()
        if data["results"]:
            # No origin given — distance can't be computed, must be omitted, not guessed.
            assert data["results"][0]["distance_meters"] is None
