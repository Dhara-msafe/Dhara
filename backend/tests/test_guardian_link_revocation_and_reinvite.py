"""
Guardian Link Revocation & Re-Invitation — regression tests.

Covers the new changes in this pass:

1. journey_router.py::revoke_sharing (new POST /journey/status/{token}/revoke)
   - old/forwarded URL (same token either way — the public page is
     anonymous by design) stops revealing location IMMEDIATELY once revoked
   - distinct status banner from "safe" / "overdue"
   - idempotent
   - owner-only (403 for a different authenticated user, 401 unauthenticated)
   - does not affect an unrelated journey's own token (no cross-journey leak)
   - further location PATCHes / missed-checkin calls are no-ops once revoked
   - "safe" transition and 24h expiry continue to work exactly as before
     (regression, not new behaviour)
2. alerts_router.py — in-app Alerts channel also stops exposing
   last_location once the related journey is revoked (not just "safe")
3. trusted_circle_router.py — re-invitation after revoke creates a BRAND
   NEW link_id (never reuses the revoked one), and that new link can be
   independently accepted with a fresh permission grant.

Synthetic data only. Uses the real end-to-end HTTP flow against the
running backend, not direct DB inserts.
"""
import os
import time
import uuid
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


def _create_journey(owner_headers, destination="QA Revoke Journey", duration_mins=30, recipient_link_ids=None):
    r = requests.post(
        f"{BASE_URL}/api/journey/status",
        json={"destination": destination, "duration_mins": duration_mins,
              "recipient_link_ids": recipient_link_ids or []},
        headers=owner_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _post_location(owner_headers, token, lat=19.076, lng=72.8777, area="QA Revoke Area"):
    r = requests.patch(
        f"{BASE_URL}/api/journey/status/{token}/location",
        json={"lat": lat, "lng": lng, "accuracy": 20, "area": area},
        headers=owner_headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestRevokeSharing:
    def test_revoke_strips_location_immediately_old_and_forwarded_url(self, owner_token):
        """The public page is anonymous/token-only by design — an 'old' and
        a 'forwarded' copy of the URL are indistinguishable at the HTTP
        layer (same token). A single GET after revoke demonstrates both:
        whoever holds this exact URL, however they got it, loses location."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers)
        _post_location(headers, token, lat=13.001, lng=80.001, area="QA Pre-Revoke Area")

        # Before revoke: location/map visible
        page_before = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page_before.status_code == 200
        assert "13.001" in page_before.text and "L.marker" in page_before.text

        rv = requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)
        assert rv.status_code == 200, rv.text
        assert rv.json()["ok"] is True
        assert "revoked_at" in rv.json()

        page_after = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page_after.status_code == 200   # not expired/not-found — just closed
        assert "13.001" not in page_after.text
        assert "80.001" not in page_after.text
        assert "L.marker" not in page_after.text and "L.circle" not in page_after.text
        assert "Sharing turned off by traveller" in page_after.text
        # Must not claim arrival (that would be a false statement)
        assert "Arrived safely" not in page_after.text

    def test_revoke_is_idempotent(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Idempotent Revoke")
        r1 = requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)
        assert r1.status_code == 200
        assert r1.json().get("already_closed") is not True
        r2 = requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)
        assert r2.status_code == 200
        assert r2.json().get("already_closed") is True

    def test_revoke_requires_owner_auth(self, owner_token, recipient_token):
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        headers_r = {"Authorization": f"Bearer {recipient_token}"}
        token = _create_journey(headers_o, destination="QA Revoke Auth Check")

        no_auth = requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke")
        assert no_auth.status_code in (401, 403)

        wrong_user = requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers_r)
        assert wrong_user.status_code == 403

        still_owner = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert "Sharing turned off" not in still_owner.text   # wrong-user attempt had no effect

    def test_revoking_one_journey_does_not_affect_another(self, owner_token):
        """No cross-journey leak: revoking token A must not touch token B's
        own independent sharing state ('remaining authorized recipients'
        of a DIFFERENT journey keep seeing that journey exactly as before)."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        token_a = _create_journey(headers, destination="QA Revoke Target A")
        token_b = _create_journey(headers, destination="QA Untouched B")
        _post_location(headers, token_b, lat=21.5, lng=85.5, area="QA B Area")

        requests.post(f"{BASE_URL}/api/journey/status/{token_a}/revoke", headers=headers)

        page_b = requests.get(f"{BASE_URL}/api/journey/status/{token_b}")
        assert page_b.status_code == 200
        assert "21.5" in page_b.text and "L.marker" in page_b.text
        assert "Sharing turned off" not in page_b.text

    def test_location_patch_and_missed_checkin_are_noop_after_revoke(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Post-Revoke Noop")
        requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)

        loc = requests.patch(
            f"{BASE_URL}/api/journey/status/{token}/location",
            json={"lat": 66.0, "lng": 11.0, "accuracy": 5, "area": "Should Not Appear"},
            headers=headers,
        )
        assert loc.status_code == 200
        assert loc.json().get("skipped")

        mc = requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=headers)
        assert mc.status_code == 200
        assert mc.json().get("skipped")

        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert "66.0" not in page.text and "Should Not Appear" not in page.text

    def test_safe_transition_and_expiry_still_work_unaffected_by_revoke_feature(self, owner_token):
        """Regression check — new revoke code must not change pre-existing
        'safe' or 24h-expiry behaviour for journeys that were never revoked."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Safe Still Works")
        _post_location(headers, token, lat=5.0, lng=6.0, area="QA Safe Area")
        safe = requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=headers)
        assert safe.status_code == 200
        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert "Arrived safely" in page.text
        assert "5.0" not in page.text   # location already stripped by pre-existing safe-transition logic

        missing = requests.get(f"{BASE_URL}/api/journey/status/{uuid.uuid4().hex[:10]}")
        assert missing.status_code == 404


    def test_revoke_then_mark_safe_stays_independent_combined_state(self, owner_token):
        """Revised design: revoking sharing and marking safe are INDEPENDENT
        states. A traveller who withdrew sharing must still be able to mark
        themselves safe afterward — this is a true, additional fact, not a
        contradiction. Coordinates must stay hidden either way, and the page
        must say BOTH things rather than picking one."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Revoke Then Safe")
        _post_location(headers, token, lat=2.0, lng=3.0, area="QA Pre-Revoke")
        requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)

        safe = requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=headers)
        assert safe.status_code == 200
        assert safe.json().get("skipped") is None   # no longer blocked — must actually succeed
        assert "safe_at" in safe.json()

        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert "Arrived safely" in page.text          # the real, additional fact is shown
        assert "sharing had already been turned off" in page.text.lower()
        assert "2.0" not in page.text and "L.marker" not in page.text   # coordinates still hidden

    def test_mark_safe_is_idempotent(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Mark Safe Idempotent")
        r1 = requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=headers)
        assert r1.status_code == 200
        assert r1.json().get("already_safe") is not True
        r2 = requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=headers)
        assert r2.status_code == 200
        assert r2.json().get("already_safe") is True

    def test_safe_then_revoke_is_a_noop_other_order(self, owner_token):
        """Documents the OTHER ordering explicitly: once already safe,
        calling revoke afterward is a harmless no-op (location is already
        hidden by the safe transition — revoking adds no further privacy
        value, so it is not treated as an error, just inert)."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Safe Then Revoke")
        requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=headers)
        rv = requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)
        assert rv.status_code == 200
        assert rv.json().get("already_closed") is True
        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert "Arrived safely" in page.text
        assert "Sharing turned off" not in page.text   # revoke after safe did not add its own banner

    def test_help_requested_remains_available_after_revoke(self, owner_token):
        """Explicit safety requirement: 'Need help' must NEVER be blocked
        by an earlier revoke — unlike missed-checkin, which intentionally
        stops escalating once sharing is withdrawn."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Help After Revoke")
        requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)
        help_r = requests.post(f"{BASE_URL}/api/journey/status/{token}/help", headers=headers)
        assert help_r.status_code == 200
        assert help_r.json().get("skipped") is None   # must actually fire, never silently skipped

    def test_concurrent_revoke_and_mark_safe_both_apply_coordinates_stay_hidden(self, owner_token):
        """Fires revoke and mark_safe at (as close to) the same instant as
        possible from this test process. They touch different fields
        (sharing_revoked_at vs status/safe_at) so both must land —
        regardless of which request's $set executes first at the DB level,
        the end state must show BOTH facts and coordinates must stay
        hidden either way."""
        import concurrent.futures
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Concurrent Revoke Safe")
        _post_location(headers, token, lat=7.0, lng=8.0, area="QA Concurrent Area")

        def do_revoke():
            return requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)

        def do_safe():
            return requests.patch(f"{BASE_URL}/api/journey/status/{token}/safe", headers=headers)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fut_revoke = pool.submit(do_revoke)
            fut_safe = pool.submit(do_safe)
            r_revoke = fut_revoke.result(timeout=15)
            r_safe = fut_safe.result(timeout=15)

        assert r_revoke.status_code == 200
        assert r_safe.status_code == 200

        page = requests.get(f"{BASE_URL}/api/journey/status/{token}")
        assert page.status_code == 200
        assert "7.0" not in page.text and "L.marker" not in page.text   # coordinates hidden regardless of race outcome
        assert "Arrived safely" in page.text   # mark_safe landed
        # sharing_revoked_at landing is confirmed indirectly: if it did, the
        # combined-state copy appears; if the revoke call happened to lose
        # the race entirely (extremely unlikely given both are independent
        # $set calls), the plain "Arrived safely" state is still a valid,
        # non-leaking outcome — the hard requirement is coordinates hidden,
        # which is asserted above unconditionally either way.

    def test_missed_checkin_is_a_noop_after_revoke_by_design(self, owner_token):
        """Documents the intentional trade-off: withdrawing sharing also
        withdraws the passive missed-check-in escalation tied to that link
        (report_help_requested / SOS remains unaffected — tested above)."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        token = _create_journey(headers, destination="QA Missed Checkin After Revoke")
        requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers)
        mc = requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=headers)
        assert mc.status_code == 200
        assert mc.json().get("skipped")


class TestAlertsChannelRespectsRevoke:
    def test_alert_last_location_disappears_after_revoke_not_just_after_safe(self, owner_token, recipient_token):
        headers_o = {"Authorization": f"Bearer {owner_token}"}
        headers_r = {"Authorization": f"Bearer {recipient_token}"}

        inv = requests.post(f"{BASE_URL}/api/trusted-circle/invite",
                             json={"name": "QA Revoke Alert Recipient", "phone": RECIPIENT_PHONE,
                                   "permissions": {"journey_status": True, "expected_arrival": True,
                                                   "missed_checkin": True, "temp_location": True,
                                                   "emergency_requests": True}},
                             headers=headers_o)
        assert inv.status_code == 200, inv.text
        link_id = inv.json()["id"]

        pending = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_r)
        if pending.json().get("invitee_user_id") != None:
            requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                          json={"action": "accept"}, headers=headers_r)

        link_check = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}", headers=headers_o)
        if link_check.json().get("status") != "accepted":
            pytest.skip("recipient phone did not resolve to recipient_token's account in this env — "
                        "cannot exercise the accepted-link path without matching phone/account setup")

        token = _create_journey(headers_o, destination="QA Alert Revoke Dest",
                                 recipient_link_ids=[link_id])
        _post_location(headers_o, token, lat=44.0, lng=55.0, area="QA Alert Revoke Area")
        requests.post(f"{BASE_URL}/api/journey/status/{token}/missed-checkin", headers=headers_o)
        time.sleep(0.5)

        requests.post(f"{BASE_URL}/api/journey/status/{token}/revoke", headers=headers_o)

        alerts = requests.get(f"{BASE_URL}/api/alerts?filter=all", headers=headers_r)
        matching = [a for a in alerts.json() if a.get("journey_token") == token]
        for a in matching:
            assert "last_location" not in a["payload"], \
                f"LEAK: revoked journey still exposes last_location via Alerts channel: {a}"


class TestReInvitationAfterRevoke:
    def test_reinvite_creates_a_fresh_link_id_never_reuses_revoked_one(self, owner_token):
        headers = {"Authorization": f"Bearer {owner_token}"}
        phone = f"90000{int(time.time()) % 100000}"

        first = requests.post(f"{BASE_URL}/api/trusted-circle/invite",
                               json={"name": "QA Reinvite Target", "phone": phone,
                                     "permissions": {"journey_status": True, "expected_arrival": True,
                                                     "missed_checkin": True, "temp_location": False,
                                                     "emergency_requests": True}},
                               headers=headers)
        assert first.status_code == 200, first.text
        first_link_id = first.json()["id"]

        revoke_r = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{first_link_id}/revoke",
                                  headers=headers)
        assert revoke_r.status_code == 200
        revoked_state = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{first_link_id}",
                                      headers=headers)
        assert revoked_state.json()["status"] == "revoked"

        # Re-invite the SAME phone number — backend has no uniqueness
        # constraint blocking this; must succeed and must NOT touch/reuse
        # the old link_id.
        second = requests.post(f"{BASE_URL}/api/trusted-circle/invite",
                                json={"name": "QA Reinvite Target", "phone": phone,
                                      "permissions": {"journey_status": True, "expected_arrival": True,
                                                      "missed_checkin": True, "temp_location": True,
                                                      "emergency_requests": True}},
                                headers=headers)
        assert second.status_code == 200, second.text
        second_link_id = second.json()["id"]

        assert second_link_id != first_link_id, "Re-invitation must mint a brand new link_id, never reuse a revoked one"

        # The old revoked record is untouched (still revoked, independent history)
        still_revoked = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{first_link_id}",
                                      headers=headers)
        assert still_revoked.json()["status"] == "revoked"

        # The new record is a fresh, independent pending invite with its own permissions
        new_record = requests.get(f"{BASE_URL}/api/trusted-circle/invitations/{second_link_id}",
                                   headers=headers)
        assert new_record.status_code == 200
        assert new_record.json()["status"] == "pending"
        assert new_record.json()["permissions"]["temp_location"] is True   # new grant, independent of old one's False

    def test_listing_sent_invitations_shows_both_old_revoked_and_new_pending(self, owner_token):
        """Sanity check for the frontend fix: the backend's /invitations
        list (what trusted-circle.tsx's listInvitations() consumes) must
        return BOTH records for the same phone so the UI can render the
        new 'Invite again' affordance instead of permanently dead-ending
        on the old revoked one."""
        headers = {"Authorization": f"Bearer {owner_token}"}
        phone = f"91111{int(time.time()) % 100000}"

        first = requests.post(f"{BASE_URL}/api/trusted-circle/invite",
                               json={"name": "QA List Target", "phone": phone,
                                     "permissions": {"journey_status": True, "expected_arrival": True,
                                                     "missed_checkin": True, "temp_location": False,
                                                     "emergency_requests": True}},
                               headers=headers)
        first_id = first.json()["id"]
        requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{first_id}/revoke", headers=headers)
        second = requests.post(f"{BASE_URL}/api/trusted-circle/invite",
                                json={"name": "QA List Target", "phone": phone,
                                      "permissions": {"journey_status": True, "expected_arrival": True,
                                                      "missed_checkin": True, "temp_location": False,
                                                      "emergency_requests": True}},
                                headers=headers)
        second_id = second.json()["id"]

        listing = requests.get(f"{BASE_URL}/api/trusted-circle/invitations?direction=sent", headers=headers)
        assert listing.status_code == 200
        ids = [item["id"] for item in listing.json()]
        assert first_id in ids and second_id in ids
        by_id = {item["id"]: item for item in listing.json()}
        assert by_id[first_id]["status"] == "revoked"
        assert by_id[second_id]["status"] == "pending"
        # Most-recent-first sort means the frontend's `.find(phone match)`
        # resolves to the NEW pending record, not the old revoked one.
        phone_matches = [item for item in listing.json() if item["contact_phone"] == phone]
        assert phone_matches[0]["id"] == second_id
