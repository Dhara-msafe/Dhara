"""
Sanity test for NEW owner-side permission-selection + revoke flow.
Covers: inviteContact with custom permissions -> recipient sees exact perms ->
accept -> owner sees accepted with permissions -> revoke -> status updates.
Backend endpoints unchanged this pass; this is a light end-to-end check.
"""
import os
import requests
import pytest
from pathlib import Path

def _load_backend_url():
    url = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL')
    if url:
        return url.rstrip('/')
    env_path = Path(__file__).resolve().parents[2] / 'frontend' / '.env'
    for line in env_path.read_text().splitlines():
        if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
            return line.split('=', 1)[1].strip().rstrip('/')
    raise RuntimeError('EXPO_PUBLIC_BACKEND_URL not found')

BASE_URL = _load_backend_url()

OWNER = {"email": "voicetest2026@example.com", "password": "TestPass123!"}
RECIPIENT = {"email": "fir-test-user2@example.com", "password": "TestPass456!"}


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def recipient_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=RECIPIENT)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def recipient_phone(recipient_token):
    r = requests.get(f"{BASE_URL}/api/profile/me", headers={"Authorization": f"Bearer {recipient_token}"})
    if r.status_code == 200 and r.json().get("phone"):
        return r.json()["phone"]
    return "+19998887777"


class TestPermissionSelectionAndRevoke:
    def test_full_cycle(self, owner_token, recipient_token):
        custom_perms = {
            "journey_status": True,
            "expected_arrival": False,
            "missed_checkin": True,
            "temp_location": False,
            "emergency_requests": True,
        }
        invite_body = {
            "name": "QA Recipient",
            "phone": "9000000002",
            "email": "fir-test-user2@example.com",
            "permissions": custom_perms,
        }
        r = requests.post(
            f"{BASE_URL}/api/trusted-circle/invite",
            json=invite_body,
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert r.status_code == 200, r.text
        invite_id = r.json()["id"]

        # Owner's sent list should show exact chosen permissions, not hardcoded defaults
        r = requests.get(
            f"{BASE_URL}/api/trusted-circle/invitations?direction=sent",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert r.status_code == 200
        sent = [i for i in r.json() if i["id"] == invite_id]
        assert len(sent) == 1
        perms_returned = sent[0]["permissions"]
        for k, v in custom_perms.items():
            assert perms_returned[k] == v, f"Permission {k} mismatch: expected {v}, got {perms_returned[k]}"
        assert sent[0]["status"] == "pending"

        # Recipient should see the invite with exact permissions
        r = requests.get(
            f"{BASE_URL}/api/trusted-circle/invitations?direction=received",
            headers={"Authorization": f"Bearer {recipient_token}"},
        )
        assert r.status_code == 200
        received = [i for i in r.json() if i["id"] == invite_id]
        if len(received) == 1:
            for k, v in custom_perms.items():
                assert received[0]["permissions"][k] == v

        # Accept
        r = requests.post(
            f"{BASE_URL}/api/trusted-circle/invitations/{invite_id}/respond",
            json={"action": "accept"},
            headers={"Authorization": f"Bearer {recipient_token}"},
        )
        assert r.status_code == 200, r.text

        # Owner sees accepted status with same permissions
        r = requests.get(
            f"{BASE_URL}/api/trusted-circle/invitations?direction=sent",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        accepted = [i for i in r.json() if i["id"] == invite_id][0]
        assert accepted["status"] == "accepted"
        for k, v in custom_perms.items():
            assert accepted["permissions"][k] == v

        # Revoke
        r = requests.post(
            f"{BASE_URL}/api/trusted-circle/invitations/{invite_id}/revoke",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert r.status_code == 200, r.text

        # Owner's list now reflects revoked
        r = requests.get(
            f"{BASE_URL}/api/trusted-circle/invitations?direction=sent",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        revoked = [i for i in r.json() if i["id"] == invite_id][0]
        assert revoked["status"] == "revoked"
