"""
P1 Map Integration — LOCATION AUTHORIZATION BOUNDARY TESTS.

Exhaustive, synthetic-data-only coverage of every path that can put an
exact latitude/longitude in front of a viewer: _notify_linked_recipients
(alert fan-out), GET /api/alerts + /api/alerts/{id} (Trusted Circle
recipient), and GET /api/journey/status/{token} (public Guardian page).

Every test re-checks CURRENT authorization at request time — nothing here
relies on a cached/previous state. No raw coordinates or access tokens are
ever printed; assertion messages intentionally avoid echoing them.
"""
import os
import time
import uuid
import pytest
import requests
import motor.motor_asyncio
import asyncio
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')
MONGO_URL = "mongodb://localhost:27017"

OWNER_EMAIL = "voicetest2026@example.com"
OWNER_PASS = "TestPass123!"
RECIPIENT_EMAIL = "fir-test-user2@example.com"
RECIPIENT_PASS = "TestPass456!"
RECIPIENT_PHONE = "9000000002"

SYN_LAT, SYN_LNG = 12.9716, 77.5946  # synthetic coordinates, not a real location


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.skip("login failed for a test account")
    return r.json().get("token") or r.json().get("access_token")


def _db_name():
    import re
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", ".env")) as f:
            for line in f:
                m = re.match(r'^DB_NAME=["\']?([^"\'\n]+)', line)
                if m:
                    return m.group(1)
    except Exception:
        pass
    return "dhara"


async def _force_expire(token: str):
    """Synthetic-only: push a test journey's expires_at into the past so the
    24h TTL path can be exercised without waiting 24 real hours."""
    client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
    db = client[_db_name()]
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    await db.safety_journeys.update_one({"token": token}, {"$set": {"expires_at": past}})
    client.close()


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASS)


@pytest.fixture(scope="module")
def recipient_token():
    return _login(RECIPIENT_EMAIL, RECIPIENT_PASS)


def _create_link(owner_token, recipient_token, temp_location):
    h_o = {"Authorization": f"Bearer {owner_token}"}
    h_r = {"Authorization": f"Bearer {recipient_token}"}
    perms = {"journey_status": True, "expected_arrival": True, "missed_checkin": True,
             "temp_location": temp_location, "emergency_requests": True}
    r = requests.post(f"{BASE_URL}/api/trusted-circle/invite",
                       json={"name": "QA Boundary", "phone": RECIPIENT_PHONE, "permissions": perms},
                       headers=h_o)
    assert r.status_code == 200
    return r.json()["id"], h_o, h_r


def _create_journey_and_alert(owner_token, link_id, dest="QA Boundary Journey"):
    """Real end-to-end flow: create journey -> patch location -> missed-checkin
    (fans out an alert that includes whatever last_location currently holds)."""
    h_o = {"Authorization": f"Bearer {owner_token}"}
    j = requests.post(f"{BASE_URL}/api/journey/status",
                       json={"destination": dest, "duration_mins": 30, "recipient_link_ids": [link_id]},
                       headers=h_o)
    assert j.status_code == 201
    token = j.json()["token"]
    loc = requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                          json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Boundary Area"},
                          headers=h_o)
    assert loc.status_code == 200
    mc = requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=h_o)
    assert mc.status_code == 200
    time.sleep(0.4)
    return token


class TestPendingInvitation_NeverReceivesAnAlert:
    def test_pending_link_gets_no_alert_at_all(self, owner_token, recipient_token):
        h_o = {"Authorization": f"Bearer {owner_token}"}
        link_id, _, h_r = _create_link(owner_token, recipient_token, temp_location=True)
        # Deliberately NOT accepted/declined - still pending.
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Pending Test", "duration_mins": 30, "recipient_link_ids": [link_id]},
                           headers=h_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Area"}, headers=h_o)
        requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=h_o)
        time.sleep(0.4)
        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
        matching = [a for a in alerts if a.get("link_id") == link_id]
        assert matching == [], "A PENDING (not-yet-accepted) link must never receive a fanned-out alert"


