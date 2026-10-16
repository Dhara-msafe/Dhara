"""P0 Fix Verification: Auth error responses must always be application/json with string detail.
Tests verify:
1. Wrong password → 401 JSON with string detail
2. Missing field → 422 JSON with string detail (not array)
3. Empty email → 422 JSON with string detail
4. Missing register fields → 422 JSON with string detail
5. No HTML ever returned for auth errors
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestAuthErrorJsonGuarantee:
    """All auth error responses must be application/json with string detail."""

    def test_wrong_password_returns_401_json(self, client):
        """POST /api/auth/login with wrong password → 401 application/json, string detail"""
        r = client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "WrongPassword999!"
        })
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text[:200]}"
        assert "application/json" in r.headers.get("content-type", ""), \
            f"Expected application/json, got {r.headers.get('content-type')}"
        body = r.json()
        assert "detail" in body, f"Missing 'detail' key in: {body}"
        assert isinstance(body["detail"], str), \
            f"detail must be a string, got {type(body['detail'])}: {body['detail']}"
        print(f"PASS: 401 JSON with string detail='{body['detail']}'")

    def test_missing_password_field_returns_422_json_string_detail(self, client):
        """POST /api/auth/login with missing password → 422 JSON, detail is string (not array)"""
        r = client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com"
            # password intentionally missing
        })
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text[:200]}"
        assert "application/json" in r.headers.get("content-type", ""), \
            f"Expected application/json, got {r.headers.get('content-type')}"
        body = r.json()
        assert "detail" in body, f"Missing 'detail' key in: {body}"
        assert isinstance(body["detail"], str), \
            f"detail must be a string (not array), got {type(body['detail'])}: {body['detail']}"
        print(f"PASS: 422 JSON with string detail='{body['detail']}'")

    def test_empty_email_returns_422_json_string_detail(self, client):
        """POST /api/auth/login with empty email → 422 JSON, detail is string"""
        r = client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "",
            "password": "somepassword"
        })
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text[:200]}"
        assert "application/json" in r.headers.get("content-type", ""), \
            f"Expected application/json, got {r.headers.get('content-type')}"
        body = r.json()
        assert "detail" in body, f"Missing 'detail' key in: {body}"
        assert isinstance(body["detail"], str), \
            f"detail must be a string, got {type(body['detail'])}: {body['detail']}"
        print(f"PASS: 422 JSON with string detail='{body['detail']}'")

    def test_register_missing_fields_returns_422_json_string_detail(self, client):
        """POST /api/auth/register with missing required fields → 422 JSON, detail is string"""
        r = client.post(f"{BASE_URL}/api/auth/register", json={
            "email": "incomplete@example.com"
            # missing password, name, phone, terms_accepted
        })
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text[:200]}"
        assert "application/json" in r.headers.get("content-type", ""), \
            f"Expected application/json, got {r.headers.get('content-type')}"
        body = r.json()
        assert "detail" in body, f"Missing 'detail' key in: {body}"
        assert isinstance(body["detail"], str), \
            f"detail must be a string, got {type(body['detail'])}: {body['detail']}"
        print(f"PASS: 422 JSON with string detail='{body['detail']}'")

    def test_no_html_on_wrong_password(self, client):
        """Backend never returns HTML for auth error paths"""
        r = client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "WrongPassword999!"
        })
        content_type = r.headers.get("content-type", "")
        assert "text/html" not in content_type, \
            f"Got HTML response! content-type: {content_type}\nbody: {r.text[:200]}"
        body = r.text.strip()
        assert not body.startswith("<"), \
            f"Response body looks like HTML: {body[:100]}"
        print(f"PASS: No HTML response for wrong password (content-type={content_type})")

    def test_no_html_on_missing_field(self, client):
        """Backend never returns HTML for 422 validation errors"""
        r = client.post(f"{BASE_URL}/api/auth/login", json={"email": "test@example.com"})
        content_type = r.headers.get("content-type", "")
        assert "text/html" not in content_type, \
            f"Got HTML response! content-type: {content_type}"
        body = r.text.strip()
        assert not body.startswith("<"), f"Response body is HTML: {body[:100]}"
        print(f"PASS: No HTML for missing field (content-type={content_type})")

    def test_login_success_sanity(self, client):
        """Sanity: valid credentials return 200 with token and user"""
        r = client.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "token" in body, f"Missing token: {body}"
        assert "user" in body, f"Missing user: {body}"
        print(f"PASS: Login success returns token for voicetest2026@example.com")
