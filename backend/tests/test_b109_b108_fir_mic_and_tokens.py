"""B-109 / B-108 regression tests.

B-109 -- FIR mic button missing on most free-text draft questions
------------------------------------------------------------------
PROBE_Q in fir_engine.py gates the mic button entirely: the frontend
(fir-draft/index.tsx) only renders the mic when a probe's input_type is
"voice_or_text" ('text' shows a keyboard-only composer). ~15 genuinely
open-ended, descriptive questions (what was stolen, do you have an MLC,
how much was lost, who did this, any additional location details, how long
has this been happening, your employer/workplace, your role, what company
was involved, ...) were set to the plain "text" input type for no reason
tied to their content, so citizens answering those questions -- often while
still shaken from the incident -- had no mic option and had to type.

Fix verified here: those questions are now "voice_or_text". The ones that
must stay typing-only are preserved exactly as before: a phone number, an
IMEI, a transaction ID, an order ID and "scammer contact details" are all
short machine-readable codes/numbers where voice transcription produces
more errors than it prevents, so they are deliberately excluded from this
fix and tested here as a regression guard, not touched.

B-108 -- internal action tokens ("[continue_safe]", "[not_safe]",
"[resume]", "[skip]") render as visible chat bubbles
------------------------------------------------------------------
process_turn() logged every turn's user side as f"[{action}]" whenever no
free-text user_message was given. In the live chat screen this was
invisible (continue_safe/not_safes/resume never render a bubble at all;
skip renders the probe's own friendly skip_label, never the raw action
name) -- but resumeSession() in fir-draft/index.tsx replays a session's
whole narrative_turns array verbatim as chat bubbles, so reopening an
in-progress complaint surfaced these raw internal tokens as if the citizen
had typed them.

Fix verified here: 'continue_safe' / 'not_safe' / 'resume' are no longer
logged as a narrative turn at all (matching the fact that they never
produced a visible bubble live), and 'skip' is logged using the current
probe's own skip_label (matching exactly what the live UI already shows),
never the raw "[action]" token.

Run standalone (not via pytest):
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy \
    python3 backend/tests/test_b109_b108_fir_mic_and_tokens.py
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


# ─── B-109: PROBE_Q input types ─────────────────────────────────────────────
def run_b109_checks():
    PQ = fir_engine.PROBE_Q

    should_be_voice = [
        "probe_theft_items", "probe_assault_mlc", "probe_cyber_amount",
        "probe_accused", "probe_incident_place_detail", "probe_dv_duration",
        "probe_posh_employer", "probe_posh_role", "probe_consumer_company",
    ]
    for key in should_be_voice:
        _check(
            f"{key} now offers the mic (input_type == voice_or_text)",
            PQ[key]["input_type"] == fir_engine.INPUT_VOICE_TEXT,
            detail=PQ[key]["input_type"],
        )

    # Regression guard: short machine-readable codes/numbers stay typing-only.
    should_stay_text = [
        "probe_informant_phone", "probe_informant_phone_retry",
        "probe_stolen_phone_imei", "probe_transaction_ids",
        "probe_scammer_contact", "probe_consumer_order_id",
    ]
    for key in should_stay_text:
        _check(
            f"{key} is still typing-only (input_type == text), unaffected by the fix",
            PQ[key]["input_type"] == fir_engine.INPUT_TEXT,
            detail=PQ[key]["input_type"],
        )

    # Regression guard: quick-reply / GPS / evidence probes are untouched.
    _check("probe_injury untouched (quick_reply)", PQ["probe_injury"]["input_type"] == fir_engine.INPUT_QUICK_REPLY)
    _check("probe_place_gps untouched (gps)", PQ["probe_place_gps"]["input_type"] == fir_engine.INPUT_GPS)
    _check("probe_evidence untouched (evidence)", PQ["probe_evidence"]["input_type"] == fir_engine.INPUT_EVIDENCE)
    _check("probe_date untouched (already voice_or_text)", PQ["probe_date"]["input_type"] == fir_engine.INPUT_VOICE_TEXT)


# ─── B-108: narrative-turn logging ──────────────────────────────────────────
class _FakeCollection:
    def __init__(self, session_doc):
        self._session_doc = session_doc
        self.pushed_user_messages: list[str] = []

    async def find_one(self, filt, projection=None):
        if "relative_date_display" in (projection or {}):
            return {"relative_date_display": None}
        return dict(self._session_doc)

    async def update_one(self, filt, update):
        push = update.get("$push")
        if push and "narrative_turns" in push:
            entry = push["narrative_turns"]
            if entry.get("role") == "user":
                self.pushed_user_messages.append(entry["message"])
        return None


class _FakeDb:
    def __init__(self, session_doc):
        self.fir_sessions = _FakeCollection(session_doc)


def _base_session(stage: str, **extra) -> dict:
    doc = {
        "session_id": "sess-b108-test",
        "stage": stage,
        "status": "active",
        "language": "en",
        "slots": {},
        "pending_probes": [],
        "current_probe": None,
        "incident_types": ["theft"],
        "suggested_sections": [],
        "evidence_files": [],
        "probe_history": [],
    }
    doc.update(extra)
    return doc


async def run_b108_checks():
    async def fake_generate_draft(*a, **kw):
        return "unused"
    fir_engine.generate_draft = fake_generate_draft

    # 1. 'continue_safe' (emergency-overlay "Continue" tap from safety_gate
    #    via free_narrative) must never be logged as a narrative turn.
    db = _FakeDb(_base_session(fir_engine.STAGE_FREE_NARRATIVE))
    await fir_engine.process_turn(db, None, "sess-b108-test", None, None, "continue_safe", "k")
    _check(
        "'continue_safe' logs no narrative turn at all",
        db.fir_sessions.pushed_user_messages == [],
        detail=str(db.fir_sessions.pushed_user_messages),
    )

    # 2. 'not_safe' (safety_gate "No, I need help" tap) must never be logged.
    db = _FakeDb(_base_session(fir_engine.STAGE_SAFETY_GATE))
    await fir_engine.process_turn(db, None, "sess-b108-test", None, None, "not_safe", "k")
    _check(
        "'not_safe' logs no narrative turn at all",
        db.fir_sessions.pushed_user_messages == [],
        detail=str(db.fir_sessions.pushed_user_messages),
    )

    # 3. 'resume' (silent re-ask on app reopen, mid-probe) must never be logged.
    db = _FakeDb(_base_session(fir_engine.STAGE_PROBE, current_probe="probe_witnesses"))
    await fir_engine.process_turn(db, None, "sess-b108-test", None, None, "resume", "k")
    _check(
        "'resume' logs no narrative turn at all",
        db.fir_sessions.pushed_user_messages == [],
        detail=str(db.fir_sessions.pushed_user_messages),
    )

    # 4. 'skip' logs the current probe's own friendly skip_label, matching
    #    exactly what the live UI shows -- never the raw "[skip]" token.
    db = _FakeDb(_base_session(fir_engine.STAGE_PROBE, current_probe="probe_witnesses"))
    await fir_engine.process_turn(db, None, "sess-b108-test", None, None, "skip", "k")
    _check(
        "'skip' logs the probe's skip_label, not a raw token",
        db.fir_sessions.pushed_user_messages == ["No witnesses"],
        detail=str(db.fir_sessions.pushed_user_messages),
    )

    # 5. No action/no user_message at all (e.g. a bare GPS-less page refresh)
    #    still logs nothing, as before -- untouched by this fix.
    db = _FakeDb(_base_session(fir_engine.STAGE_FREE_NARRATIVE))
    await fir_engine.process_turn(db, None, "sess-b108-test", "", None, None, "k")
    _check(
        "no user_message/gps/action logs nothing (unchanged)",
        db.fir_sessions.pushed_user_messages == [],
        detail=str(db.fir_sessions.pushed_user_messages),
    )

    # 6. Regression guard: a real typed message is still logged verbatim.
    db = _FakeDb(_base_session(fir_engine.STAGE_FREE_NARRATIVE))
    await fir_engine.process_turn(
        db, None, "sess-b108-test",
        "My phone was stolen near the bus stand yesterday evening around 7pm.",
        None, None, "k",
    )
    _check(
        "a real typed narrative is still logged verbatim (unchanged)",
        db.fir_sessions.pushed_user_messages == [
            "My phone was stolen near the bus stand yesterday evening around 7pm."
        ],
        detail=str(db.fir_sessions.pushed_user_messages),
    )

    # 7. Regression guard: GPS is logged as a friendly label, not raw coords
    #    (pre-existing "[GPS:{...}]" was also internal-looking, not part of
    #    B-108's named tokens, but fixed alongside it for the same reason).
    db = _FakeDb(_base_session(fir_engine.STAGE_PROBE, current_probe="probe_place_gps"))
    await fir_engine.process_turn(
        db, None, "sess-b108-test", None, {"lat": 17.38, "lng": 78.48}, None, "k",
    )
    _check(
        "GPS turn logs a friendly label, not raw coordinates",
        db.fir_sessions.pushed_user_messages == ["\U0001F4CD Shared GPS location"],
        detail=str(db.fir_sessions.pushed_user_messages),
    )


async def run():
    run_b109_checks()
    await run_b108_checks()


if __name__ == "__main__":
    asyncio.run(run())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
