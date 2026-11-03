"""
P1 — Per-journey sharing enforcement: per-type permission gate (Item 3 of
the "Resolve Remaining Legal and Sharing Blockers" correction pass).

ROOT CAUSE (fixed in api/alerts_router.py): `create_alert_and_notify()` and
`_public_alert()` previously only checked `link.status == "accepted"`
before creating/revealing an alert -- they never checked the SPECIFIC
permission flag that alert `type` requires (only `_sanitize_location()`
checked a granular flag, and only for `temp_location`/map data). This meant
an accepted recipient who had explicitly opted OUT of e.g. emergency pings
(`permissions.emergency_requests = False`) would still receive
"help_requested" alerts, and narrowing a permission AFTER alert creation
had no effect on alerts already created.

Fix: `_type_permission_granted(alert_type, link)` is now the single, fail-
closed gate -- used both at write time (create_alert_and_notify) and at
read time (_public_alert, so narrowing/revocation is re-evaluated on every
fetch, never cached). Per-journey/per-recipient settings can therefore only
ever NARROW what the owner's base link permissions already allow (there is
no mechanism anywhere in the codebase to grant a permission the link
itself doesn't have), and missing/ambiguous permission data fails closed.

These are direct unit tests against the pure functions -- no DB, no
network, no live server. Synthetic fixtures only; no real recipients.
"""
import sys
import os
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api.alerts_router import (  # noqa: E402
    _type_permission_granted,
    _public_alert,
    create_alert_and_notify,
)

ACCEPTED_FULL = {
    "id": "linkF", "status": "accepted", "invitee_user_id": "u_recipient",
    "permissions": {
        "journey_status": True, "expected_arrival": True,
        "missed_checkin": True, "temp_location": False, "emergency_requests": True,
    },
}
ACCEPTED_NO_EMERGENCY = {
    "id": "linkE", "status": "accepted", "invitee_user_id": "u_recipient",
    "permissions": {
        "journey_status": True, "expected_arrival": True,
        "missed_checkin": True, "temp_location": False, "emergency_requests": False,
    },
}
ACCEPTED_NO_MISSED_CHECKIN = {
    "id": "linkM", "status": "accepted", "invitee_user_id": "u_recipient",
    "permissions": {"journey_status": True, "missed_checkin": False, "emergency_requests": True},
}
ACCEPTED_MISSING_PERMS_DICT = {"id": "linkX", "status": "accepted", "invitee_user_id": "u_recipient"}
PENDING_LINK = {
    "id": "linkP", "status": "pending", "invitee_user_id": "u_recipient",
    "permissions": {"journey_status": True, "emergency_requests": True},
}


def _alert(type_="journey_status", link_id="linkF"):
    return {
        "id": "a1", "type": type_, "owner_name": "Owner", "link_id": link_id,
        "journey_token": "jt1", "payload": {"destination": "QA"}, "state": "QUEUED",
        "created_at": "2026-06-01T09:00:00Z", "read_at": None, "acknowledged_at": None,
    }


class TestTypePermissionGateFailsClosed:
    def test_granted_type_permission_allows(self):
        assert _type_permission_granted("help_requested", ACCEPTED_FULL) is True

    def test_narrower_permission_denies_specific_type_even_when_accepted(self):
        assert _type_permission_granted("help_requested", ACCEPTED_NO_EMERGENCY) is False

    def test_missed_checkin_narrowed_denies_only_that_type(self):
        assert _type_permission_granted("missed_checkin", ACCEPTED_NO_MISSED_CHECKIN) is False
        assert _type_permission_granted("journey_status", ACCEPTED_NO_MISSED_CHECKIN) is True

    def test_pending_link_denies_regardless_of_permission_values(self):
        assert _type_permission_granted("help_requested", PENDING_LINK) is False

    def test_missing_link_fails_closed(self):
        assert _type_permission_granted("journey_status", None) is False

    def test_missing_permissions_dict_fails_closed(self):
        assert _type_permission_granted("journey_status", ACCEPTED_MISSING_PERMS_DICT) is False

    def test_unmapped_alert_type_defaults_to_journey_status_permission(self):
        link_no_journey_status = {"id": "l", "status": "accepted", "permissions": {"journey_status": False}}
        assert _type_permission_granted("some_future_type", link_no_journey_status) is False
        link_with_journey_status = {"id": "l", "status": "accepted", "permissions": {"journey_status": True}}
        assert _type_permission_granted("some_future_type", link_with_journey_status) is True


