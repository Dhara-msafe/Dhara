"""B-75: FIR chat wording issues.

Tracker description: redundant "phone stolen?" question, wrong skip label,
summary leaves out stolen items, counter shows 9/12 then 9/11, "Police 100"
vs "112" inconsistency.

Pure unit tests, no live server needed -- fir_engine.py's probe-queue,
summary and progress-counter logic is deterministic and importable directly.

1. Redundant question / wrong skip label — probe_stolen_phone_imei used to
   be asked unconditionally for every theft case even though the citizen
   had just listed the stolen items in probe_theft_items a turn earlier.
   Fixed: when that answer already names a phone/mobile, the dispatch loop
   (fir_engine.py's STAGE_PROBE handler for cp == "probe_theft_items")
   swaps the queued probe for probe_stolen_phone_imei_confirmed, which asks
   only for the IMEI with a skip label that no longer contradicts what was
   just said ("Don't know IMEI" instead of "No phone stolen / Don't know
   IMEI"). When no phone is mentioned, both probe_stolen_phone_imei and
   probe_sim_blocked are dropped from the queue entirely instead of being
   asked anyway. _mentions_phone() is the keyword check driving that branch.

2. Summary leaves out stolen items — _build_summary() never included
   theft_items at all. Fixed by adding a "Stolen items" line.

3. Counter shows 9/12 then 9/11 — the "Q X/Y" total was recomputed fresh
   every turn from done_count + current + len(remaining); several probes
   get conditionally dropped mid-flow (the phone/SIM probes above,
   probe_assault_mlc after "no injury", etc.), so each drop shrank the
   live total. Fixed with _progress_total(), which tracks the highest
   total ever shown for the session and never reports lower than that.

4. "Police 100" vs "112" — every other emergency reference in the app
   (quick replies, safety-flag messages, emergency screen) uses 112; only
   the FIR draft's closing disclaimer line said "Police 100". Fixed to 112
   in both the LLM-drafted template and the offline fallback template.
"""
import sys

sys.path.insert(0, "/app/backend" if __name__ != "__main__" else ".")
import asyncio
import inspect
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fir_engine  # noqa: E402


# ─── 1. Redundant phone-stolen question / wrong skip label ────────────────

@pytest.mark.parametrize("text", [
    "iPhone 14 stolen, worth 80000",
    "My mobile and wallet were taken",
    "Samsung smartphone, ₹25000",
    "someone took my CELL PHONE",
])
def test_mentions_phone_detects_common_phrasing(text):
    assert fir_engine._mentions_phone(text) is True


@pytest.mark.parametrize("text", [
    "wallet with ₹3,000 cash",
    "laptop and a gold chain",
    "bicycle, helmet, bag",
    None,
    "",
])
def test_mentions_phone_false_when_no_phone_named(text):
    assert fir_engine._mentions_phone(text) is False


def test_confirmed_variant_exists_and_does_not_reask_whether_a_phone_was_stolen():
    pdef = fir_engine.PROBE_Q["probe_stolen_phone_imei_confirmed"]
    assert pdef["slot"] == "stolen_phone_imei"
    # Must not literally re-ask "was a phone stolen" -- only ask for the IMEI.
    assert "was a phone stolen" not in pdef["message"].lower()
    assert "imei" in pdef["message"].lower()


def test_confirmed_variant_skip_label_does_not_contradict_the_earlier_answer():
    # The original probe's skip label ("No phone stolen / Don't know IMEI")
    # would contradict a citizen who just said a phone was stolen.
    original_skip = fir_engine.PROBE_Q["probe_stolen_phone_imei"]["skip_label"]
    confirmed_skip = fir_engine.PROBE_Q["probe_stolen_phone_imei_confirmed"]["skip_label"]
    assert "no phone stolen" in original_skip.lower()
    assert "no phone stolen" not in confirmed_skip.lower()
    assert "imei" in confirmed_skip.lower()


def test_dispatch_source_swaps_probe_key_when_theft_items_names_a_phone():
    # Source-level check (mirrors the frontend .mjs wiring-test convention):
    # confirms the branch exists and is wired to swap keys / drop probes.
    src = inspect.getsource(fir_engine)
    idx = src.index('elif cp == "probe_theft_items":')
    block = src[idx: idx + 1500]
    assert "_mentions_phone(user_message)" in block
    assert "probe_stolen_phone_imei_confirmed" in block
    assert "probe_stolen_phone_imei" in block and "probe_sim_blocked" in block
    assert "not in (" in block, "expected the non-phone branch to drop both probes from the queue"


