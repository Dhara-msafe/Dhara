"""
P0 SECURITY REGRESSION — Trusted Circle alerts location disclosure.

Root cause (fixed in api/alerts_router.py): `_public_alert()` returned the
raw, unfiltered `payload` dict with NO permission check at all. `list_alerts`
(GET /api/alerts) additionally never checked link status/revocation. Only
`get_alert` (GET /api/alerts/{id}) checked revocation, and even then never
checked the `temp_location` permission before returning `last_location`.

These are DIRECT UNIT TESTS against the sanitization functions themselves
(no live server / no DB / no network) — a disposable, local-only check of
the pure serialization logic, per the "isolated runtime behavior" mandate.
Synthetic data only; no real user or location data used.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api.alerts_router import _sanitize_location, _public_alert  # noqa: E402

RAW_PAYLOAD = {
    "destination": "QA Dest",
    "eta": "2026-06-01T10:00:00Z",
    "journey_status": "in_progress",
    "last_location": {"lat": 12.9716, "lng": 77.5946, "accuracy": 10, "area": "QA Test Area", "age_minutes": 2},
}

ACCEPTED_LINK_NO_LOC = {"id": "link1", "status": "accepted", "permissions": {"journey_status": True, "temp_location": False}}
ACCEPTED_LINK_WITH_LOC = {"id": "link1", "status": "accepted", "permissions": {"journey_status": True, "temp_location": True}}
REVOKED_LINK = {"id": "link1", "status": "revoked", "permissions": {"temp_location": True}}
PENDING_LINK = {"id": "link1", "status": "pending", "permissions": {"temp_location": True}}
DECLINED_LINK = {"id": "link1", "status": "declined", "permissions": {"temp_location": True}}
LINK_MISSING_PERM_KEY = {"id": "link1", "status": "accepted", "permissions": {"journey_status": True}}  # no temp_location key at all
LINK_NO_PERMS_DICT = {"id": "link1", "status": "accepted"}  # permissions missing entirely


def _alert(link_id="link1"):
    return {"id": "a1", "type": "journey_status", "owner_name": "Owner", "link_id": link_id,
             "journey_token": "jt1", "payload": dict(RAW_PAYLOAD), "state": "QUEUED",
             "created_at": "2026-06-01T09:00:00Z", "read_at": None, "acknowledged_at": None}


class TestScenarioA_AcceptedNoTempLocation:
    def test_sanitize_strips_last_location_entirely(self):
        out = _sanitize_location(RAW_PAYLOAD, ACCEPTED_LINK_NO_LOC)
        assert "last_location" not in out
        assert "lat" not in str(out) and "lng" not in str(out) and "area" not in str(out)

    def test_public_alert_strips_last_location(self):
        out = _public_alert(_alert(), ACCEPTED_LINK_NO_LOC)
        assert out["access_revoked"] is False
        assert "last_location" not in out["payload"]
        assert "lat" not in str(out["payload"])


class TestScenarioB_AcceptedWithTempLocation:
    def test_sanitize_preserves_last_location_when_granted(self):
        out = _sanitize_location(RAW_PAYLOAD, ACCEPTED_LINK_WITH_LOC)
        assert out["last_location"]["lat"] == 12.9716
        assert out["last_location"]["area"] == "QA Test Area"

    def test_other_fields_unaffected(self):
        out = _sanitize_location(RAW_PAYLOAD, ACCEPTED_LINK_WITH_LOC)
        assert out["destination"] == "QA Dest"
        assert out["journey_status"] == "in_progress"


class TestScenarioE_RevokedRelationship:
    def test_public_alert_zeros_entire_payload_on_revoked(self):
        out = _public_alert(_alert(), REVOKED_LINK)
        assert out["access_revoked"] is True
        assert out["payload"] == {}
        assert out["state"] == "ACCESS_REVOKED"


class TestScenarioC_PendingInvitation:
    def test_pending_link_treated_as_not_accepted_no_location(self):
        out = _public_alert(_alert(), PENDING_LINK)
        assert out["access_revoked"] is True
        assert out["payload"] == {}


class TestScenarioD_DeclinedInvitation:
    def test_declined_link_treated_as_not_accepted_no_location(self):
        out = _public_alert(_alert(), DECLINED_LINK)
        assert out["access_revoked"] is True
        assert out["payload"] == {}


class TestScenarioK_MissingOrStaleLink:
    def test_missing_link_record_fails_closed(self):
        """link_id points to nothing found in DB (e.g. stale/orphaned alert) -> fail closed."""
        out = _public_alert(_alert(), None)
        assert out["access_revoked"] is True
        assert out["payload"] == {}


class TestScenarioL_UnsupportedOrMissingPermissionMetadata:
    def test_missing_temp_location_key_does_not_imply_granted(self):
        out = _sanitize_location(RAW_PAYLOAD, LINK_MISSING_PERM_KEY)
        assert "last_location" not in out, "missing permission key must NOT be treated as granted"

    def test_missing_permissions_dict_entirely_fails_closed(self):
        out = _sanitize_location(RAW_PAYLOAD, LINK_NO_PERMS_DICT)
        assert "last_location" not in out

    def test_permission_value_not_boolean_true_is_denied(self):
        weird_link = {"id": "link1", "status": "accepted", "permissions": {"temp_location": "yes"}}
        out = _sanitize_location(RAW_PAYLOAD, weird_link)
        assert "last_location" not in out, "non-True truthy value must not grant location access"


class TestScenarioI_MultipleRecipientsDifferentPermissions:
    def test_two_links_same_alert_shape_different_outcomes(self):
        out_no_loc = _public_alert(_alert("linkA"), ACCEPTED_LINK_NO_LOC)
        out_with_loc = _public_alert(_alert("linkB"), ACCEPTED_LINK_WITH_LOC)
        assert "last_location" not in out_no_loc["payload"]
        assert "last_location" in out_with_loc["payload"]


class TestScenarioJ_MixedPermissionsInAList:
    def test_each_alert_sanitized_independently(self):
        alerts_and_links = [
            (_alert("linkA"), ACCEPTED_LINK_NO_LOC),
            (_alert("linkB"), ACCEPTED_LINK_WITH_LOC),
            (_alert("linkC"), REVOKED_LINK),
        ]
        results = [_public_alert(a, link) for a, link in alerts_and_links]
        assert "last_location" not in results[0]["payload"]
        assert "last_location" in results[1]["payload"]
        assert results[2]["payload"] == {}


class TestPayloadImmutability:
    def test_sanitize_does_not_mutate_original_alert_payload(self):
        """Critical: must not corrupt the owner's stored data while hiding it from a recipient."""
        original = dict(RAW_PAYLOAD)
        original["last_location"] = dict(RAW_PAYLOAD["last_location"])
        _sanitize_location(original, ACCEPTED_LINK_NO_LOC)
        assert "last_location" in original, "sanitization must not mutate the source payload"
