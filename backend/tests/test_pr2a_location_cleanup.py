"""
test_pr2a_location_cleanup.py
Isolated retention tests — PR-2A: Location cleanup on safe / revoke.

All tests use mocked storage and mocked notification transport.
No live database, running server, real HTTP, accounts or messages.

Evidence limitations noted per test where applicable.
"""
import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, call, patch
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr_module
from api.journey_router import LocationIn

# ── Time helpers ──────────────────────────────────────────────────────────────

def _fut(m: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=m)).isoformat()

def _ago(m: int = 5) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=m)).isoformat()

# ── User stubs ────────────────────────────────────────────────────────────────

_OWNER = {"id": "owner-001", "name": "Priya"}
_OTHER = {"id": "other-999", "name": "Impostor"}
_TOKEN = "PR2ATOKEN"

# ── Fixtures ──────────────────────────────────────────────────────────────────

def _rec(status: str = "in_progress",
         revoked: bool = False,
         with_location: bool = True) -> dict:
    r: dict = {
        "token":               _TOKEN,
        "user_id":             _OWNER["id"],
        "user_display":        "Priya",
        "destination":         "Destination on file",
        "started_at":          _ago(30),
        "expected_checkin_at": _fut(30),
        "expires_at":          _fut(1440),
        "status":              status,
        "sharing_revoked_at":  _ago(2) if revoked else None,
        "safe_at":             _ago(2) if status == "safe" else None,
        "recipient_link_ids":  [],
    }
    if with_location:
        r["last_location"] = {
            "lat": 19.076, "lng": 72.877,
            "accuracy": 15.0, "area": "Fort, Mumbai",
            "updated_at": _ago(5),
        }
        r["location_log"] = [r["last_location"]]
    return r

def _mock_db(find_return=None) -> MagicMock:
    m = MagicMock()
    m.safety_journeys.find_one      = AsyncMock(return_value=find_return)
    m.safety_journeys.update_one    = AsyncMock(return_value=MagicMock())
    m.trusted_circle_links.find_one = AsyncMock(return_value=None)
    m.users.find_one                = AsyncMock(return_value=None)
    return m

def _location_body() -> LocationIn:
    return LocationIn(lat=19.076, lng=72.877, accuracy=15.0, area="Fort, Mumbai")

# ── Helpers: assert update_one was called with location cleanup ───────────────

def _find_cleanup_call(mock_update_one) -> bool:
    """Return True if any update_one call carried both $unset last_location
    and $set location_log: [].  Does not assert — caller decides."""
    for c in mock_update_one.call_args_list:
        update_doc = c[0][1] if c[0] else c[1].get("update", {})
        has_unset = update_doc.get("$unset", {}).get("last_location") == ""
        has_log   = update_doc.get("$set",  {}).get("location_log")   == []
        if has_unset and has_log:
            return True
    return False

def _assert_cleanup_called(mock_update_one) -> None:
    assert _find_cleanup_call(mock_update_one), (
        "Expected update_one to carry $unset last_location and $set location_log:[] "
        "but no such call was found.\n"
        f"Actual calls: {mock_update_one.call_args_list}"
    )

def _assert_no_cleanup(mock_update_one) -> None:
    assert not _find_cleanup_call(mock_update_one), (
        "update_one must NOT carry location cleanup when ownership fails."
    )


# ─────────────────────────────────────────────────────────────────────────────
# mark_safe — location cleanup
# ─────────────────────────────────────────────────────────────────────────────