class TestAcceptedRecipient_PermissionGated:
    def test_accepted_true_gets_coordinates(self, owner_token, recipient_token):
        link_id, h_o, h_r = _create_link(owner_token, recipient_token, temp_location=True)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "accept"}, headers=h_r)
        _create_journey_and_alert(owner_token, link_id)
        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
        match = next(a for a in alerts if a.get("link_id") == link_id)
        detail = requests.get(f"{BASE_URL}/api/alerts/{match['id']}", headers=h_r).json()
        assert detail["payload"]["last_location"]["lat"] == SYN_LAT
        assert detail["access_revoked"] is False

    def test_accepted_false_never_gets_coordinates(self, owner_token, recipient_token):
        link_id, h_o, h_r = _create_link(owner_token, recipient_token, temp_location=False)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "accept"}, headers=h_r)
        _create_journey_and_alert(owner_token, link_id)
        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
        match = next(a for a in alerts if a.get("link_id") == link_id)
        detail = requests.get(f"{BASE_URL}/api/alerts/{match['id']}", headers=h_r).json()
        assert "last_location" not in detail["payload"]


class TestRevocationBlocksPreviouslyIssuedAlerts:
    def test_revoke_after_real_alert_already_issued(self, owner_token, recipient_token):
        link_id, h_o, h_r = _create_link(owner_token, recipient_token, temp_location=True)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "accept"}, headers=h_r)
        _create_journey_and_alert(owner_token, link_id, dest="QA Revoke Test")
        alerts_before = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
        match = next(a for a in alerts_before if a.get("link_id") == link_id)
        detail_before = requests.get(f"{BASE_URL}/api/alerts/{match['id']}", headers=h_r).json()
        assert "lat" in detail_before["payload"].get("last_location", {}), "sanity check: alert had coordinates before revoke"

        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/revoke", headers=h_o)

        # Same alert ID, same link, issued BEFORE revocation — must now be blocked.
        detail_after = requests.get(f"{BASE_URL}/api/alerts/{match['id']}", headers=h_r).json()
        assert detail_after["access_revoked"] is True
        assert detail_after["payload"] == {}
        list_after = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
        match_after = next(a for a in list_after if a["id"] == match["id"])
        assert match_after["payload"] == {}, "list endpoint must independently re-check, not reuse a cached permission"

    def test_revoked_recipient_cannot_regain_access_by_reaccepting(self, owner_token, recipient_token):
        link_id, h_o, h_r = _create_link(owner_token, recipient_token, temp_location=True)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "accept"}, headers=h_r)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/revoke", headers=h_o)
        retry = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "accept"}, headers=h_r)
        assert retry.status_code == 400, "a revoked link's token must not be reusable to regain access"


class TestDeclinedInvitation:
    def test_declined_link_gets_no_coordinates(self, owner_token, recipient_token):
        link_id, h_o, h_r = _create_link(owner_token, recipient_token, temp_location=True)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "decline"}, headers=h_r)
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Declined Test", "duration_mins": 30, "recipient_link_ids": [link_id]},
                           headers=h_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Area"}, headers=h_o)
        requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=h_o)
        time.sleep(0.4)
        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
        assert [a for a in alerts if a.get("link_id") == link_id] == [], \
            "a DECLINED link must never receive a fanned-out alert"


class TestDifferentSignedInUser:
    def test_unrelated_authenticated_user_cannot_read_someone_elses_alert(self, owner_token, recipient_token):
        link_id, h_o, h_r = _create_link(owner_token, recipient_token, temp_location=True)
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond", json={"action": "accept"}, headers=h_r)
        _create_journey_and_alert(owner_token, link_id, dest="QA Cross-User Test")
        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=h_r).json()
        match = next(a for a in alerts if a.get("link_id") == link_id)
        # Owner A's own token (a DIFFERENT signed-in identity than the
        # recipient this alert belongs to) must be denied, not silently
        # given a filtered view.
        cross_resp = requests.get(f"{BASE_URL}/api/alerts/{match['id']}", headers=h_o)
        assert cross_resp.status_code == 403


class TestExpiredGuardianAccess:
    def test_expired_guardian_token_returns_410_with_no_location(self, owner_token):
        h_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Expiry Test", "duration_mins": 30, "recipient_link_ids": []},
                           headers=h_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Area"}, headers=h_o)
        asyncio.get_event_loop().run_until_complete(_force_expire(token))

        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.status_code == 410
        html = page.text
        assert "expired" in html.lower()
        assert "leaflet" not in html.lower()
        assert str(SYN_LAT) not in html and str(SYN_LNG) not in html


