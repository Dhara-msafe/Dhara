"""B-124 / D-17 (17 Nov 2026, owner decision): manual UPI payments need
  1. an expiry for pending submissions (default 7 days, UPI_PENDING_EXPIRY_DAYS),
  2. a clear message to the person after confirm or reject: a signed-in
     status endpoint with a plain message, plus a fixed-template email.
An expired submission can still be confirmed by an operator (no lost payment);
a confirmed one can no longer be rejected.

In-memory MongoDB (mongomock) through FastAPI's TestClient; email is captured,
nothing is sent. Run: cd backend && DB_NAME=dhara_qa_unit python -m pytest tests/test_b124_upi_expiry_status.py -q
"""
from datetime import datetime, timedelta, timezone
import logging
import os
import sys
import types

import mongomock
import pytest

for _k, _v in dict(DB_NAME="dhara_qa_b124_unit", MONGO_URL="mongodb://localhost:1", EMERGENT_LLM_KEY="dummy",
                   JWT_SECRET="test-secret-b124", OUTBOUND_MODE="simulate", ADMIN_KEY="").items():
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
    def __init__(self): self._db = mongomock.MongoClient()["dhara_qa_b124_unit"]
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
    monkeypatch.setattr(dependencies, "ADMIN_KEY", "test-admin-b124")
    app = FastAPI(); app.include_router(upi.router, prefix="/api")
    return TestClient(app), raw



ADMIN = {"X-Admin-Key": "test-admin-b124"}


def _auth(uid):
    return {"Authorization": f"Bearer {dependencies.make_token(uid, 0)}"}


@pytest.fixture
def outbox(monkeypatch):
    import mailer
    sent = []
    async def fake_send(*, to, subject, html):
        mailer._assert_safe_email(subject, html)  # the real G2/G3 checks still run
        sent.append({"to": to, "subject": subject, "html": html})
    monkeypatch.setattr(mailer, "email_configured", lambda: True)
    monkeypatch.setattr(mailer, "send_email", fake_send)
    return sent


def _old(raw, uid, days, status="pending"):
    created = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    raw.upi_payment_submissions.insert_one({"id": f"s-{uid}-{days}", "email": f"{uid}@example.com", "user_id": uid,
        "utr": "PYTESTUTR0OLD", "note": None, "status": status, "created_at": created,
        "reviewed_at": None, "reviewed_note": None})
    return f"s-{uid}-{days}"


def test_status_endpoint_needs_sign_in(env):
    client, _ = env
    assert client.get("/api/billing/upi/my-submission").status_code == 401


def test_no_submission_yet(env):
    client, _ = env
    r = client.get("/api/billing/upi/my-submission", headers=_auth("u-asha"))
    assert r.status_code == 200 and r.json() == {"submission": None}


def test_pending_shows_not_instant_message_and_due_date(env):
    client, _ = env
    sub = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"utr": "PYTESTUTR000101"}).json()
    assert "not instant" in sub["message"] and sub["expires_at"]
    s = client.get("/api/billing/upi/my-submission", headers=_auth("u-asha")).json()["submission"]
    assert s["status"] == "pending" and "not instant" in s["message"] and s["expires_at"]


def test_only_own_submission_is_shown(env):
    client, _ = env
    client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"utr": "PYTESTUTR000102"})
    assert client.get("/api/billing/upi/my-submission", headers=_auth("u-bala")).json() == {"submission": None}


def test_old_pending_submission_expires(env):
    client, raw = env
    sid = _old(raw, "u-asha", 8)
    s = client.get("/api/billing/upi/my-submission", headers=_auth("u-asha")).json()["submission"]
    assert s["status"] == "expired" and "in time" in s["message"] and s["expires_at"] is None
    assert raw.upi_payment_submissions.find_one({"id": sid})["status"] == "expired"


def test_recent_pending_does_not_expire(env):
    client, raw = env
    _old(raw, "u-asha", 6)
    assert client.get("/api/billing/upi/my-submission", headers=_auth("u-asha")).json()["submission"]["status"] == "pending"


def test_admin_list_also_marks_expired(env):
    client, raw = env
    _old(raw, "u-asha", 10)
    subs = client.get("/api/billing/upi/submissions", headers=ADMIN).json()["submissions"]
    assert [s["status"] for s in subs] == ["expired"]


def test_expired_submission_can_still_be_confirmed(env, outbox):
    client, raw = env
    sid = _old(raw, "u-asha", 10)
    client.get("/api/billing/upi/submissions", headers=ADMIN)
    assert client.post(f"/api/billing/upi/submissions/{sid}/confirm", headers=ADMIN).status_code == 200
    assert raw.users.find_one({"id": "u-asha"})["is_pro"] is True


def test_confirm_tells_the_person(env, outbox):
    client, raw = env
    sid = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"utr": "PYTESTUTR000103"}).json()["submission_id"]
    assert client.post(f"/api/billing/upi/submissions/{sid}/confirm", headers=ADMIN).status_code == 200
    s = client.get("/api/billing/upi/my-submission", headers=_auth("u-asha")).json()["submission"]
    assert s["status"] == "confirmed" and "now Pro" in s["message"]
    assert len(outbox) == 1 and outbox[0]["to"] == "asha@example.com" and "confirmed" in outbox[0]["subject"]
    assert raw.upi_payment_submissions.find_one({"id": sid})["notified_at"]


def test_reject_tells_the_person_what_to_do(env, outbox):
    client, raw = env
    sid = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"utr": "PYTESTUTR000104"}).json()["submission_id"]
    assert client.post(f"/api/billing/upi/submissions/{sid}/reject", headers=ADMIN).status_code == 200
    s = client.get("/api/billing/upi/my-submission", headers=_auth("u-asha")).json()["submission"]
    assert s["status"] == "rejected" and "submit it again" in s["message"]
    assert len(outbox) == 1 and "could not confirm" in outbox[0]["subject"]
    assert not raw.users.find_one({"id": "u-asha"}).get("is_pro")


def test_confirmed_cannot_then_be_rejected(env, outbox):
    client, raw = env
    sid = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"utr": "PYTESTUTR000105"}).json()["submission_id"]
    client.post(f"/api/billing/upi/submissions/{sid}/confirm", headers=ADMIN)
    assert client.post(f"/api/billing/upi/submissions/{sid}/reject", headers=ADMIN).status_code == 409
    assert raw.upi_payment_submissions.find_one({"id": sid})["status"] == "confirmed"


def test_email_failure_does_not_block_confirm(env, monkeypatch):
    import mailer
    async def boom(**k): raise RuntimeError("provider down")
    monkeypatch.setattr(mailer, "email_configured", lambda: True)
    monkeypatch.setattr(mailer, "send_email", boom)
    client, raw = env
    sid = client.post("/api/billing/upi/submit", headers=_auth("u-asha"), json={"utr": "PYTESTUTR000106"}).json()["submission_id"]
    assert client.post(f"/api/billing/upi/submissions/{sid}/confirm", headers=ADMIN).status_code == 200
    assert raw.users.find_one({"id": "u-asha"})["is_pro"] is True
