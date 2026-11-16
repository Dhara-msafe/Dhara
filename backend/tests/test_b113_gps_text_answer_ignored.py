"""B-113 regression test: a free-typed answer to the GPS pinpoint probe
("Would you like to pinpoint the exact incident location using GPS?") must
never be silently discarded.

Root cause
----------
_dispatch()'s cp == "probe_place_gps" branch only had two outcomes: a real
`gps` payload (native "Get GPS Location" button tap), or everything else,
which it treated as an explicit decline/skip -- recording
slots["incident_gps"] = {"source": "skipped"} and advancing to the next
probe with zero acknowledgment. But the web fallback UI for this exact
probe (fir-draft/index.tsx, used whenever gpsAvailable is false) renders a
plain TextInputArea, not a GPS button -- so typing "yes" (or any other
answer) to the bot's "Would you like to pinpoint..." question fell into
that same "treat as skip" branch. The citizen's typed answer vanished with
no sign anything happened, and the flow visibly "did nothing" before
jumping to the next question.

Fix verified here: a free-typed, non-empty user_message for this probe (not
an explicit action == "skip", and not a real gps payload) is now stored as
a manual location note (slots["incident_gps"]["source"] == "manual_text")
and acknowledged via a new "gps_text_noted" message prepended to the next
probe's question -- so the citizen sees their answer was received. An
explicit skip (tapping "No, text description is enough" / action="skip")
or an empty answer still behaves exactly as before (silently recorded as
"skipped", since that already has its own explicit UI affordance).

Run standalone (not via pytest):
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy \
    python3 backend/tests/test_b113_gps_text_answer_ignored.py
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
    def __init__(self, session_doc):
        self._session_doc = session_doc
        self.last_set: dict = {}

    async def find_one(self, filt, projection=None):
        if projection and "relative_date_display" in projection:
            return {"relative_date_display": None, "probe_history": self._session_doc.get("probe_history", [])}
        return dict(self._session_doc)

    async def update_one(self, filt, update):
        s = update.get("$set")
        if s:
            self.last_set.update(s)
            if "slots" in s:
                self._session_doc["slots"] = s["slots"]
        return None


class _FakeDb:
    def __init__(self, session_doc):
        self.fir_sessions = _FakeCollection(session_doc)


def _base_session(**extra) -> dict:
    doc = {
        "session_id": "sess-b113-test",
        "stage": fir_engine.STAGE_PROBE,
        "status": "active",
        "language": "en",
        "slots": {},
        "pending_probes": ["probe_theft_items"],
        "current_probe": "probe_place_gps",
        "incident_types": ["theft"],
        "suggested_sections": [],
        "evidence_files": [],
        "probe_history": [],
    }
    doc.update(extra)
    return doc


async def run():
    async def fake_generate_draft(*a, **kw):
        return "unused"
    fir_engine.generate_draft = fake_generate_draft

    # ── 1. The actual bug: typing "yes" must not be silently treated as a
    #       skip -- it must be stored and acknowledged. ──────────────────
    db = _FakeDb(_base_session())
    result = await fir_engine._dispatch(
        db, None, db.fir_sessions._session_doc, fir_engine.STAGE_PROBE,
        {}, ["probe_theft_items"], "probe_place_gps", ["theft"],
        "yes", None, None, "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "typed 'yes' is NOT recorded as skipped",
        db.fir_sessions.last_set.get("slots", {}).get("incident_gps", {}).get("source") != "skipped",
        detail=str(db.fir_sessions.last_set.get("slots")),
    )
    _check(
        "typed 'yes' is recorded as a manual_text note",
        db.fir_sessions.last_set.get("slots", {}).get("incident_gps", {}).get("source") == "manual_text",
        detail=str(db.fir_sessions.last_set.get("slots")),
    )
    _check(
        "the bot acknowledges the typed answer instead of silently moving on",
        "noted" in str(result.get("bot_message", "")).lower() and "yes" in str(result.get("bot_message", "")),
        detail=str(result.get("bot_message")),
    )
    _check(
        "the flow still advances to the next probe (doesn't get stuck)",
        result.get("probe_key") == "probe_theft_items",
        detail=str(result.get("probe_key")),
    )

    # ── 2. A real location description typed in must also be stored + acked ──
    db2 = _FakeDb(_base_session())
    result2 = await fir_engine._dispatch(
        db2, None, db2.fir_sessions._session_doc, fir_engine.STAGE_PROBE,
        {}, ["probe_theft_items"], "probe_place_gps", ["theft"],
        "Near the bus stand on MG Road", None, None, "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "a real typed place description is stored as incident_gps_address",
        db2.fir_sessions.last_set.get("slots", {}).get("incident_gps_address") == "Near the bus stand on MG Road",
        detail=str(db2.fir_sessions.last_set.get("slots")),
    )

    # ── 3. Regression guard: an explicit skip still behaves exactly as before ──
    db3 = _FakeDb(_base_session())
    result3 = await fir_engine._dispatch(
        db3, None, db3.fir_sessions._session_doc, fir_engine.STAGE_PROBE,
        {}, ["probe_theft_items"], "probe_place_gps", ["theft"],
        None, None, "skip", "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "an explicit skip is still recorded as skipped (unchanged)",
        db3.fir_sessions.last_set.get("slots", {}).get("incident_gps", {}).get("source") == "skipped",
        detail=str(db3.fir_sessions.last_set.get("slots")),
    )
    _check(
        "an explicit skip's next message has no stray acknowledgment text",
        "noted that as your location" not in str(result3.get("bot_message", "")),
        detail=str(result3.get("bot_message")),
    )

    # ── 4. Regression guard: a real gps payload still takes the GPS-found path ──
    db4 = _FakeDb(_base_session())
    async def fake_reverse_geocode(lat, lng):
        return "Hyderabad, Telangana"
    fir_engine.reverse_geocode = fake_reverse_geocode
    result4 = await fir_engine._dispatch(
        db4, None, db4.fir_sessions._session_doc, fir_engine.STAGE_PROBE,
        {}, ["probe_theft_items"], "probe_place_gps", ["theft"],
        None, {"lat": 17.38, "lng": 78.48}, None, "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "a real gps payload still goes through the GPS-found/confirm flow (unchanged)",
        result4.get("stage") == fir_engine.STAGE_GPS_CONFIRM and "Hyderabad" in str(result4.get("bot_message", "")),
        detail=str(result4),
    )

    # ── 5. Regression guard: empty/whitespace-only text behaves like a skip ──
    db5 = _FakeDb(_base_session())
    result5 = await fir_engine._dispatch(
        db5, None, db5.fir_sessions._session_doc, fir_engine.STAGE_PROBE,
        {}, ["probe_theft_items"], "probe_place_gps", ["theft"],
        "   ", None, None, "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "whitespace-only text is treated as a skip, not stored as a bogus location",
        db5.fir_sessions.last_set.get("slots", {}).get("incident_gps", {}).get("source") == "skipped",
        detail=str(db5.fir_sessions.last_set.get("slots")),
    )


if __name__ == "__main__":
    asyncio.run(run())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
