"""B-90: Consent asked again after guest start and after sign-up.

Root cause: consent is normally given on the /consent screen BEFORE the
person has an account (anonymous), via POST /api/consent/log, which only
writes an audit row (db.consent_log) -- it does NOT touch db.users at all
for an anonymous caller (that only happens for an *authenticated* caller).
Once guest-start/sign-up/login completes, auth.tsx's persist() calls
POST /api/consent/link to re-tag those consent_log rows with the new
user_id -- but the old link_anonymous_consent() only updated consent_log
rows, never the user's own account record. So right after linking,
db.users still had no terms_version/consent_purposes at all, and the very
next ConsentGuard check (frontend/app/_layout.tsx) saw no current consent
for this user and re-opened /consent -- asking again for consent just
given moments earlier.

(A second, independent half of this same bug -- a local AsyncStorage key
mismatch between the anonymous consent flag and the new per-user-id key --
is fixed separately in frontend/src/consentStorage.ts's new
migrateAnonConsentToUser(), wired into auth.tsx's persist(). That half is
frontend-only and isn't exercised by this backend test.)

Fix verified here: link_anonymous_consent() now also adopts the most
recently linked consent_log entry's notice_version/purposes/etc onto the
user's own db.users record -- the same fields an authenticated
/api/consent/log call would have set -- but never downgrades an
already-current consent.

Run standalone (not via pytest):
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy OUTBOUND_MODE=simulate \
    python3 backend/tests/test_b90_consent_link_sets_user_record.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DB_NAME", "dhara_qa_test")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1")
os.environ.setdefault("EMERGENT_LLM_KEY", "dummy")
os.environ.setdefault("JWT_SECRET", "dummy")
os.environ.setdefault("OUTBOUND_MODE", "simulate")

import server  # noqa: E402

PASS = 0
FAIL = 0


def _check(name: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


class _FakeConsentLogCollection:
    def __init__(self, rows):
        self._rows = rows

    async def update_many(self, filt, update):
        matched = [
            r for r in self._rows
            if r.get("anon_id") == filt.get("anon_id") and r.get("user_id") == filt.get("user_id")
        ]
        for r in matched:
            r.update(update["$set"])
        return type("Result", (), {"modified_count": len(matched)})()

    async def find_one(self, filt, sort=None):
        matched = [
            r for r in self._rows
            if r.get("anon_id") == filt.get("anon_id") and r.get("user_id") == filt.get("user_id")
        ]
        if not matched:
            return None
        if sort:
            key, direction = sort[0]
            matched.sort(key=lambda r: r.get(key, ""), reverse=(direction == -1))
        return matched[0]


class _FakeUsersCollection:
    def __init__(self):
        self.last_set = None
        self.update_calls = 0

    async def update_one(self, filt, update):
        self.update_calls += 1
        self.last_set = update.get("$set")
        return None


class _FakeDb:
    def __init__(self, consent_rows):
        self.consent_log = _FakeConsentLogCollection(consent_rows)
        self.users = _FakeUsersCollection()


async def run():
    # ── 1. The actual bug: an anon consent row gets linked to the new
    #       account, and the account record itself must now show current
    #       consent (terms_version/consent_purposes), not stay blank. ─────
    rows = [{
        "anon_id": "anon-123", "user_id": None,
        "notice_version": "2026-10-01",
        "purposes": {"core": True, "analytics": False, "updates": True},
        "language": "en", "age_confirmed_18": True,
        "timestamp": "2026-11-14T00:00:00Z",
    }]
    fake_db = _FakeDb(rows)
    server.db = fake_db
    user = {"id": "user-1", "terms_version": None}
    result = await server.link_anonymous_consent(
        server.ConsentLinkIn(anon_id="anon-123"), user,
    )
    _check("link reports 1 row modified", result["linked"] == 1, detail=str(result))
    _check(
        "the user's own record now has the linked notice_version",
        fake_db.users.last_set is not None and fake_db.users.last_set.get("terms_version") == "2026-10-01",
        detail=str(fake_db.users.last_set),
    )
    _check(
        "the user's own record now has the linked consent purposes",
        fake_db.users.last_set is not None
        and fake_db.users.last_set.get("consent_purposes") == {"core": True, "analytics": False, "updates": True},
        detail=str(fake_db.users.last_set),
    )
    _check(
        "the user's own record is now marked terms_accepted",
        fake_db.users.last_set is not None and fake_db.users.last_set.get("terms_accepted") is True,
        detail=str(fake_db.users.last_set),
    )

    # ── 2. No unclaimed rows for this anon_id -> no spurious user update ──
    fake_db2 = _FakeDb([])
    server.db = fake_db2
    user2 = {"id": "user-2", "terms_version": None}
    result2 = await server.link_anonymous_consent(
        server.ConsentLinkIn(anon_id="anon-nothing"), user2,
    )
    _check("no matching rows -> 0 linked", result2["linked"] == 0, detail=str(result2))
    _check(
        "no matching rows -> users collection is never touched",
        fake_db2.users.update_calls == 0,
        detail=str(fake_db2.users.update_calls),
    )

    # ── 3. Regression guard: an already-current consent is not clobbered ──
    rows3 = [{
        "anon_id": "anon-456", "user_id": None,
        "notice_version": "2026-10-01",
        "purposes": {"core": True, "analytics": True, "updates": True},
        "language": "en", "age_confirmed_18": True,
        "timestamp": "2026-11-14T00:00:00Z",
    }]
    fake_db3 = _FakeDb(rows3)
    server.db = fake_db3
    user3 = {"id": "user-3", "terms_version": "2026-10-01"}  # already current
    await server.link_anonymous_consent(server.ConsentLinkIn(anon_id="anon-456"), user3)
    _check(
        "already-current consent is left untouched (no redundant overwrite)",
        fake_db3.users.update_calls == 0,
        detail=str(fake_db3.users.update_calls),
    )


if __name__ == "__main__":
    asyncio.run(run())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