class TestMarkSafeLocationCleanup:

    @pytest.mark.asyncio
    async def test_safe_removes_last_location_and_log(self):
        """Primary case: safe call atomically removes last_location and
        clears location_log in the same update_one as the status change."""
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            result = await jr_module.mark_safe(_TOKEN, user=_OWNER)
        assert result["ok"] is True
        _assert_cleanup_called(db.safety_journeys.update_one)

    @pytest.mark.asyncio
    async def test_safe_cleanup_and_status_in_single_update(self):
        """The $set for status:'safe' and $unset for last_location must be
        in the same update_one call — not two separate writes."""
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            await jr_module.mark_safe(_TOKEN, user=_OWNER)
        # Exactly one update_one call
        assert db.safety_journeys.update_one.call_count == 1
        update_doc = db.safety_journeys.update_one.call_args[0][1]
        assert update_doc.get("$set", {}).get("status") == "safe"
        assert update_doc.get("$unset", {}).get("last_location") == ""
        assert update_doc.get("$set", {}).get("location_log") == []

    @pytest.mark.asyncio
    async def test_repeated_safe_cleans_legacy_location_no_duplicate_notification(self):
        """Repeated safe on a record that still has location (legacy or restored)
        must clean the location and must NOT re-fire the completion notification."""
        already_safe_rec = _rec(status="safe", with_location=True)
        db = _mock_db(find_return=already_safe_rec)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.mark_safe(_TOKEN, user=_OWNER)
        assert result.get("already_safe") is True
        _assert_cleanup_called(db.safety_journeys.update_one)
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_safe_no_location_record_still_succeeds(self):
        """If last_location is already absent, safe must succeed without error."""
        db = _mock_db(find_return=_rec(with_location=False))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            result = await jr_module.mark_safe(_TOKEN, user=_OWNER)
        assert result["ok"] is True
        # Cleanup call still issued (idempotent $unset is harmless on missing field)
        assert db.safety_journeys.update_one.call_count == 1

    @pytest.mark.asyncio
    async def test_wrong_owner_safe_no_cleanup_no_mutation_no_notify(self):
        """Wrong owner must cause no cleanup, no mutation, no notification."""
        from fastapi import HTTPException
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.mark_safe(_TOKEN, user=_OTHER)
        assert exc_info.value.status_code == 403
        db.safety_journeys.update_one.assert_not_called()
        mock_notify.assert_not_called()
        _assert_no_cleanup(db.safety_journeys.update_one)


# ─────────────────────────────────────────────────────────────────────────────
# revoke_sharing — location cleanup
# ─────────────────────────────────────────────────────────────────────────────

class TestRevokeSharingLocationCleanup:

    @pytest.mark.asyncio
    async def test_revoke_removes_last_location_and_log(self):
        """Primary case: revoke atomically removes last_location and
        clears location_log together with the revocation timestamp."""
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            result = await jr_module.revoke_sharing(_TOKEN, user=_OWNER)
        assert result["ok"] is True
        _assert_cleanup_called(db.safety_journeys.update_one)

    @pytest.mark.asyncio
    async def test_revoke_cleanup_and_timestamp_in_single_update(self):
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            await jr_module.revoke_sharing(_TOKEN, user=_OWNER)
        assert db.safety_journeys.update_one.call_count == 1
        update_doc = db.safety_journeys.update_one.call_args[0][1]
        assert "sharing_revoked_at" in update_doc.get("$set", {})
        assert update_doc.get("$unset", {}).get("last_location") == ""
        assert update_doc.get("$set", {}).get("location_log") == []

    @pytest.mark.asyncio
    async def test_repeated_revoke_cleans_legacy_location_no_duplicate_notification(self):
        """Repeated revoke on an already-revoked record with residual location
        must clean the location and must NOT re-fire the sharing_ended notification."""
        already_revoked = _rec(revoked=True, with_location=True)
        db = _mock_db(find_return=already_revoked)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.revoke_sharing(_TOKEN, user=_OWNER)
        assert result.get("already_closed") is True
        _assert_cleanup_called(db.safety_journeys.update_one)
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_safe_then_revoke_order_both_clean(self):
        """safe → revoke: the already-closed path on revoke must still clean."""
        # Record already marked safe (sharing_closed = True via status)
        safe_with_loc = _rec(status="safe", with_location=True)
        db = _mock_db(find_return=safe_with_loc)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.revoke_sharing(_TOKEN, user=_OWNER)
        assert result.get("already_closed") is True
        _assert_cleanup_called(db.safety_journeys.update_one)
        mock_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_revoke_then_safe_order_both_clean(self):
        """revoke → safe: safe on an already-revoked record (already_closed
        from mark_safe's perspective is status=='safe', but the revoked record
        is not yet 'safe').  The full mark_safe path fires and cleans."""
        revoked_with_loc = _rec(revoked=True, with_location=True)
        db = _mock_db(find_return=revoked_with_loc)
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()):
            result = await jr_module.mark_safe(_TOKEN, user=_OWNER)
        # mark_safe proceeds even if revoked (documented design independence)
        assert result["ok"] is True
        _assert_cleanup_called(db.safety_journeys.update_one)

    @pytest.mark.asyncio
    async def test_wrong_owner_revoke_no_cleanup_no_mutation_no_notify(self):
        from fastapi import HTTPException
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.revoke_sharing(_TOKEN, user=_OTHER)
        assert exc_info.value.status_code == 403
        db.safety_journeys.update_one.assert_not_called()
        mock_notify.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# update_location — atomic closure guard
