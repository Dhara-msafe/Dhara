"""
Head Out destination search — Google Places (New) autocomplete pilot.
Tests /api/geo/autocomplete, /api/geo/details (provider seam) and verifies
/api/geocode/search (existing Nominatim manual-search flow) is unaffected.

NOTE: These tests exercise the CURRENT state of FEATURE_GOOGLE_PLACES_V1 in
backend/.env. Default-off assertions run always. ON-state assertions are
skipped automatically if the flag is off (main agent/tester flips it
temporarily and re-runs).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/') or "https://dhara-shield-2.preview.emergentagent.com"
SESSION_TOKEN = "abcdefgh12345678"


@pytest.fixture
def api_client():
    session = requests.Session()
    return session


class TestGeocodeSearchUnaffected:
    """Existing manual-search flow (Nominatim) must be unaffected regardless of flag state."""

    def test_geocode_search_mumbai(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geocode/search", params={"q": "Mumbai", "limit": 5})
        assert r.status_code == 200
        data = r.json()
        assert "suggestions" in data
        assert isinstance(data["suggestions"], list)
        if data["suggestions"]:
            s = data["suggestions"][0]
            assert "label" in s and "latitude" in s and "longitude" in s


class TestGeoAutocompleteFlagState:
    """/api/geo/autocomplete behavior — reflects whatever FEATURE_GOOGLE_PLACES_V1 is right now."""

    def test_autocomplete_response(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": SESSION_TOKEN
        })
        if r.status_code == 503:
            assert r.json().get("detail") == "Places autocomplete is not enabled"
            pytest.skip("FEATURE_GOOGLE_PLACES_V1 is OFF (current/default state) — 503 confirmed correct")
        else:
            assert r.status_code == 200
            data = r.json()
            assert "suggestions" in data and "provider" in data
            assert data["provider"] in ("google", "osm")
            if data["suggestions"]:
                s = data["suggestions"][0]
                assert "place_id" in s and "main_text" in s and "provider" in s

    def test_autocomplete_invalid_session_token_when_on(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": "short"
        })
        # min_length=8 on session_token query param -> 422 regardless of flag
        assert r.status_code == 422

    def test_details_flow_when_on(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": SESSION_TOKEN
        })
        if r.status_code == 503:
            pytest.skip("FEATURE_GOOGLE_PLACES_V1 is OFF — details flow not reachable")
        data = r.json()
        if not data.get("suggestions"):
            pytest.skip("No suggestions returned to test details with")
        s = data["suggestions"][0]
        d = api_client.get(f"{BASE_URL}/api/geo/details", params={
            "place_id": s["place_id"], "session_token": SESSION_TOKEN, "provider": s["provider"]
        })
        assert d.status_code == 200
        dd = d.json()
        assert "label" in dd and "latitude" in dd and "longitude" in dd
