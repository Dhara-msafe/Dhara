"""B-16 — login attempt protection (brute-force guard for POST /api/auth/login).

Counts failed email+password attempts in MongoDB (NOT in process memory — the
backend can run multiple workers and restarts must not clear a lockout) along
two independent dimensions:

  * account:<normalised email>  — one attacker trying one account
  * ip:<client ip>              — one attacker spraying many accounts

Behaviour (approved product decision):
  * progressive delay on every failed attempt (0.5s, 1s, 2s, 4s, capped at 8s)
  * temporary lock after 5 failures inside a 15-minute window — PER ACCOUNT ONLY.
    B-16d: the per-IP counter only adds delay (soft throttle). It never locks,
    because one office / campus / mobile-carrier address is shared by many
    innocent users.
  * the lock auto-expires after 15 minutes; a TTL index later reaps the record
    (TTL deletion is asynchronous, so `lock_until` is ALWAYS re-checked in the
    request path — never relied upon for correctness)
  * a successful login clears both the account and the IP counter
  * the lock is checked BEFORE any password hashing work happens

Existing auth primitives (hash_pw / check_pw / make_token) are untouched.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

COLLECTION = "login_attempts"
WINDOW_SECONDS = 15 * 60
MAX_FAILURES = 5
MAX_DELAY_SECONDS = 8.0


def normalize_email(value: str) -> str:
    return (value or "").strip().casefold()


def client_ip(request) -> Optional[str]:
    """Real client address, or None when it cannot be established.

    `request.client.host` here is the in-cluster pod address of the ingress
    (10.9.x.x) — it is SHARED by every user of the app and it rotates between
    proxy pods, so locking on it would both miss attackers and lock out
    innocent users. The edge sets X-Forwarded-For with the real client first,
    so that is used instead.

    A client can spoof the left-most X-Forwarded-For entry; the cost of that is
    only evading the per-IP counter, while the per-account counter still stops
    the brute force. That is strictly safer than locking a shared proxy IP.
    When no forwarded header is present the IP dimension is skipped entirely
    (None) rather than falling back to the shared pod address.
    """
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for") or ""
    first = xff.split(",")[0].strip()
    return first or None


async def ensure_indexes(db) -> None:
    await db[COLLECTION].create_index("expires_at", expireAfterSeconds=0,
                                     name="login_attempts_ttl")


def _remaining_seconds(doc: Optional[dict]) -> int:
    if not doc:
        return 0
    lock_until = doc.get("lock_until")
    if not lock_until:
        return 0
    if isinstance(lock_until, str):
        try:
            lock_until = datetime.fromisoformat(lock_until)
        except Exception:
            return 0
    if lock_until.tzinfo is None:
        lock_until = lock_until.replace(tzinfo=timezone.utc)
    return max(0, int((lock_until - datetime.now(timezone.utc)).total_seconds()))


def lock_detail(wait_seconds: int) -> dict:
    minutes = max(1, (wait_seconds + 59) // 60)
    unit = "minute" if minutes == 1 else "minutes"
    return {
        "code": "login_temporarily_locked",
        "message": (
            f"Too many failed sign-in attempts. Please try again in {minutes} {unit}."
        ),
        "retry_after_seconds": wait_seconds,
    }


async def check_lock(db, email_key: str, ip: Optional[str]) -> int:
    """Seconds still to wait, or 0. Called BEFORE any password check.
    B-16d: only the ACCOUNT lock blocks a login; `ip` is accepted for the
    unchanged call signature but an IP never locks anyone out."""
    doc = await db[COLLECTION].find_one({"_id": f"account:{email_key}"})
    return _remaining_seconds(doc)


async def _record_failure(db, kind: str, key: str) -> dict:
    """Atomic single-document increment — safe across workers AND across
    simultaneous requests. A failure after the window has elapsed starts a
    fresh window at 1.

    The cold-start path used to be a plain `$set: {failures: 1}` upsert, so N
    simultaneous first attempts each wrote 1 and N-1 failures were lost: an
    attacker firing 5 wrong passwords at once was recorded as a single failure
    and never locked out. The reset is now CLAIMED by exactly one caller
    (the filter only matches while the window is still stale) and everyone else
    falls through to the atomic `$inc`.
    """
    record_id = f"{kind}:{key}"
    now = datetime.now(timezone.utc)
    window_floor = now - timedelta(seconds=WINDOW_SECONDS)

    async def _increment_live_window():
        return await db[COLLECTION].find_one_and_update(
            {"_id": record_id, "window_started_at": {"$gt": window_floor}},
            {"$inc": {"failures": 1},
             "$set": {"kind": kind, "key": key, "last_failure_at": now}},
            return_document=ReturnDocument.AFTER,
        )

    doc = await _increment_live_window()
    if doc is None:
        # No live window (absent or expired) — exactly one caller gets to
        # (re)start it at failure 1; the filter stops matching the moment the
        # window is refreshed.
        try:
            doc = await db[COLLECTION].find_one_and_update(
                {"_id": record_id,
                 "$or": [{"window_started_at": {"$lte": window_floor}},
                         {"window_started_at": {"$exists": False}}]},
                {"$set": {
                    "kind": kind, "key": key, "failures": 1,
                    "window_started_at": now, "last_failure_at": now,
                    "lock_until": None,
                    "expires_at": now + timedelta(seconds=WINDOW_SECONDS),
                }},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            # Another caller inserted the record a moment ago — count on top.
            doc = None
        if doc is None:
            doc = await _increment_live_window()
        if doc is None:  # window vanished again (TTL/clear) — count from zero
            doc = await db[COLLECTION].find_one_and_update(
                {"_id": record_id},
                {"$inc": {"failures": 1},
                 "$set": {"kind": kind, "key": key, "last_failure_at": now,
                          "window_started_at": now,
                          "expires_at": now + timedelta(seconds=WINDOW_SECONDS)}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )

    if kind == "account" and int(doc.get("failures", 0)) >= MAX_FAILURES and not doc.get("lock_until"):
        lock_until = now + timedelta(seconds=WINDOW_SECONDS)
        doc = await db[COLLECTION].find_one_and_update(
            {"_id": record_id},
            {"$set": {"lock_until": lock_until, "expires_at": lock_until}},
            return_document=ReturnDocument.AFTER,
        )
    return doc


def _delay_for(failures: int) -> float:
    return min(MAX_DELAY_SECONDS, 0.5 * (2 ** max(0, failures - 1)))


async def register_failure(db, email_key: str, ip: Optional[str]) -> int:
    """Record one failed attempt on both dimensions, apply the progressive
    delay, and return the seconds to wait if this attempt tripped the lock."""
    account = await _record_failure(db, "account", email_key)
    ip_doc = await _record_failure(db, "ip", ip) if ip else None
    failures = max(int(account.get("failures", 0)),
                   int((ip_doc or {}).get("failures", 0)))
    await asyncio.sleep(_delay_for(failures))
    return _remaining_seconds(account)


async def clear_attempts(db, email_key: str, ip: Optional[str]) -> None:
    """A successful login resets BOTH counters — otherwise the IP record could
    keep locking out a user who has just proved they own the account."""
    ids = [f"account:{email_key}"]
    if ip:
        ids.append(f"ip:{ip}")
    await db[COLLECTION].delete_many({"_id": {"$in": ids}})
