"""
EL-055 / EL-054 / OOM Guard — Backend tests
Tests: feature flags endpoint, authentication, evidence vault gate
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')


@pytest.fixture(scope="module")
def auth_token():
    """Login and return a valid JWT token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "voicetest2026@example.com",
        "password": "TestPass123!"
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    assert "token" in data
    return data["token"]


class TestFeatureFlagsEndpoint:
    """EL-055: /api/women/flags endpoint returns expected JSON structure"""

    def test_flags_endpoint_returns_200(self):
        resp = requests.get(f"{BASE_URL}/api/women/flags")
        assert resp.status_code == 200, f"Flags endpoint returned {resp.status_code}: {resp.text}"
        print("PASS: /api/women/flags returns 200")

    def test_flags_response_has_evidence_locker_field(self):
        resp = requests.get(f"{BASE_URL}/api/women/flags")
        assert resp.status_code == 200
        data = resp.json()
        assert "evidence_locker_enabled" in data, f"Missing evidence_locker_enabled in {data}"
        print(f"PASS: evidence_locker_enabled = {data['evidence_locker_enabled']}")

    def test_flags_response_has_evidence_vault_field(self):
        resp = requests.get(f"{BASE_URL}/api/women/flags")
        assert resp.status_code == 200
        data = resp.json()
        assert "evidence_vault_enabled" in data, f"Missing evidence_vault_enabled in {data}"
        print(f"PASS: evidence_vault_enabled = {data['evidence_vault_enabled']}")

    def test_flags_response_has_women_shield_field(self):
        resp = requests.get(f"{BASE_URL}/api/women/flags")
        assert resp.status_code == 200
        data = resp.json()
        assert "women_shield_enabled" in data
        print(f"PASS: women_shield_enabled = {data['women_shield_enabled']}")

    def test_flags_boolean_types(self):
        resp = requests.get(f"{BASE_URL}/api/women/flags")
        data = resp.json()
        for key in ["evidence_locker_enabled", "evidence_vault_enabled", "women_shield_enabled"]:
            assert isinstance(data[key], bool), f"{key} is not bool: {type(data[key])}"
        print("PASS: All flag values are boolean type")

    def test_flags_accessible_without_auth(self):
        """Flags should be publicly accessible (no auth required) for offline cache seed"""
        resp = requests.get(f"{BASE_URL}/api/women/flags")
        assert resp.status_code == 200
        print("PASS: flags accessible without auth token")

    def test_flags_accessible_with_auth(self, auth_token):
        resp = requests.get(f"{BASE_URL}/api/women/flags",
                            headers={"Authorization": f"Bearer {auth_token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "evidence_locker_enabled" in data
        print(f"PASS: flags with auth token: {data}")


class TestEvidenceVaultGating:
    """EL-055: Evidence vault is blocked when evidence_locker_enabled=false"""

    def test_vault_anchor_blocked_when_locker_disabled(self, auth_token):
        """If evidence_locker_enabled=false, vault operations should return 503"""
        flags = requests.get(f"{BASE_URL}/api/women/flags").json()
        if flags.get("evidence_locker_enabled"):
            pytest.skip("evidence_locker_enabled is true — vault not blocked in this env")
        
        # Try to call a vault endpoint (anchor) — should be blocked
        resp = requests.post(
            f"{BASE_URL}/api/women/evidence/anchor",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"item_id": "test-123", "hash": "abc", "scope": "device"}
        )
        # Should be 503 or 404 (not 200) when locker is disabled
        assert resp.status_code in [400, 403, 404, 422, 503], \
            f"Expected blocked vault, got {resp.status_code}: {resp.text[:200]}"
        print(f"PASS: Vault blocked when locker disabled, got {resp.status_code}")
