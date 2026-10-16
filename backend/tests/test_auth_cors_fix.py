"""Tests for CORS header fix on exception handlers (bug fix verification).

Verifies that:
- POST /api/auth/guest returns 200 with Access-Control-Allow-Origin: *
- POST /api/auth/login with wrong password returns 401 with CORS header
- POST /api/auth/login with missing field returns 422 with CORS header
- POST /api/auth/login with valid credentials returns 200
"""

import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


@pytest.fixture
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": "http://localhost:3000"})
    return s


class TestGuestLoginCORS:
    """Guest login endpoint — CORS fix verification"""

    def test_guest_returns_200(self, session):
        r = session.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"})
        assert r.status_code == 200, f"Expected 200 got {r.status_code}: {r.text[:300]}"

    def test_guest_response_has_cors_header(self, session):
        r = session.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"})
        acao = r.headers.get("access-control-allow-origin", "")
        assert acao == "*", f"Expected CORS header '*' got: '{acao}'"

    def test_guest_response_is_json(self, session):
        r = session.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert "user" in data
        assert data["user"].get("is_guest") is True


class TestLoginWrongPasswordCORS:
    """Login with wrong password — 401 must carry CORS header"""

    def test_wrong_password_returns_401(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "WRONG_PASSWORD_XYZ"
        })
        assert r.status_code == 401, f"Expected 401 got {r.status_code}: {r.text[:300]}"

    def test_wrong_password_401_has_cors_header(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "WRONG_PASSWORD_XYZ"
        })
        acao = r.headers.get("access-control-allow-origin", "")
        assert acao == "*", f"CORS header missing on 401 response. Got: '{acao}'"

    def test_wrong_password_401_is_json(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "WRONG_PASSWORD_XYZ"
        })
        assert r.status_code == 401
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct, f"Expected JSON content-type got: {ct}"
        data = r.json()
        assert "detail" in data


class TestLoginMissingFieldCORS:
    """Login with missing field — 422 (RequestValidationError) must carry CORS header"""

    def test_missing_password_returns_422(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={"email": "test@example.com"})
        assert r.status_code == 422, f"Expected 422 got {r.status_code}: {r.text[:300]}"

    def test_missing_field_422_has_cors_header(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={"email": "test@example.com"})
        acao = r.headers.get("access-control-allow-origin", "")
        assert acao == "*", f"CORS header missing on 422 response. Got: '{acao}'"

    def test_missing_field_422_is_json(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={"email": "test@example.com"})
        assert r.status_code == 422
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct
        data = r.json()
        assert "detail" in data


class TestLoginSuccess:
    """Valid credentials — should return 200 with token"""

    def test_valid_login_returns_200(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        assert r.status_code == 200, f"Expected 200 got {r.status_code}: {r.text[:300]}"

    def test_valid_login_returns_token(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and data["token"]
        assert "user" in data
        assert data["user"]["email"] == "voicetest2026@example.com"

    def test_valid_login_has_cors_header(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        acao = r.headers.get("access-control-allow-origin", "")
        # 200 responses from CORSMiddleware should also have this header
        assert acao == "*", f"CORS header missing on 200 response. Got: '{acao}'"