def test_both_probe_variants_are_handled_when_answered():
    src = inspect.getsource(fir_engine)
    assert 'elif cp in ("probe_stolen_phone_imei", "probe_stolen_phone_imei_confirmed"):' in src


# ─── 2. Summary leaves out stolen items ────────────────────────────────────

def test_summary_includes_stolen_items_when_present():
    slots = {"incident_date": "2026-11-01", "theft_items": "iPhone 14 — ₹80,000"}
    summary = fir_engine._build_summary(slots, [], ["theft"])
    assert "iPhone 14" in summary
    assert "Stolen items" in summary


def test_summary_omits_stolen_items_line_when_marked_not_applicable():
    slots = {"incident_date": "2026-11-01", "theft_items": "N/A — no phone reported stolen"}
    summary = fir_engine._build_summary(slots, [], ["theft"])
    assert "Stolen items" not in summary


def test_summary_omits_stolen_items_line_when_never_set():
    slots = {"incident_date": "2026-11-01"}
    summary = fir_engine._build_summary(slots, [], ["theft"])
    assert "Stolen items" not in summary


# ─── 3. Counter total only grows, never shrinks ────────────────────────────

class _FakeCollection:
    def __init__(self):
        self.set_calls = []

    async def update_one(self, filt, update):
        self.set_calls.append(update.get("$set", {}))


class _FakeDB:
    def __init__(self):
        self.fir_sessions = _FakeCollection()


def test_progress_total_holds_steady_when_queue_shrinks():
    db = _FakeDB()

    async def run():
        # Turn 1: 2 done, current + 9 remaining => total 12 ("Q 3/12")
        t1 = await fir_engine._progress_total(db, "sid-1", prior_max=0, done_count=2, remaining_len=9)
        # Turn 2: a conditional probe got dropped from the queue (e.g. the
        # phone/SIM probes above after a non-phone theft answer), so the
        # naive computation would now be 3 done + current + 7 remaining = 11
        # -- the fix must still report 12, not 11.
        t2 = await fir_engine._progress_total(db, "sid-1", prior_max=t1, done_count=3, remaining_len=7)
        return t1, t2

    t1, t2 = asyncio.run(run())
    assert t1 == 12
    assert t2 == 12, "the displayed total must never drop once shown (was the 9/12-then-9/11 bug)"


def test_progress_total_still_grows_when_a_new_probe_is_genuinely_added():
    db = _FakeDB()

    async def run():
        t1 = await fir_engine._progress_total(db, "sid-2", prior_max=0, done_count=1, remaining_len=3)
        # A later answer genuinely adds a new follow-up probe (e.g.
        # probe_witnesses_detail inserted after a vague witnesses answer).
        t2 = await fir_engine._progress_total(db, "sid-2", prior_max=t1, done_count=2, remaining_len=4)
        return t1, t2

    t1, t2 = asyncio.run(run())
    assert t1 == 5
    assert t2 == 7


def test_progress_total_persists_only_when_the_max_actually_increases():
    db = _FakeDB()

    async def run():
        await fir_engine._progress_total(db, "sid-3", prior_max=0, done_count=0, remaining_len=4)
        await fir_engine._progress_total(db, "sid-3", prior_max=5, done_count=0, remaining_len=2)  # would compute lower
        await fir_engine._progress_total(db, "sid-3", prior_max=5, done_count=5, remaining_len=1)  # grows to 7

    asyncio.run(run())
    assert db.fir_sessions.set_calls == [{"probe_max_total": 5}, {"probe_max_total": 7}]


def test_create_session_initializes_probe_max_total():
    src = inspect.getsource(fir_engine.create_session)
    assert '"probe_max_total": 0' in src


# ─── 4. "Police 100" vs "112" ──────────────────────────────────────────────

def test_fir_draft_templates_use_112_not_100():
    src = inspect.getsource(fir_engine)
    assert "Police 100" not in src
    assert src.count("Police 112") == 2, "expected both the LLM-drafted and fallback templates to say Police 112"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
