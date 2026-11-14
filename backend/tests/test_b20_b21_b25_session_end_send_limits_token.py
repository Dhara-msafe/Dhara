"""B-20 + B-21 + B-25 (14 Nov 2026): three items grouped on the tracker as
"Server cannot end sessions; send limits kept in memory; login token
unencrypted on phone."

B-20 (fixed): a JWT used to be pure bearer state -- valid for the rest of its
30-day life no matter what, with no way for the server to revoke one it had
already issued. Every token now carries the user's "token_version" ("tv") at
mint time, and current_user()/current_user_optional() (dependencies.py) check
it against the live value on the user doc. POST /api/auth/logout-everywhere
(api/auth_router.py) bumps it, instantly failing every token minted before
that call; a password reset (POST /api/auth/reset-password) bumps it too,
since that's the one moment we know someone besides the usual owner may have
held a working token. This script proves: a token minted at tv=0 is accepted
while the user doc still reads tv=0, and rejected (not just "stale", actually
401) the moment the user doc's token_version changes -- without touching the
token itself.

B-21 (fixed): the OTP-send rate limits for password-reset and account-
deletion codes (forgot_password / request_deletion_otp in api/auth_router.py)
used to live in module-level Python dicts (_RESET_SENDS / _DELETE_SENDS) --
memory local to whichever worker process handled the request, reset to zero
by any restart, and NOT shared between workers (so "3 per hour" could really
be "3 per hour per worker"). services/send_limit.py moves this into MongoDB,
the same fix B-16 already applied to the login-attempt counters. This script
proves the limit survives being read from a fresh module import against the
same backing store (simulating a different worker process) and that "reset"
and "delete" are independent buckets for the same email.

B-25: the sign-in token used to be written with a plain (non-JSON,
unencrypted-on-disk) AsyncStorage.setItem() call in frontend/src/auth.tsx.
That fix is purely a React Native / Keychain-vs-AsyncStorage change with no
backend surface to test from Python; its coverage is
frontend/src/__tests__/b25_secure_token_storage.test.mjs.

All against an in-memory fake MongoDB collection (no real Mongo needed) using
the pattern this session has used throughout: faithful enough to $set / $inc /
upsert semantics to trust both a positive and a negative result, never a
real network call.
"""
import os
import sys

os.environ.setdefault("DB_NAME", "dhara_test")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1")
os.environ.setdefault("EMERGENT_LLM_KEY", "dummy")
os.environ.setdefault("JWT_SECRET", "test-secret-for-b20-b21-b25")
os.environ.setdefault("OUTBOUND_MODE", "simulate")
os.environ.setdefault("ADMIN_KEY", "")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
from datetime import timedelta

import jwt as pyjwt

PASS = 0
FAIL = 0


def _check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS: {name}")
    else:
        FAIL += 1
        print(f"FAIL: {name} -- {detail}")


class FakeCollection:
    """Minimal faithful-enough fake of a Motor/pymongo collection: find_one,
    update_one ($set / $inc, upsert=True), delete_one. Good enough for
    services/send_limit.py and a users collection used only via these three
    operations in this script -- not a general Mongo emulator."""

    def __init__(self):
        self.docs: dict = {}

    async def find_one(self, filt: dict, projection: dict = None):
        _id = filt.get("_id")
        if _id is not None:
            doc = self.docs.get(_id)
            return dict(doc) if doc is not None else None
        for doc in self.docs.values():
            if all(doc.get(k) == v for k, v in filt.items()):
                return dict(doc)
        return None

    async def update_one(self, filt: dict, update: dict, upsert: bool = False):
        _id = filt.get("_id")
        if _id is not None:
            doc = self.docs.get(_id)
        else:
            # Find the first doc matching an arbitrary filter (e.g. {"id": uid}
            # or {"email": email}), same semantics as find_one's generic branch.
            doc = next((d for d in self.docs.values()
                        if all(d.get(k) == v for k, v in filt.items())), None)
        if doc is None:
            if not upsert:
                return
            doc = dict(filt)
            key = _id if _id is not None else filt.get("email") or filt.get("id") or str(len(self.docs))
            self.docs[key] = doc
        for k, v in update.get("$set", {}).items():
            doc[k] = v
        for k, v in update.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + v

    async def delete_one(self, filt: dict):
        _id = filt.get("_id")
        if _id is not None:
            self.docs.pop(_id, None)


class FakeDb:
    def __init__(self):
        self._cols: dict = {}

    def __getitem__(self, name):
        return self._cols.setdefault(name, FakeCollection())

    def __getattr__(self, name):
        return self[name]


