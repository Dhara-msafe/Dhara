"""
test_p01_profile_fields.py
==========================
Unit tests for the profile-fields-email-invites feature.

Covers:
  P01-A  PATCH /profile/me validates phone length (6–20 chars)
  P01-B  PATCH /profile/me rejects DOB making user under 18
  P01-C  PATCH /profile/me accepts valid DOB for user ≥ 18
  P01-D  PATCH /profile/me rejects an invalid gender value
  P01-E  PATCH /profile/me accepts all four gender options
  P01-F  public_user() returns gender, dob, age_verified, age_verified_at

No real DB needed — handlers are tested in isolation with an AsyncMock.
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.profile_router as pr
from dependencies import public_user


# ── helpers ───────────────────────────────────────────────────────────────────

def _user(**extra) -> dict:
    base = {
        "id": "u-test-001",
        "email": "alice@example.com",
        "name": "Alice",
        "phone": "9876543210",
        "language": "en",
        "is_pro": False,
        "pro_since": None,
        "pro_samples_used": 0,
        "drafts_used": 0,
        "is_grandfathered": True,
        "token_version": 0,
        "terms_accepted": True,
        "terms_version": "2.0",
        "terms_accepted_at": "2024-01-01T00:00:00+00:00",
    }
    base.update(extra)
    return base


def _mock_db():
    m = MagicMock()
    m.users.update_one = AsyncMock()
    m.trusted_circle_links.find = MagicMock(return_value=_AsyncIter([]))
    return m


class _AsyncIter:
    """Minimal async iterator for mocking db.collection.find()."""
    def __init__(self, items):
        self._items = iter(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._items)
        except StopIteration:
            raise StopAsyncIteration


# ── P01-A: phone length validation ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_phone_too_short_rejected():
    with patch.object(pr, "db", _mock_db()), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(phone="12345")  # 5 chars — too short
        with pytest.raises(Exception) as exc:
            await pr.edit_profile(body, _user())
        assert "6" in str(exc.value) or "400" in str(exc.value)


@pytest.mark.asyncio
async def test_phone_too_long_rejected():
    with patch.object(pr, "db", _mock_db()), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(phone="1" * 21)  # 21 chars — too long
        with pytest.raises(Exception) as exc:
            await pr.edit_profile(body, _user())
        assert "20" in str(exc.value) or "400" in str(exc.value)


@pytest.mark.asyncio
async def test_phone_valid_accepted():
    db_mock = _mock_db()
    with patch.object(pr, "db", db_mock), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(phone="+919876543210")  # 13 chars — valid
        result = await pr.edit_profile(body, _user())
        assert result["ok"] is True
        db_mock.users.update_one.assert_awaited_once()


# ── P01-B/C: DOB 18+ validation ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dob_under_18_rejected():
    today = datetime.now(timezone.utc).date()
    # 17 years and 1 day old — definitely under 18
    young = (today.replace(year=today.year - 17) + timedelta(days=1)).isoformat()
    with patch.object(pr, "db", _mock_db()), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(dob=young)
        with pytest.raises(Exception) as exc:
            await pr.edit_profile(body, _user())
        assert "18" in str(exc.value)


@pytest.mark.asyncio
async def test_dob_exactly_18_accepted():
    today = datetime.now(timezone.utc).date()
    # Exactly 18 years old today
    eighteen = today.replace(year=today.year - 18).isoformat()
    db_mock = _mock_db()
    with patch.object(pr, "db", db_mock), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(dob=eighteen)
        result = await pr.edit_profile(body, _user())
        assert result["ok"] is True


@pytest.mark.asyncio
async def test_dob_30_years_old_accepted():
    today = datetime.now(timezone.utc).date()
    thirty = today.replace(year=today.year - 30).isoformat()
    db_mock = _mock_db()
    with patch.object(pr, "db", db_mock), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(dob=thirty)
        result = await pr.edit_profile(body, _user())
        assert result["ok"] is True


@pytest.mark.asyncio
async def test_dob_bad_format_rejected():
    with patch.object(pr, "db", _mock_db()), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(dob="31/01/1990")   # wrong format
        with pytest.raises(Exception) as exc:
            await pr.edit_profile(body, _user())
        assert "400" in str(exc.value) or "YYYY-MM-DD" in str(exc.value)


# ── P01-D/E: gender validation ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invalid_gender_rejected():
    with patch.object(pr, "db", _mock_db()), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(gender="nonbinary")   # not in allowed set
        with pytest.raises(Exception) as exc:
            await pr.edit_profile(body, _user())
        assert "400" in str(exc.value) or "gender" in str(exc.value).lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("g", ["female", "male", "other", "prefer_not_to_say"])
async def test_valid_gender_accepted(g: str):
    db_mock = _mock_db()
    with patch.object(pr, "db", db_mock), \
         patch("services.invite_linker.link_pending_invites", AsyncMock(return_value=0)):
        body = pr.EditProfileIn(gender=g)
        result = await pr.edit_profile(body, _user())
        assert result["ok"] is True
        called_set = db_mock.users.update_one.call_args[0][1]["$set"]
        assert called_set.get("gender") == g


# ── P01-F: public_user() includes new fields ──────────────────────────────────

def test_public_user_includes_gender_dob_age_verified():
    doc = _user(gender="female", dob="1990-05-15", age_verified=True, age_verified_at="2026-01-01T00:00:00+00:00")
    out = public_user(doc)
    assert out["gender"] == "female"
    assert out["dob"] == "1990-05-15"
    assert out["age_verified"] is True
    assert out["age_verified_at"] == "2026-01-01T00:00:00+00:00"


def test_public_user_gender_dob_absent_for_old_accounts():
    doc = _user()   # no gender / dob in doc (pre-existing account)
    out = public_user(doc)
    assert out["gender"] is None
    assert out["dob"] is None
    assert out["age_verified"] is False
    assert out["age_verified_at"] is None
