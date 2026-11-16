"""B-21 — OTP-send rate limits (forgot-password, account-deletion codes)
stored in MongoDB instead of a process-local dict.

Before this fix, auth_router.py's `_RESET_SENDS` / `_DELETE_SENDS` were plain
module-level Python dicts: `{"3 codes per hour" per email}` lived only in the
memory of whichever worker process handled the request.

  * The backend normally runs more than one worker process. Each worker has
    its own, separate copy of the dict, so the real limit was "3 per hour
    PER WORKER" — against N workers, an attacker (or a confused user hammering
    "resend") could get up to 3*N codes in an hour just by landing on
    different workers, which load balancing does essentially at random.
  * A deploy, crash, or autoscale event restarts the process and wipes the
    dict to empty, instantly forgiving anyone who was mid-lockout.

This mirrors the fix B-16 already applied to the login-attempt counters
(services/login_guard.py): the send history moves into MongoDB, a single
shared, durable store every worker reads and writes the same record from.

This is a best-effort throttle on outbound email volume, not a security
boundary the way the login lock is (the worst case of a missed race here is
one or two extra emails sent to a real inbox, never an unlimited guessing
window into someone's account), so a simple read-prune-check-write is used
rather than login_guard's heavier claim-the-window atomic dance — that
reduces, rather than removes, the small window where two near-simultaneous
requests both read the state before either writes it back.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

COLLECTION = "otp_sends"


async def ensure_indexes(db) -> None:
    await db[COLLECTION].create_index("expires_at", expireAfterSeconds=0,
                                     name="otp_sends_ttl")


def _parse(raw) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def _pruned_sends(db, record_id: str, cutoff: datetime) -> list[datetime]:
    doc = await db[COLLECTION].find_one({"_id": record_id})
    if not doc:
        return []
    out = []
    for raw in doc.get("sends", []):
        ts = _parse(raw)
        if ts and ts > cutoff:
            out.append(ts)
    return out


async def check_and_record_send(
    db, kind: str, email: str, *,
    max_sends: int, window: timedelta, min_gap: timedelta,
) -> Optional[str]:
    """Returns a user-facing error message if this request should be
    blocked; otherwise records the send and returns None.

    `kind` namespaces independent limits that must never share a bucket
    (e.g. "reset" vs "delete") even for the same email.
    """
    record_id = f"{kind}:{email}"
    now = datetime.now(timezone.utc)
    cutoff = now - window

    sends = await _pruned_sends(db, record_id, cutoff)
    if sends and (now - sends[-1]) < min_gap:
        return "Please wait a minute before requesting another code."
    if len(sends) >= max_sends:
        return "Too many requests. Please try again in an hour."

    sends.append(now)
    await db[COLLECTION].update_one(
        {"_id": record_id},
        {"$set": {
            "email": email, "kind": kind,
            "sends": [t.isoformat() for t in sends],
            "expires_at": now + window,
        }},
        upsert=True,
    )
    return None


async def clear_sends(db, kind: str, email: str) -> None:
    """Called once the flow this limit guards actually succeeds (code
    verified, password changed / account deleted) so a legitimate user who
    needed a couple of retries isn't left throttled afterwards."""
    await db[COLLECTION].delete_one({"_id": f"{kind}:{email}"})
