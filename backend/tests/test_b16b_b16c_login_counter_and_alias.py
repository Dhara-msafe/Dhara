"""B-16b + B-16c (14 Nov 2026) — investigated both reported bugs:

  B-16b: "Login counter loses increments under load." Read through
  services/login_guard.py's _record_failure(): the live-window path uses a
  single atomic MongoDB find_one_and_update $inc (Mongo serializes writes per
  document, so this can never lose an increment under concurrency), and the
  cold-start path claims the fresh window with an upsert that is guarded by a
  DuplicateKeyError catch-and-retry, so concurrent cold-start callers never
  stomp on each other either. Stress-tested below with 20 concurrent failures
  on one account via asyncio.gather against a faithful in-memory fake of
  MongoDB's findOneAndUpdate/upsert semantics: zero increments lost every run.

  B-16c: "Root /auth/login alias returns 500." Read server.py's
  `_alias_auth_login` (forwards straight into api.auth_router.login(), added
  specifically because some deployed clients call /auth/login without the
  /api/ prefix and the platform ingress otherwise routes that path to the
  frontend's dev server, which returns an HTML page the client can't parse).
  Exercised the alias through a REAL ASGI/HTTP round-trip (httpx against
  server.app directly, not a bare Python call) covering the success path,
  wrong password (401), and driving the account to the 5-failure lockout
  (429) -- no 500 in any of them.

  Conclusion: both are sound in this codebase's CURRENT code. The sheet's
  "Final check needs ENV-02" is an infra/ops verification (seeing the real
  ingress route POST /auth/login to the backend rather than the frontend
  under real load, in the isolated closed-test environment Nithish is
  setting up) -- not a code bug reachable from here. These tests exist so
  that conclusion keeps being true: if either breaks, these catch it before
  ENV-02 does.

Run: python3 backend/tests/test_b16b_b16c_login_counter_and_alias.py
"""
import os
import sys
import asyncio

os.environ.setdefault("DB_NAME", "test_b16bc_db")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1")
os.environ.setdefault("EMERGENT_LLM_KEY", "dummy")
os.environ.setdefault("JWT_SECRET", "dummy")
os.environ.setdefault("OUTBOUND_MODE", "simulate")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS = 0
FAIL = 0


def _check(name: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  OK   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name} -- {detail}")


# ── A faithful-enough in-memory async Mongo collection ───────────────────────
# Supports find_one, find_one_and_update ($set / $inc / upsert / AFTER), and
# delete_many -- enough to exercise the real services/login_guard.py logic,
# including the DuplicateKeyError race on a cold-start concurrent upsert.
from pymongo.errors import DuplicateKeyError  # noqa: E402


def _matches(doc, filt):
    if doc is None:
        return False
    for k, v in filt.items():
        if k == "$or":
            if not any(_matches(doc, sub) for sub in v):
                return False
            continue
        if isinstance(v, dict) and ("$gt" in v or "$lte" in v or "$exists" in v):
            if "$gt" in v:
                cur = doc.get(k)
                if cur is None or not (cur > v["$gt"]):
                    return False
            if "$lte" in v:
                cur = doc.get(k)
                if cur is None or not (cur <= v["$lte"]):
                    return False
            if "$exists" in v:
                if (k in doc) != v["$exists"]:
                    return False
        else:
            if doc.get(k) != v:
                return False
    return True