# ─────────────────────────────────────────────────────────────────────────────

class TestUpdateLocationAtomicGuard:
    """
    ⚠ Evidence limitation: these tests verify that update_one is called
    with the correct atomic filter. With a mocked DB, update_one always
    succeeds (modified_count not checked). Actual race prevention requires a
    real MongoDB write-concern test that is out of scope here.
    """

    @pytest.mark.asyncio
    async def test_location_write_uses_atomic_closure_filter(self):
        """update_one must carry status:{$ne:'safe'} and sharing_revoked_at:None
        in the filter so a racing closure makes the write a no-op."""
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db):
            await jr_module.update_location(_TOKEN, body=_location_body(), user=_OWNER)
        filter_doc = db.safety_journeys.update_one.call_args[0][0]
        assert filter_doc.get("token") == _TOKEN,              "token missing from filter"
        assert filter_doc.get("status") == {"$ne": "safe"},    "status guard missing"
        assert filter_doc.get("sharing_revoked_at") is None,   "revoked guard missing"

    @pytest.mark.asyncio
    async def test_location_race_filter_would_prevent_restoration_after_safe(self):
        """Verify the filter key structure used to prevent post-safe restoration.
        A real closed record at write time would yield modified_count=0 from MongoDB.
        Evidence: filter is structurally correct; outcome requires a live DB test."""
        db = _mock_db(find_return=_rec())  # open at read time (simulates race scenario)
        with patch.object(jr_module, "db", db):
            await jr_module.update_location(_TOKEN, body=_location_body(), user=_OWNER)
        filter_doc = db.safety_journeys.update_one.call_args[0][0]
        # If the record were safe at write time, {"status": {"$ne": "safe"}}
        # would not match and MongoDB returns modified_count = 0
        assert filter_doc["status"] == {"$ne": "safe"}
        assert filter_doc["sharing_revoked_at"] is None

    @pytest.mark.asyncio
    async def test_location_write_skipped_at_read_time_when_already_closed(self):
        """Read-time check: if the record is already closed at read time,
        update_one is not called at all (common-case fast path)."""
        db = _mock_db(find_return=_rec(revoked=True))
        with patch.object(jr_module, "db", db):
            result = await jr_module.update_location(_TOKEN, body=_location_body(), user=_OWNER)
        assert "skipped" in result
        db.safety_journeys.update_one.assert_not_called()

    @pytest.mark.asyncio
    async def test_wrong_owner_location_no_write(self):
        from fastapi import HTTPException
        db = _mock_db(find_return=_rec())
        with patch.object(jr_module, "db", db):
            with pytest.raises(HTTPException) as exc_info:
                await jr_module.update_location(_TOKEN, body=_location_body(), user=_OTHER)
        assert exc_info.value.status_code == 403
        db.safety_journeys.update_one.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# Help request preserved after revoke
# ─────────────────────────────────────────────────────────────────────────────

class TestHelpPreservedAfterRevoke:
    """Location cleanup must not block the owner's emergency help request."""

    @pytest.mark.asyncio
    async def test_help_request_succeeds_on_revoked_journey(self):
        """After revoke, the owner can still call report_help_requested.
        Revocation gates missed-checkin escalation but must never gate
        an active help request."""
        db = _mock_db(find_return=_rec(revoked=True))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.report_help_requested(_TOKEN, user=_OWNER)
        assert result["ok"] is True
        mock_notify.assert_called_once()

    @pytest.mark.asyncio
    async def test_help_request_succeeds_on_safe_journey(self):
        """After safe, help must still reach recipients (traveller may have
        reached destination but then encountered danger)."""
        db = _mock_db(find_return=_rec(status="safe"))
        with patch.object(jr_module, "db", db), \
             patch.object(jr_module, "_notify_linked_recipients", new=AsyncMock()) as mock_notify:
            result = await jr_module.report_help_requested(_TOKEN, user=_OWNER)
        assert result["ok"] is True
        mock_notify.assert_called_once()
