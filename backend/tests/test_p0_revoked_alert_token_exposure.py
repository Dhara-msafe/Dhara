"""
P0 - Revoked-alert token exposure (smallest fix, scoped to this blocker only).

ROOT CAUSE: `_public_alert()` in api/alerts_router.py previously returned
`journey_token` UNCONDITIONALLY on every alert, regardless of the
recipient's permission standing. `journey_token` is a bearer-style
credential for the Guardian page (/api/journey/status/{token}), which is
documented as anonymous and possession-based (no per-recipient permission
check of its own, all-or-nothing). A recipient whose alert-type permission
was denied/narrowed (ACCESS_REVOKED) -- or who never had `temp_location`
consent at all, or whose journey had already closed -- could still read the
raw token from ANY alert response and use it to view full, unredacted
location directly via the Guardian page, completely bypassing every
in-app permission check.

FIX: `journey_token` is now disclosed only when
_exact_location_permission_live(link, journey) is True AND the alert's
own type-permission is granted (not revoked) -- i.e. only to a recipient
who could already see exact location in-app anyway. Legitimate authorized
access (accepted link, temp_location=True, open journey, type permission
granted) is preserved unchanged.

Direct unit tests against the pure functions -- no DB, no network, no live
server. Synthetic fixtures only; no real recipients, no real tokens.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api.alerts_router import (  # noqa: E402
    _public_alert,
    _exact_location_permission_live,
    _sanitize_location,
)

SYNTH_TOKEN = "synthetic-test-token-do-not-use"

ACCEPTED_WITH_LOCATION = {
    "id": "linkA", "status": "accepted", "invitee_user_id": "u_r",
    "permissions": {"journey_status": True, "temp_location": True, "emergency_requests": True},
}
ACCEPTED_NO_LOCATION = {
    "id": "linkB", "status": "accepted", "invitee_user_id": "u_r",
    "permissions": {"journey_status": True, "temp_location": False, "emergency_requests": True},
}
ACCEPTED_NO_EMERGENCY_BUT_HAS_LOCATION = {
    "id": "linkC", "status": "accepted", "invitee_user_id": "u_r",
    "permissions": {"journey_status": True, "temp_location": True, "emergency_requests": False},
}
REVOKED_LINK_WITH_LOCATION_FLAG = {
    "id": "linkD", "status": "revoked", "invitee_user_id": "u_r",
    "permissions": {"journey_status": True, "temp_location": True, "emergency_requests": True},
}
OPEN_JOURNEY = {"token": SYNTH_TOKEN, "status": "active"}
SAFE_JOURNEY = {"token": SYNTH_TOKEN, "status": "safe"}
REVOKED_SHARING_JOURNEY = {"token": SYNTH_TOKEN, "status": "active", "sharing_revoked_at": "2026-06-01T00:00:00Z"}


def _alert(type_="journey_status", link_id="linkA", token=SYNTH_TOKEN):
    return {
        "id": "a1", "type": type_, "owner_name": "Owner", "link_id": link_id,
        "journey_token": token, "payload": {"destination": "QA", "last_location": {"lat": 1, "lng": 2}},
        "state": "QUEUED", "created_at": "2026-06-01T09:00:00Z", "read_at": None, "acknowledged_at": None,
    }


class TestTokenWithheldWhenAccessRevoked:
    def test_token_is_none_when_type_permission_denied(self):
        out = _public_alert(_alert("help_requested", "linkC"), ACCEPTED_NO_EMERGENCY_BUT_HAS_LOCATION, OPEN_JOURNEY)
        assert out["access_revoked"] is True
        assert out["journey_token"] is None, "a recipient denied this alert type must never receive the Guardian token"

    def test_token_is_none_when_link_is_revoked(self):
        out = _public_alert(_alert("journey_status", "linkD"), REVOKED_LINK_WITH_LOCATION_FLAG, OPEN_JOURNEY)
        assert out["journey_token"] is None


class TestTokenWithheldWithoutTempLocationEvenIfNotRevoked:
    """The pre-fix bug: a FULLY ACCEPTED recipient with temp_location=False
    (i.e. explicitly denied exact location in-app) was still handed the
    raw Guardian token on every non-revoked alert -- this is the actual
    bypass path, independent of the 'revoked' flag."""

    def test_accepted_recipient_without_location_consent_gets_no_token(self):
        out = _public_alert(_alert("journey_status", "linkB"), ACCEPTED_NO_LOCATION, OPEN_JOURNEY)
        assert out["access_revoked"] is False, "journey_status permission IS granted here"
        assert out["journey_token"] is None, "temp_location is False -- token must still be withheld"

    def test_missing_link_gets_no_token(self):
        out = _public_alert(_alert("journey_status", "linkX"), None, OPEN_JOURNEY)
        assert out["journey_token"] is None


class TestTokenWithheldAfterJourneyCloses:
    def test_token_withheld_once_journey_marked_safe(self):
        out = _public_alert(_alert("journey_status", "linkA"), ACCEPTED_WITH_LOCATION, SAFE_JOURNEY)
        assert out["journey_token"] is None, "journey is safe/closed -- token must stop being disclosed"

    def test_token_withheld_once_sharing_revoked(self):
        out = _public_alert(_alert("journey_status", "linkA"), ACCEPTED_WITH_LOCATION, REVOKED_SHARING_JOURNEY)
        assert out["journey_token"] is None


class TestLegitimateAuthorizedAccessPreserved:
    """The fix must NOT regress the happy path: an accepted recipient with
    temp_location=True, on an open journey, for a granted alert type, must
    still receive the token (needed for any future authorized in-app use)."""

    def test_fully_authorized_recipient_still_gets_token(self):
        out = _public_alert(_alert("journey_status", "linkA"), ACCEPTED_WITH_LOCATION, OPEN_JOURNEY)
        assert out["access_revoked"] is False
        assert out["journey_token"] == SYNTH_TOKEN

    def test_fully_authorized_recipient_still_gets_location_payload(self):
        out = _public_alert(_alert("journey_status", "linkA"), ACCEPTED_WITH_LOCATION, OPEN_JOURNEY)
        assert out["payload"].get("last_location") == {"lat": 1, "lng": 2}

    def test_journey_token_absent_alert_still_returns_none_cleanly(self):
        """An alert with no journey_token at all (e.g. a non-journey alert)
        must not error -- it simply has nothing to withhold or disclose."""
        out = _public_alert(_alert("journey_status", "linkA", token=None), ACCEPTED_WITH_LOCATION, None)
        assert out["journey_token"] is None


class TestSanitizeLocationUnaffectedByRefactor:
    """_sanitize_location's own externally-visible behaviour (last_location
    stripping) must be byte-for-byte identical to before this refactor --
    only journey_token disclosure is new; location-field stripping logic
    itself was only extracted into a shared helper, not changed."""

    def test_location_present_when_permitted(self):
        out = _sanitize_location({"last_location": {"lat": 1}}, ACCEPTED_WITH_LOCATION, OPEN_JOURNEY)
        assert "last_location" in out

    def test_location_absent_when_temp_location_false(self):
        out = _sanitize_location({"last_location": {"lat": 1}}, ACCEPTED_NO_LOCATION, OPEN_JOURNEY)
        assert "last_location" not in out

    def test_location_absent_once_journey_safe(self):
        out = _sanitize_location({"last_location": {"lat": 1}}, ACCEPTED_WITH_LOCATION, SAFE_JOURNEY)
        assert "last_location" not in out

    def test_does_not_mutate_input_payload(self):
        original = {"last_location": {"lat": 1}}
        _sanitize_location(original, ACCEPTED_NO_LOCATION, OPEN_JOURNEY)
        assert "last_location" in original, "must return a new dict, never mutate the source payload"


class TestExactLocationPermissionLiveHelper:
    def test_true_only_when_accepted_temp_location_and_open(self):
        assert _exact_location_permission_live(ACCEPTED_WITH_LOCATION, OPEN_JOURNEY) is True

    def test_false_when_missing_link(self):
        assert _exact_location_permission_live(None, OPEN_JOURNEY) is False

    def test_false_when_temp_location_not_true(self):
        assert _exact_location_permission_live(ACCEPTED_NO_LOCATION, OPEN_JOURNEY) is False

    def test_false_when_journey_safe(self):
        assert _exact_location_permission_live(ACCEPTED_WITH_LOCATION, SAFE_JOURNEY) is False

    def test_false_when_sharing_revoked_at_set(self):
        assert _exact_location_permission_live(ACCEPTED_WITH_LOCATION, REVOKED_SHARING_JOURNEY) is False

    def test_true_when_journey_is_none_entirely(self):
        """No journey record (e.g. deleted) must not itself block a
        legitimately-permitted recipient -- only an explicitly CLOSED
        journey (safe/revoked) blocks; absence is treated as 'no closure
        signal available', consistent with pre-existing _sanitize_location
        behaviour before this refactor."""
        assert _exact_location_permission_live(ACCEPTED_WITH_LOCATION, None) is True