class TestForwardedGuardianLink:
    def test_two_independent_requests_see_identical_authorized_view(self, owner_token):
        """Simulates the link being forwarded to a second person: two
        separate, unauthenticated HTTP sessions requesting the same token.
        By design (public, token-in-URL, time-boxed) both get the SAME
        view - this is not a per-recipient-permission-gated page like
        Trusted Circle alerts. Confirms this stays within its documented
        scope: nothing beyond what the owner explicitly shared, and only
        until the 24h expiry - never more than that, regardless of who or
        how many people open it."""
        h_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Forward Test", "duration_mins": 30, "recipient_link_ids": []},
                           headers=h_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Forwarded Area"}, headers=h_o)

        session_person_1 = requests.Session()
        session_person_2 = requests.Session()
        resp1 = session_person_1.get(f"{BASE_URL}/api/journey/status/{token}")
        resp2 = session_person_2.get(f"{BASE_URL}/api/journey/status/{token}")
        assert resp1.status_code == 200 and resp2.status_code == 200
        # Compare the meaningful content, not raw byte-equality - a relative
        # "updated Xs/Xm ago" timestamp string can legitimately tick over
        # between two near-simultaneous requests without that being an
        # authorization difference.
        for marker in ("QA Forwarded Area", "leaflet", "L.marker", str(SYN_LAT), str(SYN_LNG)):
            assert (marker in resp1.text) == (marker in resp2.text), \
                f"forwarding changed whether '{marker}' appears - unexpected access difference"
        assert "QA Forwarded Area" in resp1.text

    def test_guardian_page_location_and_map_removed_after_marked_safe(self, owner_token):
        """UPDATED per the P1 follow-up GO: once 'safe', exact coordinates
        and the map must disappear - 'Arrived safely' and non-location
        fields (traveller, destination, timestamps) remain."""
        h_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Safe Test", "duration_mins": 30, "recipient_link_ids": []},
                           headers=h_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Safe Area"}, headers=h_o)
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=h_o)
        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.status_code == 200
        html = page.text
        assert "Arrived safely" in html
        assert "QA Safe Test" in html  # non-location field (destination) preserved
        assert "leaflet" not in html.lower()
        assert str(SYN_LAT) not in html and str(SYN_LNG) not in html
        assert "QA Safe Area" not in html, "area text must also be removed once safe"

    def test_existing_forwarded_link_loses_location_after_safe(self, owner_token):
        """An 'existing forwarded link' scenario: a second viewer opens the
        SAME already-circulating token both BEFORE and AFTER the journey is
        marked safe - must see location before, and lose it after, exactly
        like the first viewer (no caching/staleness loophole)."""
        h_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Forward Safe Test", "duration_mins": 30, "recipient_link_ids": []},
                           headers=h_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Forward Area"}, headers=h_o)

        forwarded_viewer = requests.Session()
        before = forwarded_viewer.get(f"{BASE_URL}/api/journey/status/{token}")
        assert "leaflet" in before.text.lower() and str(SYN_LAT) in before.text

        requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=h_o)

        after = forwarded_viewer.get(f"{BASE_URL}/api/journey/status/{token}")
        assert "leaflet" not in after.text.lower()
        assert str(SYN_LAT) not in after.text and str(SYN_LNG) not in after.text
        assert "Arrived safely" in after.text

    def test_expiry_behaviour_unaffected_by_safe_change(self, owner_token):
        """Preserve existing expiry behaviour for the rest of the page -
        this change must not interact with the 24h TTL path at all."""
        h_o = {"Authorization": f"Bearer {owner_token}"}
        j = requests.post(f"{BASE_URL}/api/journey/status",
                           json={"destination": "QA Expiry Still Works", "duration_mins": 30, "recipient_link_ids": []},
                           headers=h_o)
        token = j.json()["token"]
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/location",
                        json={"lat": SYN_LAT, "lng": SYN_LNG, "accuracy": 12, "area": "QA Area"}, headers=h_o)
        asyncio.get_event_loop().run_until_complete(_force_expire(token))
        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.status_code == 410
        assert "expired" in page.text.lower()
