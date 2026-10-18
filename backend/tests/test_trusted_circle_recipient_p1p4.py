"""
Smoke tests for Trusted Circle Recipient Experience + Profile Photo (P1-P4).
Backend logic already deep-verified by main agent via direct python scripts.
This file does a lighter spot-check from the testing-agent side, focused on
status codes + basic persistence, to catch any regressions/integration glue
bugs before/after frontend UI testing.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL').rstrip('/')

OWNER_EMAIL = "voicetest2026@example.com"
OWNER_PASS = "TestPass123!"
RECIPIENT_EMAIL = "fir-test-user2@example.com"
RECIPIENT_PASS = "TestPass456!"


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS})
    if r.status_code != 200:
        pytest.skip(f"Owner login failed: {r.status_code} {r.text}")
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def recipient_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": RECIPIENT_EMAIL, "password": RECIPIENT_PASS})
    if r.status_code != 200:
        pytest.skip(f"Recipient login failed: {r.status_code} {r.text}")
    return r.json().get("token") or r.json().get("access_token")


class TestProfilePhotoEndpoints:
    def test_profile_me_patch_name(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        r = requests.patch(f"{BASE_URL}/api/profile/me", json={"name": "QA Tester"}, headers=headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        # verify persistence via GET /api/auth/me (or similar)
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
        if me.status_code == 200:
            assert me.json().get("name") == "QA Tester"

    def test_photo_token_without_photo_handles_gracefully(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        r = requests.get(f"{BASE_URL}/api/profile/photo-token", headers=headers)
        # Should not 500 even if no photo set
        assert r.status_code in (200, 404), r.text


class TestTrustedCircleEndpoints:
    def test_invite_contact(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        r = requests.post(
            f"{BASE_URL}/api/trusted-circle/invite",
            json={"name": "QA Recipient", "phone": "9000000002"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data

    def test_list_invitations_received(self, recipient_token):
        headers = {"Authorization": f"Bearer {recipient_token}"}
        r = requests.get(f"{BASE_URL}/api/trusted-circle/invitations?direction=received", headers=headers)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_list_accepted_recipients_owner(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        r = requests.get(f"{BASE_URL}/api/trusted-circle/accepted", headers=headers)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


class TestAlertsEndpoints:
    def test_list_alerts_all(self, recipient_token):
        headers = {"Authorization": f"Bearer {recipient_token}"}
        r = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_unread_count(self, recipient_token):
        headers = {"Authorization": f"Bearer {recipient_token}"}
        r = requests.get(f"{BASE_URL}/api/alerts/unread-count", headers=headers)
        assert r.status_code == 200, r.text
        assert "count" in r.json()

    def test_no_auth_rejected(self):
        r = requests.get(f"{BASE_URL}/api/alerts?filter=all")
        assert r.status_code in (401, 403), r.text


class TestJourneyEndpoints:
    def test_journey_status_create(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        r = requests.post(
            f"{BASE_URL}/api/journey/status",
            json={"destination": "QA Test Destination", "duration_mins": 30, "recipient_link_ids": []},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert "token" in data
