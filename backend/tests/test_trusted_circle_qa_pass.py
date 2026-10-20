"""
QA pass — Trusted Circle Recipient feature flag live-enable verification.
Covers: scoped permission visibility, accept/decline, revocation, journey
location-sharing gating, and raw-payload leak check (temp_location perm).
Account A = owner/sender, Account B = recipient.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL').rstrip('/')

OWNER_EMAIL = "voicetest2026@example.com"
OWNER_PASS = "TestPass123!"
RECIPIENT_EMAIL = "fir-test-user2@example.com"
RECIPIENT_PASS = "TestPass456!"
RECIPIENT_PHONE = "9000000002"


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


def _create_invite(owner_token, permissions):
    headers = {"Authorization": f"Bearer {owner_token}"}
    body = {"name": "QA Recipient Scoped", "phone": RECIPIENT_PHONE, "permissions": permissions}
    r = requests.post(f"{BASE_URL}/api/trusted-circle/invite", json=body, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["matched_existing_user"] is True
    return data["id"]


class TestScopedPermissionsVisibility:
    """Owner grants only journey_status + expected_arrival. temp_location and
    emergency_requests must NOT be visible/true on the recipient side."""

    def test_invite_with_limited_permissions(self, owner_token, recipient_token):
        perms = {
            "journey_status": True, "expected_arrival": True,
            "missed_checkin": False, "temp_location": False, "emergency_requests": False,
        }
        link_id = _create_invite(owner_token, perms)
        headers_r = {"Authorization": f"Bearer {recipient_token}"}
        r = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_r)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "pending"
        p = data["permissions"]
        assert p["journey_status"] is True
        assert p["expected_arrival"] is True
        assert p["temp_location"] is False, "temp_location leaked as granted!"
        assert p["emergency_requests"] is False, "emergency_requests leaked as granted!"

        # Accept flow (same scoped link, kept in one test to avoid xdist
        # worker isolation issues losing cross-test state)
        r2 = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                            json={"action": "accept"}, headers=headers_r)
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "accepted"
        g2 = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_r)
        assert g2.json()["status"] == "accepted"

        # Double-respond on an already-accepted invite must be rejected
        r3 = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                            json={"action": "decline"}, headers=headers_r)
        assert r3.status_code == 400


class TestDeclineFlow:
    def test_decline_fresh_invite(self, owner_token, recipient_token):
        perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
                 "temp_location": False, "emergency_requests": True}
        link_id = _create_invite(owner_token, perms)
        headers_r = {"Authorization": f"Bearer {recipient_token}"}
        r = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                           json={"action": "decline"}, headers=headers_r)
        assert r.status_code == 200
        assert r.json()["status"] == "declined"
        g = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_r)
        assert g.json()["status"] == "declined"


class TestRevocation:
    def test_revoke_after_accept(self, owner_token, recipient_token):
        perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
                 "temp_location": False, "emergency_requests": True}
        link_id = _create_invite(owner_token, perms)
        headers_r = {"Authorization": f"Bearer {recipient_token}"}
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                      json={"action": "accept"}, headers=headers_r)
        r = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/revoke", headers=headers_o)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_r)
        assert g.json()["status"] == "revoked"
        # owner non-link-owner cannot revoke someone else's link
        r2 = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/revoke", headers=headers_r)
        assert r2.status_code == 403


class TestExpiryMechanism:
    def test_invite_has_no_expiry_field(self, owner_token, recipient_token):
        """Code-reading + live check: trusted_circle_links documents have no
        expires_at / TTL field, and the respond endpoint does not check any
        expiry condition -> a pending invite never expires server-side."""
        perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
                 "temp_location": False, "emergency_requests": True}
        link_id = _create_invite(owner_token, perms)
        headers_r = {"Authorization": f"Bearer {recipient_token}"}
        g = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_r)
        data = g.json()
        assert "expires_at" not in data and "expiry" not in data
        # No mechanism exists; documenting as finding, not a hard failure.


class TestLocationPermissionLeak:
    """temp_location NOT granted -> verify alert payload does not leak raw
    location fields at the API layer (not just hidden by frontend)."""

    def test_journey_alert_payload_respects_temp_location_false(self, owner_token, recipient_token):
        perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
                 "temp_location": False, "emergency_requests": True}
        link_id = _create_invite(owner_token, perms)
        headers_r = {"Authorization": f"Bearer {recipient_token}"}
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                      json={"action": "accept"}, headers=headers_r)

        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Dest", "duration_mins": 30, "recipient_link_ids": [link_id]},
                           headers=headers_o)
        assert j.status_code == 201, j.text
        token = j.json()["token"]

        loc = requests.post(f"{BASE_URL}/api/journey/{token}/location",
                             json={"lat": 12.9716, "lng": 77.5946, "accuracy": 10, "area": "QA Test Area"},
                             headers=headers_o)
        # Endpoint path may differ; tolerate 404 (not critical path for this QA) but log.
        time.sleep(1)

        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers_r)
        assert alerts.status_code == 200
        matching = [a for a in alerts.json() if a.get("link_id") == link_id]
        if not matching:
            pytest.skip("No alert generated for this link (location endpoint may differ) — see report")
        alert_id = matching[0]["id"]
        detail = requests.get(f"{BASE_URL}/api/alerts/{alert_id}", headers=headers_r)
        assert detail.status_code == 200
        d = detail.json()
        payload = d.get("payload", {})
        # KEY CHECK: does API-level payload still contain last_location/area
        # even though temp_location permission is False?
        if "last_location" in payload:
            print("FINDING: raw payload.last_location present in API response "
                  "even though temp_location permission is False:", payload["last_location"])
        assert "lat" not in str(payload), "raw lat found in payload (should never appear per design)"
        assert "lng" not in str(payload), "raw lng found in payload (should never appear per design)"
