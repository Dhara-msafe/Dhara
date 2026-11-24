"""B-120 regression test: state_sensitive_topic() must match whole words,
not bare substrings.

Root cause
----------
state_sensitive_topic() in corpus.py checked `keyword in normalized_question`
for every keyword in STATE_SENSITIVE_TOPICS. That is a plain substring test,
not a word-boundary one, so a short keyword meant for one subject could
collide with an ordinary, unrelated word that merely contains it as a
substring:

  - "lease" (meant for "lease" / "leave and licence" tenancies) is a
    substring of the extremely common word "please" -- so any distress
    message like "please help me, he's going to hurt me" wrongly surfaced
    an irrelevant "Rent and tenancy are decided by state law" card right
    alongside the danger response (the reported symptom).
  - "rent" is a substring of "parent" and "different" for the same reason.

Fix verified here: the keyword check now uses `\\b<keyword>\\b` (word/phrase
boundary) instead of a bare substring test, so these false matches disappear
while every genuine rent/tenancy question still matches correctly.

Run standalone (not via pytest):
    python3 backend/tests/test_b120_state_sensitive_word_boundary.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import corpus  # noqa: E402

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
    # ── 1. The exact reported symptom: a danger message containing "please"
    #       must NOT trigger the rent_tenancy card. ──────────────────────────
    r1 = corpus.state_sensitive_topic("please help, he is going to hurt me right now")
    _check(
        "'please help, he is going to hurt me right now' does not trigger a state-sensitive topic",
        r1 is None,
        detail=str(r1),
    )

    # ── 2. "rent" is a substring of "parent" / "different" -- must not fire. ──
    r2 = corpus.state_sensitive_topic("my parent hit me, what should I do")
    _check("'parent' does not falsely trigger rent_tenancy", r2 is None, detail=str(r2))

    r3 = corpus.state_sensitive_topic("he reacted in a very different way than before")
    _check("'different' does not falsely trigger rent_tenancy", r3 is None, detail=str(r3))

    # ── 3. Regression guard: genuine rent/tenancy questions must still match. ──
    r4 = corpus.state_sensitive_topic("my landlord raised the rent without notice")
    _check(
        "a genuine rent question still triggers rent_tenancy",
        r4 is not None and r4.get("topic") == "rent_tenancy",
        detail=str(r4),
    )

    r5 = corpus.state_sensitive_topic("can my house owner evict me without notice")
    _check(
        "'house owner' + 'evict' (multi-word / short keywords) still match on word boundaries",
        r5 is not None and r5.get("topic") == "rent_tenancy",
        detail=str(r5),
    )

    # ── 4. Regression guard: other state-sensitive topics still match too. ──
    r6 = corpus.state_sensitive_topic("what is the spot fine for my e challan")
    _check(
        "an unrelated state-sensitive topic (traffic_compounding) still matches",
        r6 is not None and r6.get("topic") == "traffic_compounding",
        detail=str(r6),
    )


if __name__ == "__main__":
    run()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
