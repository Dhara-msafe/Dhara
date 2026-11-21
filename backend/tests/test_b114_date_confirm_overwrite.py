"""B-114 regression test: confirming the incident date must not clobber it
with the confirmation reply text.

Root cause
----------
PROBE_Q["probe_date_confirm"]["slot"] == "incident_date", so when the
STAGE_PROBE dispatcher's generic slot-filling chain (the long
`elif slot_key: ... elif user_message: if cp == "probe_place_text": ...
elif cp == "probe_date": ... else: slots[slot_key] = user_message`) ran for
cp == "probe_date_confirm", it fell through every named `elif` (none of them
match "probe_date_confirm") straight into the final catch-all `else`, which
wrote the raw quick-reply text -- e.g. "Yes, that's correct" or a citizen's
free-typed "Yes, that's correct 20:00" -- into slots["incident_date"].

Only *after* that, the dedicated `if cp == "probe_date_confirm":` block ran
and decided whether to keep or clear the date -- but by then the real,
already-parsed date was already gone, replaced by the confirmation text
itself. The FIR letter's "When:" line then showed that text instead of a
date (the Phase-6 tracker's reported symptom).

Fix verified here: the generic fallback now has an explicit
`elif cp == "probe_date_confirm": pass` before the catch-all, so
slots["incident_date"] is left untouched by the generic chain and is owned
entirely by the dedicated confirm/reject handler below it.

Run standalone (not via pytest, to avoid auto-collecting the _check helper):
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy \
    python3 backend/tests/test_b114_date_confirm_overwrite.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DB_NAME", "dhara_qa_test")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1")
os.environ.setdefault("EMERGENT_LLM_KEY", "dummy")
os.environ.setdefault("JWT_SECRET", "dummy")

import fir_engine  # noqa: E402

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


class _FakeCollection:
    def __init__(self):
        self.updates = []

    async def update_one(self, filt, update):
        self.updates.append((filt, update))
        return None

    async def find_one(self, filt, projection=None):
        return None


class _FakeDb:
    def __init__(self):
        self.fir_sessions = _FakeCollection()


def _base_session(real_date: str) -> dict:
    return {
        "session_id": "sess-b114-test",
        "stage": fir_engine.STAGE_PROBE,
        "status": "active",
        "slots": {
            "informant_name": "Test User",
            "incident_date": real_date,
        },
        "probe_history": [],
    }


async def run():
    real_date = "2026-11-14"

    # ── 1. Confirming the date ("Yes, that's correct") must leave the
    #       already-parsed date untouched, not overwrite it with the reply. ──
    db = _FakeDb()
    session = _base_session(real_date)
    result = await fir_engine._dispatch(
        db, None, session, fir_engine.STAGE_PROBE,
        session["slots"], ["probe_time"], "probe_date_confirm",
        ["theft"], "Yes, that's correct", None, "confirm",
        "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    final_slots = session["slots"]
    _check(
        "incident_date keeps its real parsed value after confirmation",
        final_slots.get("incident_date") == real_date,
        detail=str(final_slots.get("incident_date")),
    )
    _check(
        "date_confirmed is set True on confirmation",
        final_slots.get("date_confirmed") is True,
        detail=str(final_slots),
    )

    # ── 2. Same, but with a free-typed confirmation that also repeats a time
    #       ("Yes, that's correct 20:00") -- the exact string from the report. ──
    db2 = _FakeDb()
    session2 = _base_session(real_date)
    await fir_engine._dispatch(
        db2, None, session2, fir_engine.STAGE_PROBE,
        session2["slots"], ["probe_time"], "probe_date_confirm",
        ["theft"], "Yes, that's correct 20:00", None, None,
        "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "a free-typed confirmation with trailing text does not clobber incident_date either",
        session2["slots"].get("incident_date") == real_date,
        detail=str(session2["slots"].get("incident_date")),
    )

    # ── 3. Rejecting ("No, let me correct the date") must still clear the
    #       date and requeue probe_date, exactly as before this fix. ──
    db3 = _FakeDb()
    session3 = _base_session(real_date)
    result3 = await fir_engine._dispatch(
        db3, None, session3, fir_engine.STAGE_PROBE,
        session3["slots"], ["probe_time"], "probe_date_confirm",
        ["theft"], "No, let me correct the date", None, "correct",
        "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "rejecting the date clears incident_date so it can be re-asked",
        session3["slots"].get("incident_date") is None,
        detail=str(session3["slots"].get("incident_date")),
    )
    _check(
        "rejecting re-queues probe_date as the very next probe",
        result3.get("probe_key") == "probe_date",
        detail=str(result3),
    )

    # ── 4. Regression guard: an ordinary free-text probe (slot != reused by a
    #       confirm step) is still written normally by the generic fallback. ──
    db4 = _FakeDb()
    session4 = {
        "session_id": "sess-b114-regression",
        "stage": fir_engine.STAGE_PROBE,
        "status": "active",
        "slots": {"informant_name": "Test User"},
        "probe_history": [],
    }
    await fir_engine._dispatch(
        db4, None, session4, fir_engine.STAGE_PROBE,
        session4["slots"], [], "probe_consumer_order_id",
        ["theft"], "ORD-998877", None, None,
        "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "an ordinary probe answer is still saved normally (fix is scoped to probe_date_confirm)",
        session4["slots"].get("consumer_order_id") == "ORD-998877",
        detail=str(session4["slots"]),
    )


if __name__ == "__main__":
    asyncio.run(run())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
