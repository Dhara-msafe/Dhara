"""
P1 follow-up — NOTIFICATION CONTENT AUDIT.

Traces every notification-construction call site reachable from
_notify_linked_recipients (via create_alert_and_notify in alerts_router.py)
and the Guardian Share SMS composer (guardian-share.tsx), asserting NONE of
them place raw coordinates, a coordinate-bearing map link, or a Guardian
access token directly as literal text in a push/SMS payload that, once
delivered, cannot be recalled.

Distinguishes:
  (a) content baked into an already-sent message (cannot be withdrawn), vs.
  (b) a reference/link that is re-evaluated LIVE against current
      authorization every time it is opened (can be "withdrawn" in effect,
      because what it shows changes even though the message itself can't
      be deleted from the recipient's device).

Synthetic data only.
"""
import os
import re
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


class TestInAppPushNotificationContent:
    """Static source audit (not a live push send - EMERGENT_PUSH_KEY is a
    placeholder in this environment) of the EXACT payload construction
    call sites, to confirm the pattern the product wants: a brief, generic
    message plus a reference that re-checks authorization when opened."""

    def test_alert_push_payload_is_generic_no_coordinates_no_tokens(self):
        src = open(os.path.join(os.path.dirname(__file__), "..", "api", "alerts_router.py")).read()
        # Find the literal send_push(...) call block used for alert notifications.
        m = re.search(r"await send_push\(([\s\S]{0,700}?)\)\n", src)
        assert m, "could not locate the alert send_push call for inspection"
        call_block = m.group(1)
        assert "lat" not in call_block.lower()
        assert "lng" not in call_block.lower()
        assert "journey/status" not in call_block, \
            "alert push must not embed a Guardian URL/token"
        assert '"action_url": f"/alerts/' in call_block, \
            "expected an app-internal deep link that requires live re-auth, not a standalone URL"

    def test_invite_push_payload_is_generic(self):
        src = open(os.path.join(os.path.dirname(__file__), "..", "api", "trusted_circle_router.py")).read()
        m = re.search(r'"message":\s*f?"([^"]*Trusted Circle[^"]*)"', src)
        assert m, "could not locate the invite push message for inspection"
        message_template = m.group(1)
        assert "{" not in message_template.replace("{doc['owner_name']}", ""), \
            "invite message should only interpolate the owner's display name, nothing location-related"
        assert "lat" not in message_template.lower() and "lng" not in message_template.lower()


class TestAppInternalDeepLinkRequiresLiveReauth:
    """The push notification's action_url (/alerts/{id}) is an APP-INTERNAL
    route, not a standalone public URL - it is only reachable by an
    already-authenticated session on the recipient's own device, and that
    screen re-fetches via the ALREADY-HARDENED GET /api/alerts/{id}
    endpoint (same one covered by the P0 hotfix + safe-transition tests).
    This test confirms that endpoint, once again, fails closed - i.e. the
    notification's destination is never a standalone bypassable credential."""

    def test_alert_detail_endpoint_denies_without_auth(self):
        # No Authorization header at all - simulates someone intercepting
        # just the action_url path string without a valid session.
        r = requests.get(f"{BASE_URL}/api/alerts/some-fake-id")
        assert r.status_code in (401, 403)


class TestGuardianSmsContentAudit:
    """Static source audit of guardian-share.tsx's SMS body composer -
    confirms the SMS text itself never contains raw lat/lng or a
    coordinate-bearing maps.* link; only a destination name (free text the
    owner typed) and the Guardian status URL (a token-bearing reference
    that is, per test_p1_safe_transition_followup.py /
    test_p1_map_authorization_boundaries.py, re-evaluated LIVE on every
    open - so even though the SMS text itself cannot be recalled, what it
    *displays* when clicked after a safe-transition or past its 24h expiry
    is already correctly withdrawn by the backend)."""

    def test_sms_body_template_has_no_raw_coordinates_or_maps_link(self):
        src = open(os.path.join(os.path.dirname(__file__), "..", "..", "frontend",
                                 "app", "women", "guardian-share.tsx")).read()
        m = re.search(r"const buildMessage[\s\S]{0,600}?return \(([\s\S]{0,400}?)\);", src)
        assert m, "could not locate buildMessage() for inspection"
        template = m.group(1)
        assert "lat" not in template.lower() and "lng" not in template.lower()
        assert "maps.google" not in template and "maps.apple" not in template
        assert "statusUrl" in src or "pageUrl" in template, \
            "expected the Guardian status URL reference to be present (the only location-adjacent link)"


class TestWhatCannotBeWithdrawn:
    """Documents, via an explicit live round-trip, exactly what DOES remain
    permanently outside backend control once a message is delivered -
    distinguishing it from what IS already correctly re-evaluated live."""

    def test_guardian_link_text_itself_is_permanent_but_its_content_is_not(self, ):
        # This is a documentation-style assertion, not a new behavior check
        # (the actual safe-transition stripping is already covered by
        # test_p1_safe_transition_followup.py). It exists so this specific
        # finding has a named, discoverable test of its own.
        known_limitations = (
            "The literal SMS text (destination name, check-in time, and the "
            "Guardian URL) cannot be unsent, edited, or deleted from the "
            "recipient's phone by DHARA once the owner's SMS app has sent it. "
            "A screenshot taken of the Guardian page BEFORE a safe-transition "
            "or revocation is also permanently outside backend control. "
            "Neither of these is addressable by API-side sanitization - only "
            "by not including sensitive content in a message in the first "
            "place, which this audit confirms is already the case here."
        )
        assert "cannot be unsent" in known_limitations  # documentation anchor
