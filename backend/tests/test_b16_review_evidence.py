"""B-16 review evidence — route coverage, cross-worker state, atomicity.

Separate from the behavioural suite (test_b16_login_attempt_protection.py).
These tests answer three specific review questions:

  1. Is EVERY login route protected (no unprotected /auth/login twin)?
  2. Do the counters work when the backend runs MULTIPLE uvicorn workers
     (a worker that never saw the failures must still honour the lock)?
  3. Are concurrent failed attempts counted atomically (no lost updates)?

The multi-worker test boots a throwaway 4-worker uvicorn on port 8099 against
the SAME MongoDB, so it is real evidence rather than an argument about the code.
"""
import os
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

sys.path.insert(0, "/app/backend")
from services.login_guard import COLLECTION, MAX_FAILURES, normalize_email  # noqa: E402

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = "Test1234!"
WRONG = "definitely-wrong-password"
WORKER_PORT = 8099


@pytest.fixture(scope="module")
def db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _register(db, tag: str):
    uniq = int(time.time() * 1000)
    email = f"TEST_b16{tag}_{uniq}@gandhikar.in"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": PASSWORD, "name": "B16 Review",
        "phone": f"+9198775{uniq % 100000:05d}",
        "terms_accepted": True, "terms_version": "1.0",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return email, r.json()["user"]["id"]


def _cleanup(db, email, uid):
    db[COLLECTION].delete_many({"_id": f"account:{normalize_email(email)}"})
    db[COLLECTION].delete_many({"kind": "ip"})
    db.terms_acknowledgements.delete_many({"user_id": uid})
    db.sessions.delete_many({"user_id": uid})
    db.users.delete_one({"id": uid})


# ─────────────── 1. route coverage ───────────────
def test_every_login_route_in_the_app_is_the_protected_one():
    """Introspect the real ASGI app: EVERY login route must resolve to the
    guarded handler — there must be no unprotected twin. The canonical route is
    the /api-prefixed handler; the legacy unprefixed /auth/login alias (kept for
    stale deployed clients, and not externally reachable — see the test below)
    must FORWARD into that same guarded handler, never a parallel unguarded one."""
    from server import app
    from api import auth_router
    from services import login_guard

    paths = sorted({r.path for r in app.routes if r.path.endswith("/auth/login")})
    assert paths == ["/api/auth/login", "/auth/login"], paths

    # Canonical handler runs the brute-force guard directly.
    canonical = next(r.endpoint for r in app.routes if r.path == "/api/auth/login")
    names = set(canonical.__code__.co_names)
    assert {"check_lock", "register_failure", "clear_attempts"} <= names, names
    assert canonical.__module__.endswith("auth_router")

    # Legacy alias must forward straight into the SAME guarded login function —
    # no second, unguarded implementation.
    alias = next(r.endpoint for r in app.routes if r.path == "/auth/login")
    assert "_alias_login_fn" in alias.__code__.co_names
    assert alias.__globals__["_alias_login_fn"] is auth_router.login

    assert login_guard.MAX_FAILURES == 5


def test_unprefixed_auth_login_is_not_reachable_externally():
    """The ingress sends only /api/* to the backend; /auth/login must not be a
    second, unguarded way in."""
    r = requests.post(f"{BASE_URL}/auth/login",
                      json={"email": "nobody@example.com", "password": "xxxxxx"},
                      timeout=30)
    assert r.status_code == 404, f"{r.status_code} {r.text[:200]}"


