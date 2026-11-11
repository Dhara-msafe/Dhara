"""
Head Out destination search — Google Places (New) autocomplete pilot.
Tests /api/geo/autocomplete, /api/geo/details (provider seam) and verifies
/api/geocode/search (existing Nominatim manual-search flow) is unaffected.

NOTE: These tests exercise the CURRENT state of FEATURE_GOOGLE_PLACES_V1 in
backend/.env. Default-off assertions run always. ON-state assertions are
skipped automatically if the flag is off (main agent/tester flips it
temporarily and re-runs).

N-02 (B-40) update: /api/geo/autocomplete and /api/geo/details now require an
authenticated session (any real account OR a guest token — see
/api/auth/guest). Every call below that exercises normal behavior now sends
a guest token's Authorization header; a dedicated class at the bottom checks
the new 401-when-unauthenticated contract explicitly, since that's the
acceptance bar this change was made against.
"""
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/') or "https://dhara-shield-2.preview.emergentagent.com"
SESSION_TOKEN = "abcdefgh12345678"


@pytest.fixture
def api_client():
    session = requests.Session()
    return session


@pytest.fixture(scope="module")
def auth_header():
    r = requests.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"}, timeout=20)
    if r.status_code == 429:
        pytest.skip("guest-session throttle (429) — unrelated to this test")
    assert r.status_code == 200, r.text
    data = r.json()
    token = data["token"]
    uid = data["user"]["id"]
    yield {"Authorization": f"Bearer {token}"}
    try:
        db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        db.users.delete_one({"id": uid})
    except Exception:
        pass


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
    """/api/geo/autocomplete behavior — reflects whatever FEATURE_GOOGLE_PLACES_V1 is right now.
    All requests now send a guest token (N-02) so these keep testing the flag
    state, not the separate auth requirement — that has its own class below."""

    def test_autocomplete_response(self, api_client, auth_header):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": SESSION_TOKEN
        }, headers=auth_header)
        if r.status_code == 503:
            assert r.json().get("detail") == "Places autocomplete is not enabled"
            pytest.skip("FEATURE_GOOGLE_PLACES_V1 is OFF (current/default state) — 503 confirmed correct")
        else:
            assert r.status_code == 200
            data = r.json()
            assert "suggestions" in data and "provider" in data
            # No OSM fallback behind this pilot — a 200 means Google answered.
            assert data["provider"] == "google"
            if data["suggestions"]:
                s = data["suggestions"][0]
                assert "place_id" in s and "main_text" in s and "provider" in s

    def test_autocomplete_invalid_session_token_when_on(self, api_client, auth_header):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": "short"
        }, headers=auth_header)
        # min_length=8 on session_token query param -> 422 regardless of flag
        # (requires a valid auth header so this failure is really about the
        # session_token, not the N-02 401 the next class tests separately).
        assert r.status_code == 422

    def test_details_flow_when_on(self, api_client, auth_header):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": SESSION_TOKEN
        }, headers=auth_header)
        if r.status_code == 503:
            pytest.skip("FEATURE_GOOGLE_PLACES_V1 is OFF — details flow not reachable")
        data = r.json()
        if not data.get("suggestions"):
            pytest.skip("No suggestions returned to test details with")
        s = data["suggestions"][0]
        d = api_client.get(f"{BASE_URL}/api/geo/details", params={
            "place_id": s["place_id"], "session_token": SESSION_TOKEN, "provider": s["provider"]
        }, headers=auth_header)
        assert d.status_code == 200
        dd = d.json()
        assert "label" in dd and "latitude" in dd and "longitude" in dd


class TestGeoAutocompleteRequiresAuth:
    """N-02 (B-40): no Authorization header at all -> 401, regardless of the
    feature flag's state or whether the query params are otherwise valid."""

    def test_autocomplete_without_token_is_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": SESSION_TOKEN
        })
        assert r.status_code == 401

    def test_details_without_token_is_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/details", params={
            "place_id": "anything", "session_token": SESSION_TOKEN, "provider": "google"
        })
        assert r.status_code == 401

    def test_invalid_token_is_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Mumbai", "session_token": SESSION_TOKEN
        }, headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401