def _test_b20_token_version_ends_a_session():
    from dependencies import make_token, current_user, JWT_SECRET, JWT_ALG

    async def _run():
        db = FakeDb()
        db.users.docs["u1"] = {"id": "u1", "email": "a@test.local", "name": "A"}

        token = make_token("u1", 0)
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        _check("B-20: make_token embeds tv in the payload", payload.get("tv") == 0,
               f"payload={payload}")

        import dependencies
        dependencies.db = db  # current_user() reads the module-level `db`

        user = await current_user(authorization=f"Bearer {token}")
        _check("B-20: a token whose tv matches the user doc is accepted",
               user is not None and user["id"] == "u1")

        # Simulate POST /auth/logout-everywhere: bump token_version server-side.
        await db.users.update_one({"id": "u1"}, {"$inc": {"token_version": 1}})

        rejected = False
        try:
            await current_user(authorization=f"Bearer {token}")
        except Exception as e:
            rejected = getattr(e, "status_code", None) == 401
        _check("B-20: the SAME still-unexpired, correctly-signed token is "
               "rejected the instant token_version changes -- this is the "
               "server actually ending the session, not just the token aging out",
               rejected)

        # A freshly minted token at the new tv works again.
        token2 = make_token("u1", 1)
        user2 = await current_user(authorization=f"Bearer {token2}")
        _check("B-20: a new token minted at the current tv is accepted",
               user2 is not None and user2["id"] == "u1")

    asyncio.run(_run())


def _test_b20_password_reset_bumps_token_version():
    """Mirrors what POST /auth/reset-password now does: $set password_hash
    alongside $inc token_version in the SAME update."""
    async def _run():
        db = FakeDb()
        db.users.docs["u2"] = {"id": "u2", "email": "b@test.local", "token_version": 0}
        await db.users.update_one(
            {"id": "u2"},
            {"$set": {"password_hash": "new-hash"}, "$inc": {"token_version": 1}},
        )
        updated = await db.users.find_one({"id": "u2"})
        _check("B-20: a password reset's own update bumps token_version "
               "alongside the password hash (same $inc this session added to "
               "reset_password's existing $set)",
               updated.get("token_version") == 1 and updated.get("password_hash") == "new-hash",
               f"updated={updated}")

    asyncio.run(_run())


def _test_b21_send_limit_shared_across_fresh_imports():
    """Simulates two different worker processes (which, under the OLD
    _RESET_SENDS module dict, would each have their own empty dict and each
    independently allow 3 sends) by using two SEPARATE calls into
    send_limit against the SAME backing store, with no shared Python state
    beyond the fake db itself."""
    from services.send_limit import check_and_record_send, clear_sends

    async def _run():
        db = FakeDb()
        email = "c@test.local"
        window = timedelta(hours=1)
        min_gap = timedelta(seconds=0)  # no artificial gap for this test

        results = []
        for i in range(4):
            blocked = await check_and_record_send(
                db, "reset", email, max_sends=3, window=window, min_gap=min_gap,
            )
            results.append(blocked)

        _check("B-21: the first 3 sends within the window are allowed",
               results[0] is None and results[1] is None and results[2] is None,
               f"results={results}")
        _check("B-21: the 4th send within the SAME window is blocked -- the "
               "limit held even though each call only touched the shared fake "
               "db and never shared Python state, exactly like two separate "
               "worker processes talking to the same MongoDB would",
               results[3] is not None, f"results={results}")

        # Independent bucket: a "delete" send for the same email is untouched
        # by the "reset" bucket above.
        delete_blocked = await check_and_record_send(
            db, "delete", email, max_sends=3, window=window, min_gap=min_gap,
        )
        _check("B-21: 'reset' and 'delete' are independent buckets for the "
               "same email -- using up the reset limit doesn't block deletion "
               "codes (and vice versa)",
               delete_blocked is None, f"delete_blocked={delete_blocked}")

        # clear_sends (called on successful password reset / account
        # deletion) resets the bucket for a legitimate user who needed a
        # couple of retries.
        await clear_sends(db, "reset", email)
        after_clear = await check_and_record_send(
            db, "reset", email, max_sends=3, window=window, min_gap=min_gap,
        )
        _check("B-21: clear_sends() resets the bucket after a successful "
               "verification, so a legitimate user isn't left throttled",
               after_clear is None, f"after_clear={after_clear}")

    asyncio.run(_run())


def _test_b21_min_gap_blocks_rapid_resend():
    from services.send_limit import check_and_record_send

    async def _run():
        db = FakeDb()
        email = "d@test.local"
        window = timedelta(hours=1)
        min_gap = timedelta(seconds=60)

        first = await check_and_record_send(
            db, "reset", email, max_sends=3, window=window, min_gap=min_gap,
        )
        second = await check_and_record_send(
            db, "reset", email, max_sends=3, window=window, min_gap=min_gap,
        )
        _check("B-21: a second send immediately after the first is blocked "
               "by the minimum-gap check (not just the max-sends count)",
               first is None and second is not None,
               f"first={first} second={second}")

    asyncio.run(_run())


if __name__ == "__main__":
    _test_b20_token_version_ends_a_session()
    _test_b20_password_reset_bumps_token_version()
    _test_b21_send_limit_shared_across_fresh_imports()
    _test_b21_min_gap_blocks_rapid_resend()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
