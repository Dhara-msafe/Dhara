"""
P0 HOTFIX — LIVE deployment verification (post-reload) against the actual
running backend service. Synthetic accounts/data only; no real user data.

Confirms the running process (uvicorn --reload picked this up automatically
on file save, per supervisor config inspection) is actually serving the
patched alerts_router.py, by inspecting RAW JSON from the live endpoints —
not a frontend screenshot, not a unit test of the function in isolation.

We cannot trigger a real GPS journey-location event without knowing the
exact live-tracking endpoint contract, so a synthetic `safety_alerts`
document is inserted directly into Mongo (bypassing journey_router.py,
which is OUT OF SCOPE for this patch) purely to exercise the two patched
endpoints end-to-end with a `last_location` payload present.
"""
import os
import uuid
import asyncio
import requests
import pytest
import motor.motor_asyncio

BASE_URL = os.environ.get('EXPO_BACKEND_URL').rstrip('/')
MONGO_URL = "mongodb://localhost:27017"

OWNER_EMAIL = "voicetest2026@example.com"
OWNER_PASS = "TestPass123!"
RECIPIENT_EMAIL = "fir-test-user2@example.com"
RECIPIENT_PASS = "TestPass456!"
RECIPIENT_PHONE = "9000000002"

SYNTHETIC_LOCATION = {"lat": 12.9716, "lng": 77.5946, "accuracy": 10, "area": "QA Hotfix Verify Area", "age_minutes": 1}


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text}")
    return r.json().get("token") or r.json().get("access_token")


def _create_invite(owner_token, temp_location: bool):
    headers = {"Authorization": f"Bearer {owner_token}"}
    perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
             "temp_location": temp_location, "emergency_requests": True}
    body = {"name": "QA Hotfix Verify", "phone": RECIPIENT_PHONE, "permissions": perms}
    r = requests.post(f"{BASE_URL}/api/trusted-circle/invite", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _insert_synthetic_alert(link_id, recipient_user_id, owner_id):
    # Use the same DB name the running app uses (read from backend/.env DB_NAME).
    import re
    db_name = "dhara"
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", ".env")) as f:
            for line in f:
                m = re.match(r'^DB_NAME=["\']?([^"\'\n]+)', line)
                if m:
                    db_name = m.group(1)
                    break
    except Exception:
        pass
    client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
    db = client[db_name]
    alert_id = str(uuid.uuid4())
    await db.safety_alerts.insert_one({
        "id": alert_id, "type": "journey_status", "owner_id": owner_id, "owner_name": "QA Owner",
        "recipient_user_id": recipient_user_id, "link_id": link_id, "journey_token": "qa-synthetic-token",
        "payload": {"destination": "QA Dest", "journey_status": "in_progress", "last_location": dict(SYNTHETIC_LOCATION)},
        "state": "QUEUED", "idempotency_key": f"qa-hotfix-{alert_id}",
        "created_at": "2026-06-01T09:00:00Z", "read_at": None, "acknowledged_at": None,
    })
    client.close()
    return alert_id, db_name


def _get_user_id(token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        pytest.skip(f"/api/auth/me failed: {r.status_code} {r.text}")
    return r.json().get("id") or r.json().get("user", {}).get("id")


@pytest.fixture(scope="module")
def owner():
    return {"token": _login(OWNER_EMAIL, OWNER_PASS)}


@pytest.fixture(scope="module")
def recipient():
    return {"token": _login(RECIPIENT_EMAIL, RECIPIENT_PASS)}


class TestLiveHotfix_NoLocationPermission:
    """Scenario A + F + G (live, raw JSON, against the actual running service)."""

    def test_accepted_no_temp_location_no_leak_list_and_detail(self, owner, recipient):
        owner_id = _get_user_id(owner["token"])
        recipient_id = _get_user_id(recipient["token"])
        link_id = _create_invite(owner["token"], temp_location=False)
        headers_r = {"Authorization": f"Bearer {recipient['token']}"}
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                      json={"action": "accept"}, headers=headers_r)

        alert_id, db_name = asyncio.get_event_loop().run_until_complete(
            _insert_synthetic_alert(link_id, recipient_id, owner_id))

        list_resp = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers_r)
        assert list_resp.status_code == 200
        match = next((a for a in list_resp.json() if a["id"] == alert_id), None)
        assert match is not None, "synthetic alert not found in live list response"
        assert "last_location" not in match.get("payload", {}), \
            f"LIVE LEAK in GET /api/alerts: {match.get('payload')}"

        detail_resp = requests.get(f"{BASE_URL}/api/alerts/{alert_id}", headers=headers_r)
        assert detail_resp.status_code == 200
        d = detail_resp.json()
        assert "last_location" not in d.get("payload", {}), \
            f"LIVE LEAK in GET /api/alerts/{{id}}: {d.get('payload')}"
        assert d["access_revoked"] is False
        assert d["permissions"]["temp_location"] is False

    def test_unauthenticated_denied(self):
        r1 = requests.get(f"{BASE_URL}/api/alerts")
        r2 = requests.get(f"{BASE_URL}/api/alerts/nonexistent-id")
        assert r1.status_code in (401, 403)
        assert r2.status_code in (401, 403, 404)


class TestLiveHotfix_WithLocationPermission:
    """Scenario B (live) — permitted data still flows correctly."""

    def test_accepted_with_temp_location_data_present(self, owner, recipient):
        owner_id = _get_user_id(owner["token"])
        recipient_id = _get_user_id(recipient["token"])
        link_id = _create_invite(owner["token"], temp_location=True)
        headers_r = {"Authorization": f"Bearer {recipient['token']}"}
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                      json={"action": "accept"}, headers=headers_r)
        alert_id, _ = asyncio.get_event_loop().run_until_complete(
            _insert_synthetic_alert(link_id, recipient_id, owner_id))

        detail_resp = requests.get(f"{BASE_URL}/api/alerts/{alert_id}", headers=headers_r)
        assert detail_resp.status_code == 200
        d = detail_resp.json()
        assert d["payload"].get("last_location", {}).get("area") == "QA Hotfix Verify Area", \
            "authorized location data should still flow when temp_location=true"


class TestLiveHotfix_RevokedRelationship:
    """Scenario E (live) — revocation immediately blocks protected data, even for
    alerts created while the link was accepted."""

    def test_revoked_link_zeros_payload_live(self, owner, recipient):
        owner_id = _get_user_id(owner["token"])
        recipient_id = _get_user_id(recipient["token"])
        link_id = _create_invite(owner["token"], temp_location=True)
        headers_r = {"Authorization": f"Bearer {recipient['token']}"}
        headers_o = {"Authorization": f"Bearer {owner['token']}"}
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                      json={"action": "accept"}, headers=headers_r)
        alert_id, _ = asyncio.get_event_loop().run_until_complete(
            _insert_synthetic_alert(link_id, recipient_id, owner_id))
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/revoke", headers=headers_o)

        detail_resp = requests.get(f"{BASE_URL}/api/alerts/{alert_id}", headers=headers_r)
        d = detail_resp.json()
        assert d["access_revoked"] is True
        assert d["payload"] == {}

        list_resp = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers_r)
        match = next((a for a in list_resp.json() if a["id"] == alert_id), None)
        assert match is not None
        assert match["payload"] == {}, f"LIVE LEAK after revocation in list endpoint: {match}"
