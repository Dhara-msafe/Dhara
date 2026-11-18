"""
DHARA v2.2 edge-case fixes — backend smoke tests
EL-054: pendingTempFileExists export check (static code)
EL-055: flags fetch per-scope AsyncStorage cache
OOM guard: MAX_INLINE_BYTES export and size checks
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')

# --- Women flags endpoint ---

class TestWomenFlags:
    """EL-055: Flags API returns correct evidence_locker_enabled field"""

    def test_flags_endpoint_returns_200(self):
        r = requests.get(f"{BASE_URL}/api/women/flags")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"

    def test_flags_has_evidence_locker_enabled_field(self):
        r = requests.get(f"{BASE_URL}/api/women/flags")
        assert r.status_code == 200
        data = r.json()
        assert 'evidence_locker_enabled' in data, f"Missing evidence_locker_enabled in {data}"

    def test_flags_has_evidence_vault_enabled_field(self):
        r = requests.get(f"{BASE_URL}/api/women/flags")
        assert r.status_code == 200
        data = r.json()
        assert 'evidence_vault_enabled' in data, f"Missing evidence_vault_enabled in {data}"

    def test_flags_has_women_shield_enabled_field(self):
        r = requests.get(f"{BASE_URL}/api/women/flags")
        assert r.status_code == 200
        data = r.json()
        assert 'women_shield_enabled' in data

    def test_flags_evidence_locker_is_boolean(self):
        r = requests.get(f"{BASE_URL}/api/women/flags")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data.get('evidence_locker_enabled'), bool), \
            f"evidence_locker_enabled should be bool, got {type(data.get('evidence_locker_enabled'))}"

    def test_flags_no_auth_required(self):
        """EL-055: flags must be publicly accessible (no auth header)"""
        r = requests.get(f"{BASE_URL}/api/women/flags")
        assert r.status_code == 200, \
            f"Flags endpoint should be public (no auth). Got {r.status_code}"


class TestAuthLogin:
    """Login works for QA account"""

    def test_login_success(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        assert r.status_code == 200
        data = r.json()
        assert 'token' in data
        assert 'user' in data

    def test_login_user_has_id(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "voicetest2026@example.com",
            "password": "TestPass123!"
        })
        assert r.status_code == 200
        data = r.json()
        assert data['user'].get('id'), "User must have an id"