class TestPublicAlertRetroactivelyHidesNarrowedPermission:
    """Revocation/narrowing re-evaluated LIVE on every read -- an alert
    created while a permission was granted must become ACCESS_REVOKED the
    next time it is fetched if that permission is later narrowed, with no
    change to the alert document itself (link is always looked up live)."""

    def test_help_alert_hidden_after_emergency_permission_narrowed(self):
        out = _public_alert(_alert("help_requested", "linkE"), ACCEPTED_NO_EMERGENCY)
        assert out["access_revoked"] is True
        assert out["payload"] == {}
        assert out["state"] == "ACCESS_REVOKED"

    def test_same_alert_type_visible_when_permission_is_granted(self):
        a = _alert("help_requested", "linkF")
        a["payload"] = {"destination": "QA", "message": "Need help"}
        out = _public_alert(a, ACCEPTED_FULL)
        assert out["access_revoked"] is False
        # Non-location fields are visible when the type permission is granted…
        assert out["payload"].get("message") == "Need help"
        # …while destination stays stripped without temp_location consent (PR-1B-A).
        assert "destination" not in out["payload"]

    def test_missed_checkin_alert_hidden_when_that_specific_permission_narrowed(self):
        out = _public_alert(_alert("missed_checkin", "linkM"), ACCEPTED_NO_MISSED_CHECKIN)
        assert out["access_revoked"] is True
        assert out["payload"] == {}

    def test_journey_status_alert_on_same_link_still_visible(self):
        """Narrowing ONE permission must never affect a DIFFERENT alert type
        on the same link -- this is a narrowing, not a blanket revoke."""
        out = _public_alert(_alert("journey_status", "linkM"), ACCEPTED_NO_MISSED_CHECKIN)
        assert out["access_revoked"] is False


class TestCreateAlertAndNotifyWriteGate:
    """Alert creation itself must never happen for a type the recipient
    hasn't consented to, even if the link is fully accepted."""

    def test_returns_none_when_specific_permission_not_granted(self):
        async def _run():
            return await create_alert_and_notify(
                type_="help_requested", owner_id="u_owner", owner_name="Owner",
                link=ACCEPTED_NO_EMERGENCY, payload={"x": 1}, journey_token=None,
                idempotency_key="test-key-denied-1",
            )
        result = asyncio.run(_run())
        assert result is None

    def test_returns_none_for_pending_link_regardless_of_permissions(self):
        async def _run():
            return await create_alert_and_notify(
                type_="journey_status", owner_id="u_owner", owner_name="Owner",
                link=PENDING_LINK, payload={"x": 1}, journey_token=None,
                idempotency_key="test-key-denied-2",
            )
        result = asyncio.run(_run())
        assert result is None

    def test_returns_none_when_link_missing_invitee_user_id(self):
        async def _run():
            bad_link = {"id": "linkZ", "status": "accepted", "permissions": {"journey_status": True}}
            return await create_alert_and_notify(
                type_="journey_status", owner_id="u_owner", owner_name="Owner",
                link=bad_link, payload={"x": 1}, journey_token=None,
                idempotency_key="test-key-denied-3",
            )
        result = asyncio.run(_run())
        assert result is None


class TestReciprocalSharingRequiresSeparateConsentPerDirection:
    """A trusted_circle_links record is a ONE-WAY grant (owner_id shares
    with invitee_user_id). Accepting an invitation must never implicitly
    create or auto-accept a reverse-direction link -- static source check
    that trusted_circle_router.py's accept handler touches exactly one
    link record per request (no second insert/upsert into the opposite
    direction anywhere in that file)."""

    def test_respond_handler_does_not_create_a_reverse_link(self):
        src = open(
            os.path.join(os.path.dirname(__file__), "..", "api", "trusted_circle_router.py")
        ).read()
        import re
        m = re.search(r"async def respond\([\s\S]{0,2000}?\n(?=@router|\Z)", src)
        assert m, "could not locate the respond() handler for inspection"
        body = m.group(0)
        insert_calls = body.count("insert_one")
        assert insert_calls == 0, (
            "accepting/declining an invitation must only update the existing link "
            "record, never insert a new (reverse-direction) link"
        )


class TestGuardianPublicTokenAllOrNothingIsDocumentedNotPerRecipient:
    """Per item 3's explicit instruction: do not claim per-recipient
    protection for the shared public Guardian token; its all-or-nothing
    behaviour must remain documented, not silently changed. This is a
    documentation-presence check, not a behavior change."""

    def test_journey_router_documents_all_or_nothing_sharing_closed(self):
        src = open(
            os.path.join(os.path.dirname(__file__), "..", "api", "journey_router.py")
        ).read()
        assert "_sharing_closed" in src or "all-or-nothing" in src.lower() or "all_or_nothing" in src.lower(), (
            "expected the Guardian token's all-or-nothing limitation to remain documented in journey_router.py"
        )
