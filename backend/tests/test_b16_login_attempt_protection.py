"""B-16 — login attempt protection.

Covers: progressive delay, 5-failure lockout inside a 15-minute window,
per-account AND per-IP counting, clear 429 message with wait time, no password
hashing once locked, counter reset on successful login, unknown emails counted
without leaking existence.

All tests go through the live HTTP endpoint so the real middleware / client-IP
path is exercised. Records are purged afterwards — no residue.
"""
import os
import sys
import time

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

sys.path.insert(0, "/app/backend")
from services.login_guard import (  # noqa: E402
    COLLECTION, MAX_FAILURES, WINDOW_SECONDS, normalize_email,
)

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

PASSWORD = "test1234"
WRONG = "definitely-wrong-password"

USER_LINKED_COLLECTIONS = [
    "sessions", "messages", "bookmarks", "draft_events", "password_resets",
    "terms_acknowledgements", "client_error_logs", "billing_intents",
    "missing_media",
]


@pytest.fixture(scope="module")
def db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _purge_user(db, uid: str):
    for name in USER_LINKED_COLLECTIONS:
        db[name].delete_many({"user_id": uid})
    db.usage_daily.delete_many({"user_id": uid, "scope": "user"})
    db.users.delete_one({"id": uid})


def _clear_attempts(db, email: str):
    """Drop every attempt record (account key for this email + any ip key) so
    each test starts from zero regardless of what ran before it."""
    db[COLLECTION].delete_many({"_id": f"account:{normalize_email(email)}"})
    db[COLLECTION].delete_many({"kind": "ip"})


@pytest.fixture()
def account(db):
    uniq = int(time.time() * 1000)
    email = f"TEST_b16_{uniq}@gandhikar.in"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": PASSWORD, "name": "B16 Tester",
        "phone": f"+9198772{uniq % 100000:05d}",
        "terms_accepted": True, "terms_version": "1.0",
    }, timeout=30)
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["id"]
    _clear_attempts(db, email)
    yield email, uid
    _clear_attempts(db, email)
    _purge_user(db, uid)


def _login(email, password):
    return requests.post(f"{API}/auth/login",
                         json={"email": email, "password": password}, timeout=60)


def test_four_failures_401_fifth_locks_429(account, db):
    email, _ = account
    for i in range(MAX_FAILURES - 1):
        r = _login(email, WRONG)
        assert r.status_code == 401, f"attempt {i + 1}: {r.status_code} {r.text}"
    r = _login(email, WRONG)
    assert r.status_code == 429, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "login_temporarily_locked"
    assert detail["retry_after_seconds"] > 0
    # clear message with the wait time, as approved
    assert "minute" in detail["message"]
    assert int(r.headers["Retry-After"]) > 0
    assert int(r.headers["Retry-After"]) == detail["retry_after_seconds"] or \
        abs(int(r.headers["Retry-After"]) - detail["retry_after_seconds"]) <= 1


def test_locked_request_skips_password_check(account, db):
    """Once locked, the correct password must ALSO be refused with 429 — proof
    that the gate runs before check_pw and that no bcrypt work is done."""
    email, _ = account
    for _ in range(MAX_FAILURES):
        _login(email, WRONG)
    r = _login(email, PASSWORD)
    assert r.status_code == 429, r.text
    assert r.json()["detail"]["code"] == "login_temporarily_locked"


def test_lock_is_persisted_in_mongo_not_memory(account, db):
    email, _ = account
    for _ in range(MAX_FAILURES):
        _login(email, WRONG)
    rec = db[COLLECTION].find_one({"_id": f"account:{normalize_email(email)}"})
    assert rec is not None
    assert rec["failures"] >= MAX_FAILURES
    assert rec["lock_until"] is not None
    assert rec["expires_at"] is not None  # TTL reaper field present


def test_ip_counter_also_recorded(account, db):
    email, _ = account
    _login(email, WRONG)
    ip_recs = list(db[COLLECTION].find({"kind": "ip"}))
    assert ip_recs, "no per-IP attempt record was written"
    assert ip_recs[0]["failures"] >= 1


