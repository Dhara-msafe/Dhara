"""B-125 — court case lookup: an invalid/unresolvable CNR showed no error
message at all.

Root cause
----------
case_by_cnr()'s format check (CNR_RE) only rejects a CNR that is the wrong
*shape*. A CNR that is syntactically valid but does not resolve to any real
case got no such protection: the eCourts partner API can return 200 OK with
an all-null payload for such a CNR instead of a 404. _fetch() treats any 2xx
response as status="ok" and normalises it -- _normalise_case() always
returns a dict with every key present (None/[] for everything it didn't get,
falling back to the queried CNR itself for "cnr") -- so case_by_cnr()
returned a "successful" result with nothing meaningful in it, and the
frontend (app/lookup-results.tsx) rendered a blank-looking case card with no
errorMsg at all: exactly the reported "shows no error message" symptom.

Fix verified here: a new _is_empty_case() check re-examines an "ok" result
and, when it carries no case_status/court_name/case_type/filing_date/
next_hearing_date/district/state/petitioners/respondents at all, converts
it to status="not_found" before it reaches the frontend -- which already
renders "No matching case was found." for that status (confirmed in
server.py's case_by_cnr route and app/lookup-results.tsx's fetchCnr).

Pure unit test — _fetch is monkeypatched so this never touches the network
or the real eCourts partner API, same convention as
test_b104_court_lookup_example_cnr.py.

Run standalone (not via pytest):
    python3 backend/tests/test_b125_empty_case_shows_not_found.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import services.court_data as court_data  # noqa: E402

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


VALID_CNR = "XXHC000000002099"  # same-shape example used in the B-104 fix


def run():
    # ── 1. _is_empty_case() itself ──────────────────────────────────────────
    _check(
        "_is_empty_case: a dict with only 'cnr' filled in is empty",
        court_data._is_empty_case({"cnr": VALID_CNR, "case_status": None, "petitioners": [], "respondents": []}),
    )
    _check(
        "_is_empty_case: a dict with a real case_status is NOT empty",
        not court_data._is_empty_case({"cnr": VALID_CNR, "case_status": "PENDING"}),
    )
    _check(
        "_is_empty_case: a dict with petitioners listed is NOT empty",
        not court_data._is_empty_case({"cnr": VALID_CNR, "petitioners": ["Jane Doe"]}),
    )
    _check("_is_empty_case: a non-dict is treated as empty", court_data._is_empty_case(None))

    # ── 2. case_by_cnr() converts an "ok but empty" upstream result into
    #       "not_found", with _fetch monkeypatched so no network call happens. ──
    orig_fetch = court_data._fetch

    async def _fake_fetch_empty(*args, **kwargs):
        return court_data.CourtDataResult(
            status="ok",
            data={
                "cnr": VALID_CNR, "case_status": None, "next_hearing_date": None,
                "court_name": None, "district": None, "state": None, "case_type": None,
                "filing_date": None, "petitioners": [], "respondents": [],
            },
            error_id="fake1",
        )

    court_data._fetch = _fake_fetch_empty
    try:
        result = asyncio.run(court_data.case_by_cnr(VALID_CNR))
        _check(
            "case_by_cnr() reports not_found (not ok) for an all-null upstream 'ok' payload",
            result.status == "not_found",
            detail=str(result),
        )
        _check(
            "the not_found result carries a real, non-blank user-facing message",
            bool(result.message) and result.message.strip() != "",
            detail=repr(result.message),
        )
    finally:
        court_data._fetch = orig_fetch

    # ── 3. Regression guard: a genuinely populated result still passes
    #       through as status="ok" unchanged. ────────────────────────────────
    async def _fake_fetch_real(*args, **kwargs):
        return court_data.CourtDataResult(
            status="ok",
            data={
                "cnr": VALID_CNR, "case_status": "PENDING", "next_hearing_date": "2026-12-01",
                "court_name": "District Court", "district": "Sample", "state": "Sample State",
                "case_type": "Criminal", "filing_date": "2026-01-01",
                "petitioners": ["Jane Doe"], "respondents": ["John Roe"],
            },
            error_id="fake2",
        )

    court_data._fetch = _fake_fetch_real
    try:
        result2 = asyncio.run(court_data.case_by_cnr(VALID_CNR))
        _check(
            "case_by_cnr() still reports ok for a real, populated case",
            result2.status == "ok" and result2.data.get("case_status") == "PENDING",
            detail=str(result2),
        )
    finally:
        court_data._fetch = orig_fetch


if __name__ == "__main__":
    run()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
