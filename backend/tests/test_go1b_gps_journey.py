"""
GO1B GPS Journey Tests
Covers:
  - POST /api/journey/status (create)
  - PATCH /api/journey/status/{token}/location (update location)
  - Server-side throttle (second update within 25s)
  - GET /api/journey/status/{token} (HTML page shows last known area)
  - IDOR: user B cannot update user A's journey
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"

USER_A_EMAIL = "voicetest2026@example.com"
USER_A_PASS  = "TestPass123!"
USER_B_EMAIL = "fir-test-user2@example.com"
USER_B_PASS  = "TestPass456!"


@pytest.fixture(scope="module")
def session():
    return requests.Session()


@pytest.fixture(scope="module")
def token_a(session):
    """Login as user A and return auth token."""
    r = session.post(f"{API}/auth/login", json={"email": USER_A_EMAIL, "password": USER_A_PASS})
    assert r.status_code == 200, f"Login user A failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def token_b(session):
    """Login as user B and return auth token."""
    r = session.post(f"{API}/auth/login", json={"email": USER_B_EMAIL, "password": USER_B_PASS})
    if r.status_code != 200:
        pytest.skip(f"User B login failed: {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def journey_token_a(session, token_a):
    """Create a journey as user A, return the journey token."""
    r = session.post(
        f"{API}/journey/status",
        json={"destination": "TEST_MG Road", "duration_mins": 30},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert r.status_code == 201, f"Create journey failed: {r.text}"
    data = r.json()
    assert "token" in data
    assert "status_url" in data
    return data["token"]


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestCreateJourney:
    def test_create_journey_success(self, session, token_a):
        r = session.post(
            f"{API}/journey/status",
            json={"destination": "TEST_Office", "duration_mins": 60},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert "token" in data
        assert "status_url" in data
        assert data["status_url"].startswith("/api/journey/status/")

    def test_create_journey_requires_auth(self, session):
        r = session.post(f"{API}/journey/status", json={"destination": "Home", "duration_mins": 30})
        assert r.status_code in (401, 403), r.text

    def test_create_journey_validation(self, session, token_a):
        # Missing destination
        r = session.post(
            f"{API}/journey/status",
            json={"duration_mins": 30},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert r.status_code == 422, r.text


class TestLocationUpdate:
    def test_location_update_success(self, session, token_a, journey_token_a):
        r = session.patch(
            f"{API}/journey/status/{journey_token_a}/location",
            json={"lat": 12.9716, "lng": 77.5946, "accuracy": 15, "area": "MG Road, Bengaluru"},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        # Should not be throttled on first call
        assert "skipped" not in data or data.get("skipped") != "throttled"

    def test_location_throttle(self, session, token_a, journey_token_a):
        """Immediate second update within 25s should be throttled."""
        r = session.patch(
            f"{API}/journey/status/{journey_token_a}/location",
            json={"lat": 12.9720, "lng": 77.5950, "accuracy": 10, "area": "Brigade Road"},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("skipped") == "throttled", f"Expected throttled, got: {data}"

    def test_location_requires_auth(self, session, journey_token_a):
        r = session.patch(
            f"{API}/journey/status/{journey_token_a}/location",
            json={"lat": 12.9716, "lng": 77.5946},
        )
        assert r.status_code in (401, 403), r.text

    def test_location_not_found(self, session, token_a):
        r = session.patch(
            f"{API}/journey/status/NONEXISTENT123/location",
            json={"lat": 12.9716, "lng": 77.5946},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert r.status_code == 404, r.text

    def test_idor_user_b_cannot_update_user_a_journey(self, session, token_b, journey_token_a):
        """User B must get 403 trying to update user A's journey."""
        r = session.patch(
            f"{API}/journey/status/{journey_token_a}/location",
            json={"lat": 13.0, "lng": 77.6, "accuracy": 20, "area": "Somewhere"},
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert r.status_code == 403, f"Expected 403 IDOR protection, got {r.status_code}: {r.text}"


class TestHTMLStatusPage:
    def test_html_page_shows_last_known_area(self, session, token_a, journey_token_a):
        """After location update, GET HTML page must contain 'Last known area' and area name."""
        # Verify the location was saved (first update in test above)
        r = session.get(f"{API}/journey/status/{journey_token_a}")
        assert r.status_code == 200, r.text
        html = r.text
        assert "Last known area" in html, "HTML does not contain 'Last known area' section"
        assert "MG Road, Bengaluru" in html, "HTML does not contain the area name"

    def test_html_page_not_found(self, session):
        r = session.get(f"{API}/journey/status/BADTOKEN9999")
        assert r.status_code == 404, r.text

    def test_html_page_is_html(self, session, journey_token_a):
        r = session.get(f"{API}/journey/status/{journey_token_a}")
        assert "text/html" in r.headers.get("content-type", ""), r.headers
