"""B-119 regression test: the date-confirmation message must show a
human-readable date, not a raw ISO string.

Root cause
----------
extract_slots_llm()'s system prompt (_make_extract_sys()) instructs the LLM
to set incident_date to `date.today().isoformat()` (e.g. "2026-11-15") when
the narrative says "today"/"yesterday". That raw ISO string was then dropped
straight into the confirmation message:

    relative_date_display = f"today, {extracted['incident_date']}"
    ...
    f"I calculated the incident happened on **{relative_date_display}**.\nIs that correct?"

so the person was asked to confirm "today, 2026-11-15" instead of a plain
"today, 15 November 2026" -- unlike every other date-facing message in this
file (_has_date_conflict()'s today_fmt/parsed_fmt lines), which already
reformat with strftime("%d %B %Y").

Fix verified here: a new _fmt_date_human() helper reformats the raw date
before it goes into relative_date_display, so the confirmation message
always reads a plain-language date.

Run standalone (not via pytest):
    python3 backend/tests/test_b119_date_confirm_human_readable.py
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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


def run():
    today = date.today()
    today_iso = today.isoformat()
    today_human = today.strftime("%d %B %Y")

    # ── 1. _fmt_date_human() turns an ISO date into a human-readable one. ──
    r1 = fir_engine._fmt_date_human(today_iso)
    _check(
        f"_fmt_date_human('{today_iso}') == '{today_human}'",
        r1 == today_human,
        detail=str(r1),
    )

    # ── 2. Other accepted input formats still work. ─────────────────────────
    r2 = fir_engine._fmt_date_human("15-11-2026")
    _check("_fmt_date_human handles DD-MM-YYYY", r2 == "15 November 2026", detail=str(r2))

    r3 = fir_engine._fmt_date_human("15/11/2026")
    _check("_fmt_date_human handles DD/MM/YYYY", r3 == "15 November 2026", detail=str(r3))

    # ── 3. An unparseable string is returned unchanged, not blanked. ────────
    r4 = fir_engine._fmt_date_human("not a date")
    _check("_fmt_date_human leaves an unparseable string unchanged", r4 == "not a date", detail=str(r4))

    # ── 4. None passes through unchanged. ───────────────────────────────────
    r5 = fir_engine._fmt_date_human(None)
    _check("_fmt_date_human(None) is None", r5 is None, detail=str(r5))

    # ── 5. The exact reported symptom: relative_date_display must never
    #       contain a raw ISO (YYYY-MM-DD) date once _fmt_date_human is
    #       applied, the way the live code now does it. ─────────────────────
    simulated_display = f"today, {fir_engine._fmt_date_human(today_iso)}"
    _check(
        "the 'today, ...' confirm string contains no raw ISO date",
        today_iso not in simulated_display,
        detail=simulated_display,
    )
    _check(
        "the 'today, ...' confirm string contains the human-readable date instead",
        today_human in simulated_display,
        detail=simulated_display,
    )


if __name__ == "__main__":
    run()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
