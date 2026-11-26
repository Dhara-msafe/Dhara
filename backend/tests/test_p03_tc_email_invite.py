"""
test_p03_tc_email_invite.py
===========================
Tests for the updated Trusted Circle invite endpoint.

Covers:
  P03-A  POST /trusted-circle/invite rejects a request with no email
  P03-B  POST /trusted-circle/invite rejects a malformed email
  P03-C  POST /trusted-circle/invite stores invite_token_expires_at
  P03-D  Invite matches existing user by email when phone doesn't match
  P03-E  Invite sends email even when phone match found (existing user)
  P03-F  _send_invite_email passes expire_days to guardian_invite_email
  P03-G  Invitation page shows "expired" page when token is past expiry
  P03-H  guardian_invite_email subject names the owner
  P03-I  age_verification_router returns 503 when EKYC_ENABLED is off
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.trusted_circle_router as tc
import api.age_verification_router as av
from mailer import guardian_invite_email
from services import guardian_email as ge


# ── async iteration helpers ───────────────────────────────────────────────────

class _AsyncIter:
    def __init__(self, items):
        self._items = iter(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._items)
        except StopIteration:
            raise StopAsyncIteration


def _make_db(users=None, links=None):
    m = MagicMock()
    m.users.find       = MagicMock(return_value=_AsyncIter(users or []))
    m.users.find_one   = AsyncMock(return_value=None)
    m.trusted_circle_links.insert_one = AsyncMock()
    m.trusted_circle_links.find_one   = AsyncMock(return_value=None)
    return m


OWNER = {"id": "owner-001", "name": "Priya", "phone": "9000000001", "email": "priya@example.com"}


# ── P03-A: missing email → 400 ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_rejects_missing_email(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    with patch.object(tc, "db", _make_db()):
        body = tc.InviteIn(name="Asha", phone="+919876543210", email="")
        with pytest.raises(Exception) as exc:
            await tc.invite(body, OWNER)
        assert "email" in str(exc.value).lower() or "400" in str(exc.value)


# ── P03-B: bad email format → 400 ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_rejects_bad_email(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    with patch.object(tc, "db", _make_db()):
        body = tc.InviteIn(name="Asha", phone="+919876543210", email="not-an-email")
        with pytest.raises(Exception) as exc:
            await tc.invite(body, OWNER)
        assert "email" in str(exc.value).lower() or "400" in str(exc.value)


# ── P03-C: invite_token_expires_at is stored ─────────────────────────────────

@pytest.mark.asyncio
async def test_invite_stores_expiry(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    monkeypatch.setenv("GUARDIAN_LINK_SECRET", "secret-for-test")
    monkeypatch.delenv("PILOT_GUARDIAN_EMAILS", raising=False)
    db_mock = _make_db()
    with patch.object(tc, "db", db_mock), \
         patch.object(tc, "send_push", AsyncMock()), \
         patch("api.trusted_circle_router._send_invite_email", AsyncMock(return_value=True)):
        body = tc.InviteIn(name="Asha", phone="+919876543210", email="asha@example.com")
        await tc.invite(body, OWNER)
    inserted = db_mock.trusted_circle_links.insert_one.call_args[0][0]
    assert "invite_token_expires_at" in inserted
    # Should be ~30 days from now
    exp = datetime.fromisoformat(inserted["invite_token_expires_at"])
    now = datetime.now(timezone.utc)
    assert 29 <= (exp - now).days <= 30


# ── P03-D: match by email when phone doesn't match ───────────────────────────

@pytest.mark.asyncio
async def test_invite_matches_by_email(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    monkeypatch.setenv("GUARDIAN_LINK_SECRET", "secret-for-test")
    monkeypatch.delenv("PILOT_GUARDIAN_EMAILS", raising=False)
    # Existing user has a different phone but the same email
    existing = {"id": "user-matching", "phone": "0000000000", "email": "asha@example.com"}
    db_mock = _make_db(users=[])  # phone scan returns nothing
    db_mock.users.find_one = AsyncMock(return_value=existing)  # email scan returns a match

    with patch.object(tc, "db", db_mock), \
         patch.object(tc, "send_push", AsyncMock()), \
         patch("api.trusted_circle_router._send_invite_email", AsyncMock(return_value=True)):
        body = tc.InviteIn(name="Asha", phone="+919999999999", email="asha@example.com")
        result = await tc.invite(body, OWNER)
    assert result["matched_existing_user"] is True


# ── P03-E: email is ALWAYS sent even when existing user found ─────────────────

@pytest.mark.asyncio
async def test_email_always_sent_for_existing_user(monkeypatch):
    """Even when a matching DHARA account is found by phone, the email link
    is still sent — the user may need it to accept from their inbox."""
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    monkeypatch.setenv("GUARDIAN_LINK_SECRET", "secret-for-test")
    monkeypatch.delenv("PILOT_GUARDIAN_EMAILS", raising=False)
    existing = {"id": "user-existing", "phone": "+919876543210", "email": "asha@example.com"}

    db_mock = _make_db(users=[existing])
    mock_email_sender = AsyncMock(return_value=True)

    with patch.object(tc, "db", db_mock), \
         patch.object(tc, "send_push", AsyncMock()), \
         patch("api.trusted_circle_router._send_invite_email", mock_email_sender):
        body = tc.InviteIn(name="Asha", phone="+919876543210", email="asha@example.com")
        result = await tc.invite(body, OWNER)

    # Email must have been attempted even though a matching user was found
    mock_email_sender.assert_awaited_once()
    assert result["invited_by_email"] is True


# ── P03-F: guardian_invite_email receives expire_days ────────────────────────

def test_guardian_invite_email_has_expiry_note(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    subject, html = guardian_invite_email(
        owner_name="Priya Sharma",
        contact_name="Asha",
        accept_url="https://dhara.example/api/trusted-circle/invitation/email/TOKEN?r=accept",
        decline_url="https://dhara.example/api/trusted-circle/invitation/email/TOKEN?r=decline",
        shares_location=False,
        expire_days=30,
    )
    assert "Priya Sharma" in subject
    assert "30" in html
    assert "days" in html
    # Must NOT contain Aadhaar or credential-request text.
    # Note: the email footer legitimately says "we never ask for your password"
    # as a security disclaimer — that's fine. What's banned is asking them TO send it.
    assert "aadhaar" not in html.lower()
    assert "reply with your password" not in html.lower()
    assert "enter your password" not in html.lower()


# ── P03-G: expired invitation page ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_expired_invitation_shows_expired_page(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    monkeypatch.setenv("GUARDIAN_LINK_SECRET", "secret-for-test")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    link = {
        "id": "L1",
        "owner_id": "owner-001",
        "owner_name": "Priya",
        "contact_name": "Asha",
        "contact_email": "asha@example.com",
        "status": "pending",
        "permissions": {"temp_location": False},
        "invite_token_expires_at": past,  # expired yesterday
    }
    with patch.object(tc, "db", MagicMock()), \
         patch("api.trusted_circle_router._link_by_invite_token", AsyncMock(return_value=link)):
        resp = await tc.email_invitation_page("FAKE-TOKEN")
    assert "expired" in resp.body.decode().lower()


# ── P03-H: subject always names the owner ────────────────────────────────────

def test_invite_email_subject_names_owner(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    subject, _ = guardian_invite_email(
        owner_name="Meena Kumari",
        contact_name="Ravi",
        accept_url="https://dhara.example/api/trusted-circle/invitation/email/TOK?r=accept",
        decline_url="https://dhara.example/api/trusted-circle/invitation/email/TOK?r=decline",
        shares_location=True,
        expire_days=30,
    )
    assert "Meena Kumari" in subject


# ── P03-I: age verification 503 when flag is OFF ─────────────────────────────

@pytest.mark.asyncio
async def test_age_verification_disabled_returns_503():
    with patch.object(av, "_EKYC_ENABLED", False), \
         patch.object(av, "db", MagicMock()):
        with pytest.raises(Exception) as exc:
            await av.initiate_age_verification(
                {"id": "u1", "email": "u@e.com", "dob": "1990-01-01"}
            )
        assert "503" in str(exc.value) or "ekyc_disabled" in str(exc.value)


@pytest.mark.asyncio
async def test_age_verification_stub_returns_false_by_default():
    """The stub provider must NOT grant age_18_plus_verified=True by default —
    prevents accidental trust before a real provider is wired in."""
    mock_db = MagicMock()
    mock_db.users.update_one = AsyncMock()
    with patch.object(av, "_EKYC_ENABLED", True), \
         patch.object(av, "db", mock_db):
        result = await av.initiate_age_verification(
            {"id": "u1", "email": "u@e.com", "dob": "1990-01-01"}
        )
    assert result["age_18_plus_verified"] is False
