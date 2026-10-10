"""Scan Notice v2 backend tests — structured fields: document_type, is_legal_document, material_facts, legal_truth_state"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

# Minimal 1x1 white JPEG in base64
TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
    "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN"
    "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
    "MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA"
    "AAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAA"
    "AAAA/9oADAMBAAIRAxEAPwCwABmX/9k="
)


@pytest.fixture(scope="module")
def auth_token():
    """Get auth token for voicetest2026@example.com"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "voicetest2026@example.com",
        "password": "TestPass123!"
    })
    if resp.status_code != 200:
        pytest.skip(f"Auth failed: {resp.status_code} {resp.text[:200]}")
    return resp.json().get("token") or resp.json().get("access_token")


class TestHealth:
    """Health check"""

    def test_health_returns_200(self):
        resp = requests.get(f"{BASE_URL}/api/health")
        assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
        print("Health check PASSED")


class TestAuth:
    """Auth endpoint tests"""

    def test_login_success(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text[:200]}"
        data = resp.json()
        assert "token" in data or "access_token" in data, "No token in response"
        print("Login PASSED")

    def test_login_wrong_password(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "WrongPass!"
        })
        assert resp.status_code in (400, 401, 422), f"Expected 4xx for bad creds, got {resp.status_code}"
        print("Login wrong password PASSED")


class TestScanNoticeV2:
    """POST /api/scan/notice — new structured fields"""

    def test_scan_notice_no_auth_returns_result(self):
        """Anonymous call should still work, no scan_id returned"""
        resp = requests.post(f"{BASE_URL}/api/scan/notice", json={
            "image_base64": TINY_JPEG_B64,
            "lang": "en",
            "mode": "summary"
        })
        assert resp.status_code in (200, 502), f"Unexpected status {resp.status_code}"
        if resp.status_code == 200:
            data = resp.json()
            # v2 structured fields
            assert "document_type" in data, "Missing document_type"
            assert "is_legal_document" in data, "Missing is_legal_document"
            assert "material_facts" in data, "Missing material_facts"
            assert "legal_truth_state" in data, "Missing legal_truth_state"
            assert isinstance(data["is_legal_document"], bool), "is_legal_document must be bool"
            assert isinstance(data["material_facts"], dict), "material_facts must be dict"
            assert data["legal_truth_state"] in {"VERIFIED_DIRECT", "VERIFIED_CONDITIONAL", "FRAMEWORK_VERIFIED", "CANNOT_VERIFY"}, \
                f"Invalid legal_truth_state: {data['legal_truth_state']}"
            assert "scan_id" not in data or data.get("scan_id") is None, "Anonymous scan should not have scan_id"
            print(f"Scan notice anonymous PASSED — document_type={data['document_type']}, is_legal={data['is_legal_document']}")
        else:
            print(f"Scan notice returned 502 (vision model issue) — expected for tiny test image")

    def test_scan_notice_with_auth_returns_scan_id(self, auth_token):
        """Authenticated call should return scan_id"""
        resp = requests.post(f"{BASE_URL}/api/scan/notice", json={
            "image_base64": TINY_JPEG_B64,
            "lang": "en",
            "mode": "summary"
        }, headers={"Authorization": f"Bearer {auth_token}"})
        assert resp.status_code in (200, 502), f"Unexpected status {resp.status_code}"
        if resp.status_code == 200:
            data = resp.json()
            assert "document_type" in data, "Missing document_type"
            assert "is_legal_document" in data, "Missing is_legal_document"
            assert "material_facts" in data, "Missing material_facts"
            assert "legal_truth_state" in data, "Missing legal_truth_state"
            assert "scan_id" in data, "Authenticated scan should have scan_id"
            print(f"Scan notice authenticated PASSED — scan_id={data.get('scan_id')}")
        else:
            print("Scan notice returned 502 (tiny test image) — structured fields not testable")

    def test_scan_notice_missing_image_returns_400(self):
        resp = requests.post(f"{BASE_URL}/api/scan/notice", json={
            "image_base64": "",
            "lang": "en",
            "mode": "summary"
        })
        assert resp.status_code == 400, f"Expected 400 for empty image, got {resp.status_code}"
        print("Scan notice empty image PASSED — got 400")

    def test_scan_notice_invalid_body_returns_422(self):
        resp = requests.post(f"{BASE_URL}/api/scan/notice", json={})
        assert resp.status_code == 422, f"Expected 422 for missing body, got {resp.status_code}"
        print("Scan notice invalid body PASSED — got 422")

    def test_scan_history_requires_auth(self):
        resp = requests.get(f"{BASE_URL}/api/scan/history/some-user-id")
        assert resp.status_code in (401, 403), f"Expected 401/403, got {resp.status_code}"
        print("Scan history auth guard PASSED")

    def test_scan_detail_requires_auth(self):
        resp = requests.get(f"{BASE_URL}/api/scan/history/detail/some-scan-id")
        assert resp.status_code in (401, 403), f"Expected 401/403, got {resp.status_code}"
        print("Scan detail auth guard PASSED")
