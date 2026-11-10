"""
Final confidence-check regression pass (iteration 111) — DHARA.
Smoke tests for: health, auth login, geo autocomplete (OSM/Google fallback),
trusted-circle list endpoint, journey status create/safe lifecycle.
Account: voicetest2026@example.com / TestPass123!
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL').rstrip('/')
EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def auth_token(api_client):
    r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data["token"]


class TestHealth:
    def test_health_ok(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"


class TestAuth:
    def test_login_success(self, auth_token):
        assert auth_token and isinstance(auth_token, str)


class TestGeo:
    def test_autocomplete_returns_provider(self, api_client):
        token = str(uuid.uuid4())
        r = api_client.get(f"{BASE_URL}/api/geo/autocomplete", params={
            "input": "Connaught Place Delhi", "session_token": token, "limit": 5,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("provider") in ("osm", "google")
        assert isinstance(data.get("suggestions"), list)

    def test_geocode_search_fallback_still_works(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/geocode/search", params={"q": "India Gate", "limit": 3})
        assert r.status_code == 200


class TestTrustedCircle:
    def test_list_accepted(self, api_client, auth_token):
        headers = {"Authorization": f"Bearer {auth_token}"}
        r = api_client.get(f"{BASE_URL}/api/trusted-circle/accepted", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_invitations_sent(self, api_client, auth_token):
        headers = {"Authorization": f"Bearer {auth_token}"}
        r = api_client.get(f"{BASE_URL}/api/trusted-circle/invitations", params={"direction": "sent"}, headers=headers)
        assert r.status_code == 200


class TestJourney:
    """Journey create -> safe lifecycle smoke test. Cleans up after itself."""

    def test_create_and_mark_safe(self, api_client, auth_token):
        headers = {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
        payload = {
            "destination": "TEST_QA Regression Backend Journey",
            "duration_mins": 30,
            "recipient_link_ids": [],
            "remind_before_mins": None,
            "auto_notify_on_no_response": True,
        }
        r = api_client.post(f"{BASE_URL}/api/journey/status", json=payload, headers=headers)
        assert r.status_code == 201, r.text
        token = r.json().get("token")
        assert token

        safe_r = api_client.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=headers)
        assert safe_r.status_code == 200
