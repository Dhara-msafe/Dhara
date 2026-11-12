"""
Head Out — /api/geo/directions (live route line / ETA).

N-02 (B-40): this endpoint now also requires an authenticated session
(current_user — a real account OR a guest token). Unlike the other geo
endpoints, an under-cap, authenticated call must always get a usable
result — Directions is deliberately fail-OPEN to an approximate
straight-line estimate when FEATURE_GOOGLE_DIRECTIONS_V1/key aren't
configured (an active safety journey's map must never go blank), so these
tests check 200 + provider == "approximate" in the current (flag-off)
default state, alongside the new 401-when-unauthenticated contract.
"""
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/') or "https://dhara-shield-2.preview.emergentagent.com"

# Two points a short walk apart in Mumbai — enough to get a non-zero distance.
ORIGIN_LAT, ORIGIN_LNG = 19.0760, 72.8777
DEST_LAT, DEST_LNG = 19.0790, 72.8810


@pytest.fixture
def api_client():
    return requests.Session()


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


_PARAMS = {
    "origin_lat": ORIGIN_LAT, "origin_lng": ORIGIN_LNG,
    "dest_lat": DEST_LAT, "dest_lng": DEST_LNG,
}


class TestDirectionsRequiresAuth:
    def test_without_token_is_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/directions", params=_PARAMS)
        assert r.status_code == 401

    def test_invalid_token_is_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geo/directions", params=_PARAMS,
                            headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401


class TestDirectionsFailsOpenWhenAuthenticated:
    def test_returns_approximate_route_by_default(self, api_client, auth_header):
        r = api_client.get(f"{BASE_URL}/api/geo/directions", params=_PARAMS, headers=auth_header)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "polyline" in data and "distance_meters" in data and "duration_seconds" in data
        # Default/unconfigured state (no .env in this repo checkout) -> approximate.
        # If a deployment has the real flag+key on, "google" is also acceptable.
        assert data["provider"] in ("approximate", "google")
        assert data["distance_meters"] > 0

    def test_validation_still_runs_with_auth(self, api_client, auth_header):
        bad_params = dict(_PARAMS, origin_lat=999)
        r = api_client.get(f"{BASE_URL}/api/geo/directions", params=bad_params, headers=auth_header)
        assert r.status_code == 422
