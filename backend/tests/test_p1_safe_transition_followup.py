"""
P1 follow-up — ALREADY-ISSUED ALERT, before/after a journey is marked
"safe". Exercises the real end-to-end flow (not a synthetic DB insert) to
confirm alerts_router.py's list_alerts/get_alert now also strip exact
location once the related journey's status flips to "safe" - same rule as
the Guardian page, applied consistently across both surfaces.

Synthetic data only. No coordinates/tokens are printed.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')

OWNER_EMAIL = "voicetest2026@example.com"
OWNER_PASS = "TestPass123!"
RECIPIENT_EMAIL = "fir-test-user2@example.com"
RECIPIENT_PASS = "TestPass456!"
RECIPIENT_PHONE = "9000000002"
SYN_LAT, SYN_LNG = 12.9716, 77.5946


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.skip("login failed for a test account")
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASS)


@pytest.fixture(scope="module")
def recipient_token():
    return _login(RECIPIENT_EMAIL, RECIPIENT_PASS)


def test_already_issued_alert_loses_location_once_journey_marked_safe(owner_token, recipient_token):
    h_o = {"Authorization": f"Bearer {owner_token}"}
    h_r = {"Authorization": f"Bearer {recipient_token}"}
    perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
             "temp_location": True, "emergency_requests": True}
    link_resp = requests.post(f"{BASE_URL}/api/trusted-circle/invite",
                               json={"name": "QA Safe Follow-up", "phone": RECIPIENT_PHONE, "permissions": perms},
                               headers=h_o)
    assert link_resp.status_code == 200
    link_id = link_resp.json()["id"]
    requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "accept"}, headers=h_r)

    j = requests.post(f"{BASE_URL}/api/journey/status",
                       json={"destination": "QA Safe Follow-up Journey", "duration_mins": 30, "recipient_link_ids": [link_id]},
                       headers=h_o)
    assert j.status_code == 201
    token = j.json()["token"]
    requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                    json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Safe Follow-up Area"}, headers=h_o)
    requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=h_o)
    time.sleep(0.4)

    alerts_before = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
    match = next(a for a in alerts_before if a.get("link_id") == link_id)
    detail_before = requests.get(f"{BASE_URL}/api/alerts/{match['id']}", headers=h_r).json()
    assert "lat" in detail_before["payload"].get("last_location", {}), \
        "sanity check: alert had coordinates before the journey was marked safe"

    requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=h_o)

    # Same alert ID, issued BEFORE the safe transition - must now be stripped.
    detail_after = requests.get(f"{BASE_URL}/api/alerts/{match['id']}", headers=h_r).json()
    assert "last_location" not in detail_after["payload"], \
        f"LEAK: already-issued alert still exposes location after journey marked safe: {detail_after['payload']}"
    assert detail_after["access_revoked"] is False, "link is still accepted - only location was stripped, not full access"

    list_after = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
    match_after = next(a for a in list_after if a["id"] == match["id"])
    assert "last_location" not in match_after["payload"], \
        "list endpoint must independently apply the same safe-journey check, not reuse a cached value"
