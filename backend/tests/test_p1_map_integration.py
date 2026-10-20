"""
P1 Map Integration — regression tests for the two backend-side changes:

1. journey_router.py::_notify_linked_recipients now includes lat/lng in the
   alert payload's last_location (previously area/accuracy/timestamp only).
   Verifies the EXISTING P0 permission enforcement (alerts_router.py
   _sanitize_location) correctly includes/excludes this new field exactly
   like it already does for the rest of last_location — no new leak path.

2. journey_router.py::_status_html now embeds an exact Leaflet/OpenStreetMap
   marker + accuracy circle on the public Guardian Share page (explicit
   user-approved privacy tradeoff), using NO Google Maps Platform API/key.

Synthetic data only. Uses the real end-to-end flow (create journey ->
PATCH location -> alert fan-out), not a direct DB insert, to exercise the
actual changed code path in journey_router.py.
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


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text}")
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASS)


@pytest.fixture(scope="module")
def recipient_token():
    return _login(RECIPIENT_EMAIL, RECIPIENT_PASS)


def _create_accepted_link(owner_token, recipient_token, temp_location: bool):
    headers_o = {"Authorization": f"Bearer {owner_token}"}
    headers_r = {"Authorization": f"Bearer {recipient_token}"}
    perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
             "temp_location": temp_location, "emergency_requests": True}
    body = {"name": "QA Map Integration", "phone": RECIPIENT_PHONE, "permissions": perms}
    r = requests.post(f"{BASE_URL}/api/trusted-circle/invite", json=body, headers=headers_o)
    assert r.status_code == 200, r.text
    link_id = r.json()["id"]
    r2 = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                        json={"action": "accept"}, headers=headers_r)
    assert r2.status_code == 200, r2.text
    return link_id


class TestRealEndToEndFlow_LocationInAlertPayload:
    def test_temp_location_true_link_gets_lat_lng_in_real_alert(self, owner_token, recipient_token):
        link_id = _create_accepted_link(owner_token, recipient_token, temp_location=True)
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        headers_r = {"Authorization": f"Bearer {recipient_token}"}

        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Map Dest", "duration_mins": 30, "recipient_link_ids": [link_id]},
                           headers=headers_o)
        assert j.status_code == 201, j.text
        token = j.json()["token"]

        loc = requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                              json={"lat": 12.9716, "lng": 77.5946, "accuracy": 15, "area": "QA Map Area"},
                              headers=headers_o)
        assert loc.status_code == 200, loc.text
        # update_location only persists the location on the journey record;
        # it does NOT itself fan out an alert. A lifecycle event (missed
        # check-in here) re-reads the fresh record (now including the
        # just-patched last_location) and triggers _notify_linked_recipients.
        mc = requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=headers_o)
        assert mc.status_code == 200, mc.text
        time.sleep(0.5)

        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers_r)
        assert alerts.status_code == 200
        matching = [a for a in alerts.json() if a.get("link_id") == link_id]
        assert matching, "No real alert was fanned out for this accepted link"
        last_loc = matching[0]["payload"].get("last_location")
        assert last_loc is not None, "Expected last_location for a temp_location=true recipient"
        assert last_loc.get("lat") == 12.9716
        assert last_loc.get("lng") == 77.5946

    def test_temp_location_false_link_never_gets_lat_lng(self, owner_token, recipient_token):
        link_id = _create_accepted_link(owner_token, recipient_token, temp_location=False)
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        headers_r = {"Authorization": f"Bearer {recipient_token}"}

        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Map Dest 2", "duration_mins": 30, "recipient_link_ids": [link_id]},
                           headers=headers_o)
        assert j.status_code == 201, j.text
        token = j.json()["token"]

        loc = requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                              json={"lat": 13.0, "lng": 78.0, "accuracy": 15, "area": "QA Map Area 2"},
                              headers=headers_o)
        assert loc.status_code == 200, loc.text
        mc = requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=headers_o)
        assert mc.status_code == 200, mc.text
        time.sleep(0.5)

        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers_r)
        matching = [a for a in alerts.json() if a.get("link_id") == link_id]
        assert matching, "No real alert was fanned out for this accepted link"
        payload = matching[0]["payload"]
        assert "last_location" not in payload, \
            f"LEAK: temp_location=false recipient received last_location: {payload}"
        assert "13.0" not in str(payload) and "78.0" not in str(payload)


class TestGuardianPageMapRendering:
    def test_guardian_page_renders_leaflet_map_with_marker(self, owner_token):
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Guardian Render", "duration_mins": 30, "recipient_link_ids": []},
                           headers=headers_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": 19.076, "lng": 72.8777, "accuracy": 25, "area": "QA Render Area"},
                        headers=headers_o)
        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.status_code == 200
        html = page.text
        assert "leaflet" in html.lower()
        assert "19.076" in html and "72.8777" in html
        assert "L.marker" in html and "L.circle" in html
        assert "maps.googleapis.com" not in html

    def test_guardian_page_no_map_block_when_no_location_yet(self, owner_token):
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA No Location Yet", "duration_mins": 30, "recipient_link_ids": []},
                           headers=headers_o)
        token = j.json()["token"]
        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.status_code == 200
        # No location ever posted -> no map script should be injected
        assert "L.marker" not in page.text

    def test_guardian_page_sets_strict_referrer_policy(self, owner_token):
        """P1 follow-up: tile requests to tile.openstreetmap.org are
        cross-origin - confirm we explicitly pin a strict Referrer-Policy
        (both response header and <meta> tag) rather than relying on an
        implicit browser default, so the token-bearing page path is never
        sent to the third-party tile provider."""
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Referrer Test", "duration_mins": 30, "recipient_link_ids": []},
                           headers=headers_o)
        token = j.json()["token"]
        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.headers.get("referrer-policy") == "strict-origin"
        assert '<meta name="referrer" content="strict-origin"/>' in page.text
