"""
Tests for:
- AQF Phase 2: FEATURE_MATTER_CONTEXT_V2=true — chat endpoint smoke test
- S3 Phase 2: Journey status APIs (create, HTML page, mark safe, IDOR)
"""
import pytest
import requests

from _guardian_contract import assert_private_page
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://dhara-shield-2.preview.emergentagent.com")

PRIMARY_EMAIL = "voicetest2026@example.com"
PRIMARY_PASS  = "TestPass123!"
SECONDARY_EMAIL = "fir-test-user2@example.com"
SECONDARY_PASS  = "TestPass456!"


@pytest.fixture(scope="module")
def primary_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def secondary_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": SECONDARY_EMAIL, "password": SECONDARY_PASS})
    if r.status_code != 200:
        # Try to register
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": SECONDARY_EMAIL, "password": SECONDARY_PASS, "name": "Cross Test User"
        })
        if reg.status_code in (200, 201):
            r2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": SECONDARY_EMAIL, "password": SECONDARY_PASS})
            assert r2.status_code == 200
            return r2.json()["token"]
        pytest.skip("Secondary user unavailable")
    return r.json()["token"]


# ── AQF Phase 2 ────────────────────────────────────────────────────────────────

class TestAQFPhase2:
    """FEATURE_MATTER_CONTEXT_V2=true — verify backend is running and chat responds"""

    def test_health_check(self):
        r = requests.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        print(f"Health: {r.json()}")

    def test_chat_stream_returns_response(self, primary_token):
        """POST /api/chat/stream with a simple legal question — expect 200"""
        r = requests.post(
            f"{BASE_URL}/api/chat/stream",
            json={"message": "What is Section 498A?", "session_id": "test-aqf-phase2"},
            headers={"Authorization": f"Bearer {primary_token}"},
            stream=True,
            timeout=30,
        )
        assert r.status_code == 200, f"Chat stream failed: {r.text[:500]}"
        # Read first chunk to verify streaming works
        first_chunk = b""
        for chunk in r.iter_content(chunk_size=512):
            first_chunk = chunk
            break
        assert len(first_chunk) > 0, "No data from chat stream"
        print(f"Chat stream first chunk: {first_chunk[:200]}")


# ── Journey Status APIs ────────────────────────────────────────────────────────

class TestJourneyStatus:
    """S3 Phase 2 — Guardian Journey Status Page"""

    journey_token = None
    status_url    = None

    def test_create_journey(self, primary_token):
        r = requests.post(
            f"{BASE_URL}/api/journey/status",
            json={"destination": "Test Office", "duration_mins": 45},
            headers={"Authorization": f"Bearer {primary_token}"},
        )
        assert r.status_code == 201, f"Create journey failed: {r.text}"
        data = r.json()
        assert "token" in data
        assert "status_url" in data
        assert "expires_at" in data
        assert data["status_url"].startswith("/api/journey/status/")
        TestJourneyStatus.journey_token = data["token"]
        TestJourneyStatus.status_url    = data["status_url"]
        print(f"Journey created: token={data['token']}, url={data['status_url']}")

    def test_html_page_in_progress(self):
        if not TestJourneyStatus.status_url:
            pytest.skip("No journey token from create step")
        # PR-1B1 privacy contract: static notice, no status / destination.
        assert_private_page(BASE_URL, TestJourneyStatus.journey_token, "Test Office")

    def test_mark_safe(self, primary_token):
        if not TestJourneyStatus.journey_token:
            pytest.skip("No journey token from create step")
        r = requests.patch(
            f"{BASE_URL}/api/journey/status/{TestJourneyStatus.journey_token}/safe",
            headers={"Authorization": f"Bearer {primary_token}"},
        )
        assert r.status_code == 200, f"Mark safe failed: {r.text}"
        data = r.json()
        assert data.get("ok") is True
        print(f"Marked safe: {data}")

    def test_html_page_shows_arrived_safely(self):
        if not TestJourneyStatus.status_url:
            pytest.skip("No journey token from create step")
        # PR-1B1: safe state is NOT disclosed publicly (verified via owner API in test_mark_safe).
        assert_private_page(BASE_URL, TestJourneyStatus.journey_token, "Test Office")

    def test_idor_protection(self, primary_token, secondary_token):
        """Create journey as primary, try to mark safe as secondary → expect 403"""
        # Create new journey as primary
        r = requests.post(
            f"{BASE_URL}/api/journey/status",
            json={"destination": "IDOR Test", "duration_mins": 10},
            headers={"Authorization": f"Bearer {primary_token}"},
        )
        assert r.status_code == 201
        token = r.json()["token"]

        # Try to mark safe as secondary
        r2 = requests.patch(
            f"{BASE_URL}/api/journey/status/{token}/safe",
            headers={"Authorization": f"Bearer {secondary_token}"},
        )
        assert r2.status_code == 403, f"Expected 403 IDOR protection, got {r2.status_code}: {r2.text}"
        print("IDOR protection working correctly — got 403")

    def test_create_journey_invalid_duration(self, primary_token):
        """Duration > 1440 should be rejected"""
        r = requests.post(
            f"{BASE_URL}/api/journey/status",
            json={"destination": "Test", "duration_mins": 9999},
            headers={"Authorization": f"Bearer {primary_token}"},
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}"

    def test_html_page_not_found(self):
        # PR-1B1: unknown token → identical 200 page (no existence oracle).
        assert_private_page(BASE_URL, "invalidtoken000")
        r = requests.get(f"{BASE_URL}/api/journey/status/invalidtoken000")
        assert "text/html" in r.headers.get("content-type", "")
