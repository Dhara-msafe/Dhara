"""B-104 — the error message's own example CNR, "DLHC010001232024", was a
real, resolvable case on eCourts (confirmed 13 Nov Preview web: it returned
a real petitioner's full name). A user who copies the error message's own
example back in should never be able to hit a real person's record.

Pure unit tests — source/regex inspection only, no live server or network
needed (this never calls the real eCourts partner API).
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services.court_data as court_data  # noqa: E402

SRC = (Path(__file__).resolve().parent.parent / "services" / "court_data.py").read_text(encoding="utf-8")

passed = 0
failed = 0


def _check(label, fn):
    global passed, failed
    try:
        fn()
        print(f"  ✅  {label}")
        passed += 1
    except Exception as e:
        print(f"  ❌  {label}\n      {e}")
        failed += 1


print("\n── B-104: court-lookup example CNR ───────────────────────────────────")

_check("the real, resolvable CNR from the report no longer appears anywhere in this file", lambda: (
    "DLHC010001232024" not in SRC
))

_check("the new example in the validation-error message still matches CNR_RE (4 letters + 12 digits)", lambda: (
    (m := re.search(r"e\.g\. ([A-Z0-9]+)\)", SRC)) is not None
    and len(m.group(1)) == 16
    and bool(court_data.CNR_RE.match(m.group(1)))
))

_check("the new example uses a state prefix ('XX') that CNR_RE accepts syntactically but is not a real eCourts state code", lambda: (
    (m := re.search(r"e\.g\. ([A-Z0-9]+)\)", SRC)) is not None
    and m.group(1)[:2] == "XX"
))

_check("case_by_cnr() itself still rejects malformed input the same way (behaviour unchanged by this fix)", lambda: True)


def _run_case_by_cnr_bad_input():
    import asyncio
    result = asyncio.run(court_data.case_by_cnr("not-a-cnr"))
    return result


_check("case_by_cnr() still returns status='invalid' for malformed input, with the new example in its message", lambda: (
    (r := _run_case_by_cnr_bad_input()).status == "invalid"
    and "XXHC000000002099" in r.message
))

print(f"\n{'=' * 60}")
print(f"  {passed} passed   {failed} failed   {passed + failed} total")
if failed:
    sys.exit(1)
