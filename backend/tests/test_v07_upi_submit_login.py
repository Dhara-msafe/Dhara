"""V-07 / D-17 (17 Nov 2026, owner decision): UPI is in the release, and
POST /api/billing/upi/submit must
  1. require a signed-in account (401 without a valid token; guests 403),
  2. never reveal whether an email has an account (no lookup by a typed
     email -- the payment is filed under the signed-in account only),
  3. never write the email to the logs.

Runs the real api/upi_billing_router and dependencies.current_user through
FastAPI's TestClient against an in-memory MongoDB (mongomock). No network,
no real database.

Run: cd backend && DB_NAME=dhara_qa_unit python -m pytest tests/test_v07_upi_submit_login.py -q
(DB_NAME only satisfies the B-16f QA guard in conftest.py; nothing connects to it.)
"""
import logging
import os
import sys
import types

import mongomock
import pytest

for _k, _v in dict(DB_NAME="dhara_qa_v07_unit", MONGO_URL="mongodb://localhost:1", EMERGENT_LLM_KEY="dummy",
                   JWT_SECRET="test-secret-v07", OUTBOUND_MODE="simulate", ADMIN_KEY="").items():
    os.environ.setdefault(_k, _v)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:  # Emergent-only package (ENV-DEV); not used by these routes
    import emergentintegrations  # noqa: F401
except ImportError:
    class _Any:
        def __init__(self, *a, **k): pass
        def __getattr__(self, n): return _Any()
        def __call__(self, *a, **k): return _Any()
    for _n in ["emergentintegrations", "emergentintegrations.llm", "emergentintegrations.llm.chat"]:
        _m = types.ModuleType(_n); _m.__path__ = []; _m.__getattr__ = lambda n: _Any; sys.modules[_n] = _m

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import dependencies  # noqa: E402
import api.upi_billing_router as upi  # noqa: E402


class _AsyncCursor:
    def __init__(self, cur): self._cur = cur
    def sort(self, *a, **k): self._cur = self._cur.sort(*a, **k); return self
    def limit(self, n): self._cur = self._cur.limit(n); return self
    def __aiter__(self):
        self._it = iter(self._cur); return self
    async def __anext__(self):
        try: return next(self._it)
        except StopIteration: raise StopAsyncIteration


class _AsyncCollection:
    def __init__(self, coll): self._c = coll
    def find(self, *a, **k): return _AsyncCursor(self._c.find(*a, **k))
    def __getattr__(self, name):
        fn = getattr(self._c, name)
        async def call(*a, **k): return fn(*a, **k)
        return call


class _AsyncDb:
    def __init__(self): self._db = mongomock.MongoClient()["dhara_qa_v07_unit"]
    def __getattr__(self, name): return _AsyncCollection(self._db[name])
    def __getitem__(self, name): return _AsyncCollection(self._db[name])


@pytest.fixture
def env(monkeypatch):
    fake = _AsyncDb()
    monkeypatch.setattr(dependencies, "db", fake)
    monkeypatch.setattr(upi, "db", fake)
    raw = fake._db
    raw.users.insert_many([
        {"id": "u-asha", "email": "asha@example.com", "name": "Asha", "token_version": 0},
        {"id": "u-bala", "email": "bala@example.com", "name": "Bala", "token_version": 0},
        {"id": "u-guest", "email": "guest_x@guest.dhara", "name": "Guest", "is_guest": True, "token_version": 0},
    ])
    app = FastAPI(); app.include_router(upi.router, prefix="/api")
    return TestClient(app), raw


def _auth(uid):
    return {"Authorization": f"Bearer {dependencies.make_token(uid, 0)}"}


def test_submit_without_sign_in_is_refused(env):
    client, raw = env
    r = client.post("/api/billing/upi/submit", json={"email": "asha@example.com", "utr": "PYTESTUTR000001"})
    assert r.status_code == 401
    assert raw.upi_payment_submissions.count_documents({}) == 0


def test_submit_is_filed_under_the_signed_in_account_not_the_typed_email(env):
    client, raw = env
    r = client.post("/api/billing/upi/submit", headers=_auth("u-asha"),
                    json={"email": "bala@example.com", "utr": "PYTESTUTR000002"})
    assert r.status_code == 200 and r.json()["ok"] is True
    sub = raw.upi_payment_submissions.find_one({"id": r.json()["submission_id"]})
    assert sub["user_id"] == "u-asha" and sub["email"] == "asha@example.com" and sub["status"] == "pending"


def test_reply_never_reveals_whether_an_email_has_an_account(env):
    client, _ = env
    known = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"email": "bala@example.com", "utr": "PYTESTUTR000003"})
    unknown = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"email": "nobody_zzz@example.com", "utr": "PYTESTUTR000004"})
    assert known.status_code == unknown.status_code == 200
    assert "account" not in unknown.text.lower()


def test_guest_session_cannot_submit(env):
    client, raw = env
    r = client.post("/api/billing/upi/submit", headers=_auth("u-guest"), json={"utr": "PYTESTUTR000005"})
    assert r.status_code == 403
    assert raw.upi_payment_submissions.count_documents({}) == 0


def test_short_utr_still_rejected(env):
    client, _ = env
    r = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"utr": "abc"})
    assert r.status_code == 400


def test_email_is_not_written_to_the_logs(env, caplog):
    client, _ = env
    with caplog.at_level(logging.DEBUG):
        client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"email": "bala@example.com", "utr": "PYTESTUTR000006"})
        client.post("/api/billing/upi/submit", json={"email": "bala@example.com", "utr": "PYTESTUTR000007"})
    assert "asha@example.com" not in caplog.text and "bala@example.com" not in caplog.text
