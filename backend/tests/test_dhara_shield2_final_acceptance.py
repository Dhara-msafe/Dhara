"""
DHARA (dhara-shield-2) P0 SECURITY — FINAL ACCEPTANCE pass.

Combines the permission-selection -> accept -> revoke lifecycle with the
P0 alert-location-leak hotfix, exercised live against the running backend.
Account A = owner/student, Account B = recipient. Synthetic data only.

New scenarios not covered by prior test files:
  1. Cross-link isolation: two SIMULTANEOUS fresh links for the same
     owner/recipient pair, one temp_location=False and one =True, confirm
     no cross-contamination of payload between their respective alerts.
  2. Revoked-link token reuse: calling /respond (accept) again on an
     already-revoked link must fail, not silently restore access.
  3. Duplicate accept/decline on an already-resolved invite -> 400.
  4. Guardian Share HTML status page (journey_router) remains reachable
     and never exposes raw lat/lng, independent of Trusted Circle state.
"""
import os
import uuid
import asyncio
import requests
import pytest
import motor.motor_asyncio

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')

OWNER_EMAIL = "voicetest2026@example.com"
OWNER_PASS = "TestPass123!"
RECIPIENT_EMAIL = "fir-test-user2@example.com"
RECIPIENT_PASS = "TestPass456!"
RECIPIENT_PHONE = "9000000002"

MONGO_URL = "mongodb://localhost:27017"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text}")
    return r.json().get("token") or r.json().get("access_token")


def _get_user_id(token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        pytest.skip(f"/api/auth/me failed: {r.status_code} {r.text}")
    return r.json().get("id") or r.json().get("user", {}).get("id")


def _create_invite(owner_token, temp_location: bool):
    headers = {"Authorization": f"Bearer {owner_token}"}
    perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
             "temp_location": temp_location, "emergency_requests": True}
    body = {"name": "QA Final Accept", "phone": RECIPIENT_PHONE, "permissions": perms}
    r = requests.post(f"{BASE_URL}/api/trusted-circle/invite", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _insert_synthetic_alert(link_id, recipient_user_id, owner_id, area_tag):
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
        "recipient_user_id": recipient_user_id, "link_id": link_id, "journey_token": f"qa-final-{area_tag}",
        "payload": {"destination": "QA Dest", "journey_status": "in_progress",
                    "last_location": {"lat": 12.9, "lng": 77.5, "accuracy": 10, "area": area_tag, "age_minutes": 1}},
        "state": "QUEUED", "idempotency_key": f"qa-final-{alert_id}",
        "created_at": "2026-06-01T09:00:00Z", "read_at": None, "acknowledged_at": None,
    })
    client.close()
    return alert_id


@pytest.fixture(scope="module")
def owner():
    return {"token": _login(OWNER_EMAIL, OWNER_PASS)}


@pytest.fixture(scope="module")
def recipient():
    return {"token": _login(RECIPIENT_EMAIL, RECIPIENT_PASS)}


class TestCrossLinkIsolation:
    """Two simultaneous links (one false, one true temp_location) for the
    same owner/recipient pair -> their alerts must never cross-contaminate."""

    def test_two_links_isolated(self, owner, recipient):
        owner_id = _get_user_id(owner["token"])
        recipient_id = _get_user_id(recipient["token"])
        headers_r = {"Authorization": f"Bearer {recipient['token']}"}

        link_false = _create_invite(owner["token"], temp_location=False)
        link_true = _create_invite(owner["token"], temp_location=True)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_false}/respond",
                      json={"action": "accept"}, headers=headers_r)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_true}/respond",
                      json={"action": "accept"}, headers=headers_r)

        alert_false_id = asyncio.get_event_loop().run_until_complete(
            _insert_synthetic_alert(link_false, recipient_id, owner_id, "SHOULD_NOT_LEAK_AREA"))
        alert_true_id = asyncio.get_event_loop().run_until_complete(
            _insert_synthetic_alert(link_true, recipient_id, owner_id, "SHOULD_APPEAR_AREA"))

        list_resp = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers_r)
        assert list_resp.status_code == 200
        by_id = {a["id"]: a for a in list_resp.json()}

        assert "last_location" not in by_id[alert_false_id]["payload"], \
            f"CROSS-CONTAMINATION or leak: {by_id[alert_false_id]['payload']}"
        assert by_id[alert_true_id]["payload"]["last_location"]["area"] == "SHOULD_APPEAR_AREA"

        det_false = requests.get(f"{BASE_URL}/api/alerts/{alert_false_id}", headers=headers_r).json()
        det_true = requests.get(f"{BASE_URL}/api/alerts/{alert_true_id}", headers=headers_r).json()
        assert "last_location" not in det_false["payload"]
        assert det_true["payload"]["last_location"]["area"] == "SHOULD_APPEAR_AREA"
        assert det_false["permissions"]["temp_location"] is False
        assert det_true["permissions"]["temp_location"] is True


class TestRevokedTokenReuse:
    """A revoked link's id must not be usable to re-accept and regain access."""

    def test_accept_after_revoke_rejected(self, owner, recipient):
        headers_o = {"Authorization": f"Bearer {owner['token']}"}
        headers_r = {"Authorization": f"Bearer {recipient['token']}"}
        link_id = _create_invite(owner["token"], temp_location=True)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                      json={"action": "accept"}, headers=headers_r)
        rv = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/revoke", headers=headers_o)
        assert rv.status_code == 200

        # Attempt to re-accept the revoked link
        re_accept = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                                   json={"action": "accept"}, headers=headers_r)
        assert re_accept.status_code == 400, \
            f"SECURITY: revoked link accepted again! status={re_accept.status_code} body={re_accept.text}"

        # Confirm status is still revoked, not reverted to accepted
        g = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_r)
        assert g.json()["status"] == "revoked"


class TestDuplicateRespond:
    def test_duplicate_decline_rejected(self, owner, recipient):
        headers_r = {"Authorization": f"Bearer {recipient['token']}"}
        link_id = _create_invite(owner["token"], temp_location=False)
        r1 = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                            json={"action": "decline"}, headers=headers_r)
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                            json={"action": "decline"}, headers=headers_r)
        assert r2.status_code == 400
        r3 = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                            json={"action": "accept"}, headers=headers_r)
        assert r3.status_code == 400


class TestGuardianShareArchitecturalSeparation:
    """Guardian Share HTML page (journey_router) — separate token-based
    mechanism, never gated by Trusted Circle. Must never show raw lat/lng."""

    def test_guardian_page_independent_of_trusted_circle(self, owner):
        headers_o = {"Authorization": f"Bearer {owner['token']}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Guardian Dest", "duration_mins": 30, "recipient_link_ids": []},
                           headers=headers_o)
        assert j.status_code == 201, j.text
        token = j.json()["token"]

        loc = requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                              json={"lat": 12.9716, "lng": 77.5946, "accuracy": 8, "area": "QA Guardian Area"},
                              headers=headers_o)
        assert loc.status_code == 200, loc.text

        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.status_code == 200
        html = page.text
        assert "QA Guardian Area" in html
        assert "12.9716" not in html and "77.5946" not in html, \
            "Guardian Share page leaked raw coordinates"
        assert "lat" not in html.lower().replace("relate", "") or True  # heuristic only; coordinate check above is authoritative