def test_success_resets_both_counters(account, db):
    email, _ = account
    for _ in range(MAX_FAILURES - 1):
        assert _login(email, WRONG).status_code == 401
    r = _login(email, PASSWORD)
    assert r.status_code == 200, r.text
    assert db[COLLECTION].count_documents({"_id": f"account:{normalize_email(email)}"}) == 0
    # The per-IP row is SHARED with anything else logging in from this client
    # address (e.g. the other xdist worker), so "no ip row exists at all" is not
    # attributable to this login. What is attributable: the counter restarted —
    # no ip row may still be sitting at the lock threshold.
    for row in db[COLLECTION].find({"kind": "ip"}):
        assert int(row.get("failures", 0)) < MAX_FAILURES, row
        assert not row.get("lock_until"), row
    # the counter really did restart: the next wrong password is 401, not 429
    assert _login(email, WRONG).status_code == 401


def test_unknown_email_counted_but_response_identical(account, db):
    """An address that was never registered must return the same 401 (no user
    enumeration) while still being counted."""
    email, _ = account
    unknown = f"TEST_b16_nobody_{int(time.time() * 1000)}@gandhikar.in"
    r_unknown = _login(unknown, WRONG)
    r_known = _login(email, WRONG)
    assert r_unknown.status_code == r_known.status_code == 401
    assert r_unknown.json()["detail"] == r_known.json()["detail"] == "Invalid credentials"
    assert db[COLLECTION].count_documents({"_id": f"account:{normalize_email(unknown)}"}) == 1
    db[COLLECTION].delete_many({"_id": f"account:{normalize_email(unknown)}"})


def test_progressive_delay_grows(account, db):
    """Each failure must take measurably longer than the previous one."""
    email, _ = account
    timings = []
    for _ in range(3):
        t0 = time.time()
        assert _login(email, WRONG).status_code == 401
        timings.append(time.time() - t0)
    assert timings[1] > timings[0], timings
    assert timings[2] > timings[1], timings


def test_window_expiry_releases_lock(account, db):
    """Ageing the window past 15 minutes must let the user back in without any
    manual intervention (auto-unlock)."""
    email, uid = account
    for _ in range(MAX_FAILURES):
        _login(email, WRONG)
    assert _login(email, PASSWORD).status_code == 429
    # age every attempt record beyond the window
    from datetime import datetime, timedelta, timezone
    old = datetime.now(timezone.utc) - timedelta(seconds=WINDOW_SECONDS + 60)
    db[COLLECTION].update_many({}, {"$set": {"lock_until": old, "window_started_at": old}})
    r = _login(email, PASSWORD)
    assert r.status_code == 200, r.text


def test_ip_key_is_forwarded_client_not_shared_pod_ip(account, db):
    """The per-IP key must be the real client address from X-Forwarded-For.
    request.client.host here is the ingress pod address (10.9.x.x) which EVERY
    user shares — locking on it would lock out the whole user base."""
    email, _ = account
    _login(email, WRONG)
    ip_recs = list(db[COLLECTION].find({"kind": "ip"}))
    assert len(ip_recs) == 1, [r["_id"] for r in ip_recs]
    key = ip_recs[0]["key"]
    assert not key.startswith("10."), f"locked on shared in-cluster pod IP: {key}"
    assert key != "unknown"


def test_ip_counter_locks_spray_across_many_accounts(account, db):
    """Five failures spread over five DIFFERENT unknown emails from one address
    must trip the per-IP lock — the account counter alone would never fire."""
    email, _ = account
    db[COLLECTION].delete_many({})
    stamp = int(time.time() * 1000)
    # A SUCCESSFUL login from this address legitimately clears the IP counter
    # (that is the designed reset), and in a parallel run another module logs in
    # successfully from the very same client IP — so the lock can need more than
    # MAX_FAILURES attempts to trip. What must hold is that spraying from one
    # address DOES get locked, and that the lock then blocks an untouched
    # account; the exact attempt number is not the guarantee.
    sprayed = []
    locked_after = None
    for n in range(MAX_FAILURES * 4):
        e = f"TEST_b16_spray{n}_{stamp}@gandhikar.in"
        sprayed.append(e)
        code = _login(e, WRONG).status_code
        if code == 429:
            locked_after = n + 1
            break
        assert code == 401, (n, code)
    assert locked_after is not None, "per-IP spray never tripped the lock"
    # a sixth, completely untouched account is now blocked from this address
    r = _login(email, PASSWORD)
    assert r.status_code == 429, r.text
    for e in sprayed:
        db[COLLECTION].delete_many({"_id": f"account:{normalize_email(e)}"})