class _FakeAttemptsCollection:
    def __init__(self):
        self._docs: dict = {}
        self._lock = asyncio.Lock()

    async def find_one(self, filt):
        doc = self._docs.get(filt.get("_id"))
        return dict(doc) if doc else None

    async def find_one_and_update(self, filt, update, upsert=False, return_document=None):
        async with self._lock:
            _id = filt.get("_id")
            existing = self._docs.get(_id)
            if existing is not None and not _matches(existing, filt):
                if upsert:
                    raise DuplicateKeyError(f"duplicate key: {_id}")
                return None
            if existing is None and not upsert:
                return None
            base = dict(existing) if existing else {"_id": _id}
            if "$set" in update:
                base.update(update["$set"])
            if "$inc" in update:
                for k, v in update["$inc"].items():
                    base[k] = base.get(k, 0) + v
            self._docs[_id] = base
            return dict(base)

    async def delete_many(self, filt):
        if "_id" in filt and isinstance(filt["_id"], dict) and "$in" in filt["_id"]:
            for _id in list(self._docs.keys()):
                if _id in filt["_id"]["$in"]:
                    del self._docs[_id]
            return
        for k in [k for k, v in self._docs.items() if _matches(v, filt)]:
            del self._docs[k]


class _FakeUsersCollection:
    def __init__(self, user=None):
        self._user = user

    async def find_one(self, query):
        if self._user and query.get("email") == self._user.get("email"):
            return self._user
        return None


class _FakeDb:
    def __init__(self, user=None):
        self.users = _FakeUsersCollection(user)
        self.login_attempts = _FakeAttemptsCollection()

    def __getitem__(self, name):
        return getattr(self, name)


async def _test_b16b_no_lost_increments_under_concurrency():
    from services import login_guard
    db = _FakeDb()
    N = 20
    await asyncio.gather(*[
        login_guard.register_failure(db, "concurrenttest@example.com", f"1.2.3.{i % 3}")
        for i in range(N)
    ])
    doc = await db.login_attempts.find_one({"_id": "account:concurrenttest@example.com"})
    _check(
        "B-16b: 20 concurrent failures on one account record exactly 20 (no lost increments)",
        doc is not None and doc.get("failures") == N,
        f"got {doc.get('failures') if doc else None}",
    )


async def _test_b16c_alias_route_through_real_http():
    import server
    from dependencies import hash_pw
    import api.auth_router as auth_router
    import httpx

    user = {
        "id": "u1", "email": "b16c_probe@example.com",
        "password_hash": hash_pw("Correct1!"),
        "name": "Probe", "phone": "+911234567890",
        "is_pro": False, "is_grandfathered": True,
        "terms_accepted": True, "terms_version": "1.0",
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    fake_db = _FakeDb(user)
    server.db = fake_db
    auth_router.db = fake_db

    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r_ok = await client.post(
            "/auth/login", json={"email": "b16c_probe@example.com", "password": "Correct1!"},
            headers={"x-forwarded-for": "203.0.113.50"},
        )
        _check("B-16c: alias /auth/login success path is 200, not 500", r_ok.status_code == 200, r_ok.text)
        _check("B-16c: alias success body has a token", "token" in r_ok.json(), r_ok.text)

        r_wrong = await client.post(
            "/auth/login", json={"email": "b16c_probe@example.com", "password": "WRONG"},
            headers={"x-forwarded-for": "203.0.113.51"},
        )
        _check("B-16c: alias wrong-password is 401, not 500", r_wrong.status_code == 401, r_wrong.text)

        # Drive to lockout -- 4 more wrong attempts (5 total) must 429, not 500.
        last = None
        for _ in range(4):
            last = await client.post(
                "/auth/login", json={"email": "b16c_probe@example.com", "password": "WRONG"},
                headers={"x-forwarded-for": "203.0.113.51"},
            )
        _check("B-16c: alias lockout path is 429, not 500", last.status_code == 429, last.text)

        r_unknown = await client.post(
            "/auth/login", json={"email": "nobody_b16c@example.com", "password": "whatever"},
            headers={"x-forwarded-for": "203.0.113.52"},
        )
        _check("B-16c: alias unknown-email path is 401, not 500", r_unknown.status_code == 401, r_unknown.text)


async def _main():
    print("B-16b: login counter atomicity under concurrency")
    await _test_b16b_no_lost_increments_under_concurrency()
    print("B-16c: /auth/login alias through real HTTP dispatch")
    await _test_b16c_alias_route_through_real_http()


if __name__ == "__main__":
    asyncio.run(_main())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
