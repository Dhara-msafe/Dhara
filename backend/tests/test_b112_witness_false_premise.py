"""B-112 regression test: a "no witnesses" answer must never be treated as a
vague-but-affirmative one, so the bot must never ask the witnesses_detail
follow-up ("You mentioned witnesses were present...") after the user said no.

Root cause
----------
_is_vague_witness_response() in fir_engine.py had no notion of a negative
("no witnesses") answer at all. "No" (or "None", "Nobody", etc.) matched
none of _VAGUE_WITNESS's affirmative prefixes ("yes", "there were", ...),
had no digit, and had no capitalised non-common word long enough to match
the person-name regex -- so it fell through to the function's own default
("no phone number, no person name -> vague") and returned True. The caller
(_dispatch()'s cp == "probe_witnesses" branch) then inserted
probe_witnesses_detail next in the queue, whose fixed message literally
asserts a false premise: "You mentioned witnesses were present -- could you
share their names...". The reported repro was the user answering "no"
TWICE (once to probe_witnesses, and the false-premise follow-up still fired
in between) without the false premise ever going away.

Fix verified here: _is_vague_witness_response() now checks a dedicated
negative-response pattern list FIRST and returns False (not vague) for any
"no witnesses"-shaped answer, so the false-premise follow-up is never
queued in that case.

Run standalone (not via pytest, to avoid auto-collecting the _check helper):
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy \
    python3 backend/tests/test_b112_witness_false_premise.py
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


def run_unit_checks():
    f = fir_engine._is_vague_witness_response

    # ── 1. The actual bug: plain negative answers must not be "vague". ──
    no_answers = ["no", "No", "No.", "none", "None", "nobody", "Nobody",
                  "no one", "not any", "nil", "n/a", "na", "no witnesses",
                  "No, nobody saw anything", "don't think any", "didn't see any"]
    for ans in no_answers:
        _check(f"negative witness answer not treated as vague: {ans!r}", f(ans) is False)

    # ── 2. Regression guard: genuinely vague AFFIRMATIVE answers are still
    #       caught (the fix must not have gutted the original feature). ──
    vague_yes = ["yes", "yeah", "there were", "yes there were some people", "few people"]
    for ans in vague_yes:
        _check(f"vague affirmative still caught: {ans!r}", f(ans) is True)

    # ── 3. Specific affirmative answers (a name or phone number) still
    #       correctly pass as non-vague. ──
    _check("answer with a phone number is not vague", f("Ramesh, 9876543210") is False)
    _check("answer with a real name is not vague", f("Ramesh Kumar was there") is False)


async def run_integration_check():
    """End-to-end: answering probe_witnesses with 'no' must NOT queue
    probe_witnesses_detail next, i.e. the false-premise follow-up must never
    be asked."""
    async def fake_generate_draft(*a, **kw):
        return "unused"
    fir_engine.generate_draft = fake_generate_draft

    db = _FakeDb()
    session = {
        "session_id": "sess-b112-test",
        "stage": fir_engine.STAGE_PROBE,
        "status": "active",
        "suggested_sections": [],
        "evidence_files": [],
        "slots": {"informant_name": "Test User", "description": "A phone was stolen"},
        "probe_history": [],
        "pending_probes": ["probe_date"],
    }
    result = await fir_engine._dispatch(
        db, None, session, "probe_witnesses",
        session["slots"], ["probe_date"], None, ["theft"],
        "no", None, "no", "dummy-key", "en", "English", "2026-11-14T00:00:00Z",
    )
    bot_message = str(result.get("bot_message", ""))
    _check(
        "answering 'no' to probe_witnesses never surfaces the false-premise follow-up message",
        "mentioned witnesses were present" not in bot_message.lower(),
        detail=bot_message,
    )
    _check(
        "the next probe is NOT probe_witnesses_detail after a 'no' answer",
        result.get("probe_key") != "probe_witnesses_detail",
        detail=str(result.get("probe_key")),
    )


async def run():
    run_unit_checks()
    await run_integration_check()


if __name__ == "__main__":
    asyncio.run(run())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