# ─────────────── 2. multiple backend workers ───────────────
@pytest.fixture(scope="module")
def multiworker():
    """Throwaway 4-worker uvicorn on the same MongoDB."""
    proc = subprocess.Popen(
        ["/root/.venv/bin/uvicorn", "server:app", "--host", "127.0.0.1",
         "--port", str(WORKER_PORT), "--workers", "4"],
        cwd="/app/backend", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 90
    while time.time() < deadline:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", WORKER_PORT)) == 0:
                break
        time.sleep(1)
    else:
        proc.terminate()
        pytest.fail("4-worker uvicorn did not come up")
    time.sleep(3)
    yield f"http://127.0.0.1:{WORKER_PORT}/api"
    proc.terminate()
    proc.wait(timeout=30)


def test_lock_is_shared_across_workers(multiworker, db):
    """Failures are spread over 4 workers (round-robin by the OS accept queue);
    the worker that finally answers must honour a lock it never created.
    In-process counters would fail this."""
    email, uid = _register(db, "mw")
    try:
        codes = []
        for _ in range(MAX_FAILURES + 1):
            codes.append(requests.post(f"{multiworker}/auth/login",
                                       json={"email": email, "password": WRONG},
                                       timeout=60).status_code)
        assert 429 in codes, codes
        # every worker now refuses even the correct password
        for _ in range(4):
            r = requests.post(f"{multiworker}/auth/login",
                              json={"email": email, "password": PASSWORD}, timeout=60)
            assert r.status_code == 429, r.text
            assert r.json()["detail"]["code"] == "login_temporarily_locked"
    finally:
        _cleanup(db, email, uid)


def test_concurrent_failures_counted_atomically(multiworker, db):
    """MAX_FAILURES simultaneous wrong passwords across 4 workers must produce
    EXACTLY MAX_FAILURES recorded failures — a read-modify-write counter would
    lose updates here and under-count."""
    email, uid = _register(db, "atomic")
    key = f"account:{normalize_email(email)}"
    db[COLLECTION].delete_many({"_id": key})
    try:
        def attempt(_):
            return requests.post(f"{multiworker}/auth/login",
                                 json={"email": email, "password": WRONG},
                                 timeout=60).status_code

        with ThreadPoolExecutor(max_workers=MAX_FAILURES) as pool:
            # Clear the per-IP dimension immediately before the burst: it is
            # SHARED with anything else logging in from this address (the other
            # xdist worker), and an IP lock already in force would 429 these
            # attempts before the account counter ever sees them.
            db[COLLECTION].delete_many({"kind": "ip"})
            codes = list(pool.map(attempt, range(MAX_FAILURES)))

        rec = db[COLLECTION].find_one({"_id": key})
        assert rec is not None, "no attempt record written"
        assert int(rec["failures"]) == MAX_FAILURES, (rec["failures"], codes)
        assert rec["lock_until"] is not None, rec
        # and the lock is in force for the next caller
        r = requests.post(f"{multiworker}/auth/login",
                          json={"email": email, "password": PASSWORD}, timeout=60)
        assert r.status_code == 429, r.text
    finally:
        _cleanup(db, email, uid)


def test_concurrent_requests_do_not_double_lock_or_reset(multiworker, db):
    """Two simultaneous requests after a lock is set must both see the SAME
    lock_until (no racing re-lock that extends the wait, no accidental reset)."""
    email, uid = _register(db, "stable")
    key = f"account:{normalize_email(email)}"
    try:
        for _ in range(MAX_FAILURES):
            requests.post(f"{multiworker}/auth/login",
                          json={"email": email, "password": WRONG}, timeout=60)
        before = db[COLLECTION].find_one({"_id": key})["lock_until"]

        def attempt(_):
            return requests.post(f"{multiworker}/auth/login",
                                 json={"email": email, "password": WRONG},
                                 timeout=60).json()["detail"]["retry_after_seconds"]

        with ThreadPoolExecutor(max_workers=4) as pool:
            waits = list(pool.map(attempt, range(4)))

        after = db[COLLECTION].find_one({"_id": key})["lock_until"]
        assert after == before, (before, after)
        assert max(waits) - min(waits) <= 2, waits
    finally:
        _cleanup(db, email, uid)


# ─────────────── 3. guest / Google untouched ───────────────
def test_guest_and_google_endpoints_have_no_login_guard():
    from server import app
    for path in ["/api/auth/guest", "/api/auth/session"]:
        ep = next((r.endpoint for r in app.routes if r.path == path), None)
        assert ep is not None, f"{path} missing"
        names = set(ep.__code__.co_names)
        assert "check_lock" not in names, f"{path} unexpectedly guarded"
        assert "register_failure" not in names, f"{path} unexpectedly guarded"
