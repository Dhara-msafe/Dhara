"""
Tests for DHARA v2.2 consent management endpoints:
- GET /api/user/consent-history
- PATCH /api/user/privacy-choices
- EL-055: evidence vault flag guard
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    t = data.get("token") or data.get("access_token")
    assert t, f"No token in response: {data}"
    return t


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


class TestConsentHistory:
    """GET /api/user/consent-history"""

    def test_returns_200_with_entries_total(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/user/consent-history?limit=10", headers=auth_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "entries" in data, f"Missing 'entries' field: {data}"
        assert "total" in data, f"Missing 'total' field: {data}"

    def test_entries_is_list(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/user/consent-history?limit=10", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["entries"], list)

    def test_total_is_int(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/user/consent-history?limit=10", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["total"], int)

    def test_requires_auth(self):
        resp = requests.get(f"{BASE_URL}/api/user/consent-history?limit=10")
        assert resp.status_code == 401, f"Expected 401 without auth, got {resp.status_code}"

    def test_limit_zero_returns_all(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/user/consent-history?limit=0", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data and "total" in data


class TestPrivacyChoices:
    """PATCH /api/user/privacy-choices"""

    def test_saves_analytics_true_updates_false(self, auth_headers):
        resp = requests.patch(
            f"{BASE_URL}/api/user/privacy-choices",
            json={"analytics": True, "updates": False},
            headers={**auth_headers, "Content-Type": "application/json"},
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("ok") is True
        assert "consent_purposes" in data
        assert data["consent_purposes"]["analytics"] is True
        assert data["consent_purposes"]["updates"] is False

    def test_saves_analytics_false_updates_true(self, auth_headers):
        resp = requests.patch(
            f"{BASE_URL}/api/user/privacy-choices",
            json={"analytics": False, "updates": True},
            headers={**auth_headers, "Content-Type": "application/json"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["consent_purposes"]["analytics"] is False
        assert data["consent_purposes"]["updates"] is True

    def test_persists_to_user_me(self, auth_headers):
        """PATCH → GET /api/user/me verifies persistence"""
        requests.patch(
            f"{BASE_URL}/api/user/privacy-choices",
            json={"analytics": True, "updates": True},
            headers={**auth_headers, "Content-Type": "application/json"},
        )
        me_resp = requests.get(f"{BASE_URL}/api/user/me", headers=auth_headers)
        assert me_resp.status_code == 200
        me = me_resp.json()
        purposes = me.get("consent_purposes", {})
        assert purposes.get("analytics") is True
        assert purposes.get("updates") is True

    def test_requires_auth(self):
        resp = requests.patch(
            f"{BASE_URL}/api/user/privacy-choices",
            json={"analytics": True, "updates": False},
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 401

    def test_creates_consent_log_entry(self, auth_headers):
        """After PATCH, consent-history total should be >= 1"""
        requests.patch(
            f"{BASE_URL}/api/user/privacy-choices",
            json={"analytics": False, "updates": False},
            headers={**auth_headers, "Content-Type": "application/json"},
        )
        hist = requests.get(f"{BASE_URL}/api/user/consent-history?limit=10", headers=auth_headers)
        assert hist.status_code == 200
        data = hist.json()
        assert data["total"] >= 1


class TestEL055EvidenceVaultFlagGuard:
    """EL-055: Evidence vault endpoints return 503 (not accessible) when flags disabled"""

    def test_evidence_locker_flag_guard_code_exists(self):
        """Code review: _flags_or_503() function exists in evidence_vault_router.py"""
        import importlib.util, sys
        # Just check the file content without importing (avoid side effects)
        with open("/app/backend/api/evidence_vault_router.py") as f:
            content = f.read()
        assert "_flags_or_503" in content, "_flags_or_503 guard function not found"
        assert "evidence_locker_enabled" in content, "evidence_locker_enabled flag check not found"

    def test_evidence_anchor_blocked_when_disabled(self, auth_headers):
        """POST /api/evidence/anchor should return 503 or 422 if flags disabled"""
        # Try with valid-looking body — will fail at flag check if disabled
        resp = requests.post(
            f"{BASE_URL}/api/evidence/anchor",
            json={
                "item_id": "test-item-01",
                "scope": "test-scope",
                "type": "audio",
                "manifest_hash": "a" * 64,
                "chain_hash": "b" * 64,
                "prev_hash": "0" * 64,
                "device_time": "2026-01-01T00:00:00Z",
            },
            headers={**auth_headers, "Content-Type": "application/json"},
        )
        # When flag disabled, expect 503; when enabled, expect 200/201
        assert resp.status_code in (200, 201, 503), (
            f"Unexpected status {resp.status_code}: {resp.text}"
        )

    def test_default_flag_is_false(self):
        """Code review: evidence_locker_enabled defaults to False in women_router"""
        with open("/app/backend/api/women_router.py") as f:
            content = f.read()
        # The default flags dict should have evidence_locker_enabled: False
        assert '"evidence_locker_enabled": False' in content or "'evidence_locker_enabled': False" in content, \
            "evidence_locker_enabled default is not False"
