"""B-110 regression test: a FIR session wedged at stage="draft" must self-heal
instead of returning "Unknown stage: draft" forever.

Root cause
----------
backend/fir_engine.py's STAGE_READ_BACK handler does, in order:
  1. db.fir_sessions.update_one(..., {"$set": {"stage": STAGE_DRAFT, ...}})
  2. draft_text = await generate_draft(...)   # a slow network/LLM call
  3. db.fir_sessions.update_one(..., {"$set": {"stage": STAGE_COMPLETED, ...}})

generate_draft() itself always returns (its own try/except falls back to a
deterministic template on any LLM error) -- but the *request* carrying out
steps 1-3 can still be cut off mid-await between step 1 and step 3 (a slow
LLM call colliding with the host's own sleep/restart behaviour -- the
B-80/B-105/B-107 family). That leaves the session permanently parked at
stage="draft" in the DB: before this fix, _dispatch() had no `elif stage ==
STAGE_DRAFT` branch at all, so every later message -- including the user
typing "resume", "draft", or "next" trying to recover -- fell through every
branch and hit the final catch-all `return {"error": f"Unknown stage: {stage}"}`,
exactly the "session stuck paused ... typed [resume]/draft/next did not
recover" symptom reported against the real build (Phase 4 tracker, B-110).

Fix verified here: _dispatch() now has an explicit STAGE_DRAFT branch that
retries generate_draft() with the slots/sections already stored on the
session and completes normally, instead of erroring out.

Run standalone (not via pytest, to avoid auto-collecting the _check helper):
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy \
    python3 backend/tests/test_b110_fir_draft_stage_self_heal.py
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
    """Minimal async stand-in for db.fir_sessions -- records every update_one
    call so tests can assert what was written, without a real Mongo instance."""

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


def _base_session(stage: str) -> dict:
    return {
        "session_id": "sess-b110-test",
        "stage": stage,
        "status": "active",
        "suggested_sections": [
            {"section_number": "303", "section_heading": "Theft"},
        ],
        "evidence_files": [],
        "slots": {"informant_name": "Test User", "description": "A bag was stolen"},
        "probe_history": [],
    }


async def run():
    # ── 1. The actual bug: a session wedged at stage="draft" must NOT hit
    #       the "Unknown stage" catch-all, and must produce a real draft. ──
    async def fake_generate_draft(slots, sections, evidence_files, language, language_name, llm_key):
        return "FAKE DRAFT TEXT — generated on retry"

    orig_generate_draft = fir_engine.generate_draft
    fir_engine.generate_draft = fake_generate_draft
    try:
        db = _FakeDb()
        session = _base_session(fir_engine.STAGE_DRAFT)
        result = await fir_engine._dispatch(
            db, None, session, fir_engine.STAGE_DRAFT,
            session["slots"], [], None, ["theft"],
            "resume", None, "resume", "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
        )
        _check(
            "a session parked at stage=draft no longer returns 'Unknown stage'",
            "error" not in result,
            detail=str(result.get("error")),
        )
        _check(
            "it instead completes, with the generated draft text",
            result.get("completed") is True and result.get("draft") == "FAKE DRAFT TEXT — generated on retry",
            detail=str(result),
        )
        _check(
            "the resulting stage is STAGE_COMPLETED",
            result.get("stage") == fir_engine.STAGE_COMPLETED,
            detail=str(result.get("stage")),
        )
        # The session must actually be persisted back to completed in the DB,
        # not just in the returned dict (so a second "resume" tap is idempotent).
        last_filt, last_update = db.fir_sessions.updates[-1]
        _check(
            "the DB write sets stage=completed and status=completed",
            last_update["$set"].get("stage") == fir_engine.STAGE_COMPLETED
            and last_update["$set"].get("status") == "completed",
            detail=str(last_update),
        )

        # Different recovery messages ("draft", "next", empty) must all work
        # the same way -- the fix doesn't key off the specific wording typed.
        for retry_message in ["draft", "next", ""]:
            db2 = _FakeDb()
            session2 = _base_session(fir_engine.STAGE_DRAFT)
            result2 = await fir_engine._dispatch(
                db2, None, session2, fir_engine.STAGE_DRAFT,
                session2["slots"], [], None, ["theft"],
                retry_message, None, None, "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
            )
            _check(
                f"recovers the same way regardless of the retry message ({retry_message!r})",
                "error" not in result2 and result2.get("completed") is True,
                detail=str(result2),
            )
    finally:
        fir_engine.generate_draft = orig_generate_draft

    # ── 2. Regression guard: the normal STAGE_READ_BACK -> generate flow is
    #       untouched by this fix (still goes draft -> completed in one hop
    #       when nothing interrupts it). ──
    async def fake_generate_draft_2(slots, sections, evidence_files, language, language_name, llm_key):
        return "NORMAL FLOW DRAFT TEXT"

    fir_engine.generate_draft = fake_generate_draft_2
    try:
        db = _FakeDb()
        session = _base_session(fir_engine.STAGE_READ_BACK)
        result = await fir_engine._dispatch(
            db, None, session, fir_engine.STAGE_READ_BACK,
            session["slots"], [], None, ["theft"],
            "Yes, generate my draft", None, "confirm", "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
        )
        _check(
            "normal read-back -> generate flow still completes in one hop",
            result.get("completed") is True and result.get("draft") == "NORMAL FLOW DRAFT TEXT",
            detail=str(result),
        )
    finally:
        fir_engine.generate_draft = orig_generate_draft

    # ── 3. Every other stage still falls through to the error for a truly
    #       unknown/garbage stage string -- the fix is scoped to STAGE_DRAFT
    #       only, not a blanket catch-all. ──
    db = _FakeDb()
    session = _base_session("some-garbage-stage-name")
    result = await fir_engine._dispatch(
        db, None, session, "some-garbage-stage-name",
        session["slots"], [], None, ["theft"],
        "resume", None, "resume", "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    _check(
        "a genuinely unknown stage still reports an error (fix isn't a blanket catch-all)",
        result.get("error") == "Unknown stage: some-garbage-stage-name",
        detail=str(result),
    )


if __name__ == "__main__":
    asyncio.run(run())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
