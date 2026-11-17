"""B-34 / D-12 (17 Nov 2026, owner decision):
  1. A locked account refuses everyone, including the correct password.
  2. A successful password reset CLEARS the lock and the failure count, so
     the person can sign in with the password they just set.
  3. A wrong reset code clears nothing.

Runs the real api/auth_router.login and reset_password and the real
services/login_guard against an in-memory MongoDB (mongomock, already in
requirements.txt). No network, no real database.

Run: cd backend && DB_NAME=dhara_qa_unit python -m pytest tests/test_b34_reset_clears_lock.py -q
(DB_NAME only satisfies the B-16f QA guard in conftest.py; nothing connects to it.)
"""
import asyncio
import os
import sys
import types
from datetime import datetime, timedelta, timezone

import mongomock
import pytest

for _k, _v in dict(DB_NAME="dhara_qa_b34_unit", MONGO_URL="mongodb://localhost:1", EMERGENT_LLM_KEY="dummy",
                   JWT_SECRET="test-secret-b34", OUTBOUND_MODE="simulate", ADMIN_KEY="").items():
    os.environ.setdefault(_k, _v)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Outside Emergent the Emergent-only package is not installable (ENV-DEV);
# auth_router never calls it, so a stand-in is enough for this test.
try:
    import emergentintegrations  # noqa: F401
except ImportError:
    class _Any:
        def __init__(self, *a, **k): pass
        def __getattr__(self, n): return _Any()
        def __call__(self, *a, **k): return _Any()
    for _n in ["emergentintegrations", "emergentintegrations.llm", "emergentintegrations.llm.chat"]:
        _m = types.ModuleType(_n); _m.__path__ = []; _m.__getattr__ = lambda n: _Any; sys.modules[_n] = _m

from fastapi import HTTPException  # noqa: E402
from starlette.requests import Request  # noqa: E402

import api.auth_router as auth  # noqa: E402
import services.login_guard as guard  # noqa: E402


class _AsyncCollection:
    """Async face over a mongomock collection (Motor-style awaits)."""
    def __init__(self, coll): self._c = coll
    def __getattr__(self, name):
        fn = getattr(self._c, name)
        async def call(*a, **k): return fn(*a, **k)
        return call


class _AsyncDb:
    def __init__(self): self._db = mongomock.MongoClient()["dhara_qa_b34_unit"]
    def __getattr__(self, name): return _AsyncCollection(self._db[name])
    def __getitem__(self, name): return _AsyncCollection(self._db[name])


EMAIL = "b34@example.com"


def _request():
    return Request({"type": "http", "headers": [(b"x-forwarded-for", b"203.0.113.7")], "client": ("10.9.0.1", 1)})


@pytest.fixture
def db(monkeypatch):
    fake = _AsyncDb()
    monkeypatch.setattr(auth, "db", fake)
    async def _no_delay(*_a, **_k): return None
    monkeypatch.setattr(guard.asyncio, "sleep", _no_delay)   # skip the progressive delay
    return fake


async def _login(password):
    try:
        await auth.login(auth.LoginIn(email=EMAIL, password=password), _request())
        return 200
    except HTTPException as e:
        return e.status_code


async def _setup_locked_account(db):
    await db.users.insert_one({"id": "u-b34", "email": EMAIL, "name": "B34",
                               "password_hash": auth.hash_pw("Old#Pass1"), "token_version": 0})
    for _ in range(guard.MAX_FAILURES):
        await _login("Wrong#Pass1")
    await db.password_resets.insert_one({
        "email": EMAIL, "user_id": "u-b34", "code_hash": auth.hash_pw("123456"), "attempts": 0, "used": False,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()})


def test_locked_account_refuses_the_correct_password(db):
    async def run():
        await _setup_locked_account(db)
        assert await _login("Old#Pass1") == 429
    asyncio.run(run())


def test_successful_reset_clears_lock_and_failure_count(db):
    async def run():
        await _setup_locked_account(db)
        await auth.reset_password(auth.ResetPasswordIn(email=EMAIL, code="123456", new_password="New#Pass2"), _request())
        assert await db.login_attempts.count_documents({}) == 0
        assert await _login("New#Pass2") == 200
        # counting starts again from zero: one wrong password is a plain 401, not a lock
        assert await _login("Bad#Pass9") == 401
        doc = await db.login_attempts.find_one({"_id": f"account:{EMAIL}"})
        assert doc["failures"] == 1
    asyncio.run(run())


def test_wrong_reset_code_does_not_clear_the_lock(db):
    async def run():
        await _setup_locked_account(db)
        with pytest.raises(HTTPException):
            await auth.reset_password(auth.ResetPasswordIn(email=EMAIL, code="999999", new_password="New#Pass2"), _request())
        assert await _login("Old#Pass1") == 429
    asyncio.run(run())
