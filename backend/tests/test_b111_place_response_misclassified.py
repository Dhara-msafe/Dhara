"""B-111 regression test: a real Indian address must not be misclassified as
off-topic by fir_engine's place-response validator.

Root cause
----------
_is_valid_place_response() only ever accepted a longer (>4 word) answer if
it happened to contain one of ~70 hardcoded generic descriptor words
("road", "street", "nagar", ...) or one of 15 major city names. It had no
notion of a state name, a district, a PIN code, or the comma-separated
"locality, city, state[, PIN]" shape a real Indian address overwhelmingly
takes. The exact 13 Nov Preview repro (Phase 4 tracker, B-111) was a user
answering the location probe with "Hassan Parthi, Warangal, Telangana,
506371" -- five tokens, no keyword match -- which fell through to the
function's final "no keyword match = off-topic" catch-all. The bot then
parked the answer, replied "I've noted your question and will come back to
it," and re-asked the same question; separately, the final summary's
"Where" field showed "To be confirmed..." instead of the address, since
_build_summary() gates on the same function as a "final safety net".

Fix verified here: the function now also accepts (a) any digit run (PIN
code, house number) and (b) any comma-separated multi-segment answer, both
strong independent evidence of a real address, while still rejecting the
same clear question/request/denial patterns as before.

Run standalone (not via pytest, to avoid auto-collecting the _check helper):
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy \
    python3 backend/tests/test_b111_place_response_misclassified.py
"""
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


def run():
    f = fir_engine._is_valid_place_response

    # ── 1. The actual bug: the exact reported repro must now be accepted. ──
    _check(
        "the exact B-111 repro address is accepted",
        f("Hassan Parthi, Warangal, Telangana, 506371") is True,
    )

    # ── 2. Other real addresses with no descriptor keyword and no major-city
    #       match (smaller towns, no 'road'/'nagar'/etc.) must also pass. ──
    real_addresses = [
        "Door No 4-5-12, Nizamabad, Telangana, 503001",
        "Gandhi Chowk, Warangal, 506002",
        "Plot 22, Kakinada, Andhra Pradesh",
        "H No 3-6-9, Khammam, 507001",
    ]
    for addr in real_addresses:
        _check(f"real address accepted: {addr!r}", f(addr) is True)

    # ── 3. Addresses that DO contain a keyword or are short still pass
    #       (regression guard: nothing already working got broken). ──
    _check("keyword-bearing address still accepted", f("Near the bus stand, MG Road") is True)
    _check("short answer still accepted", f("Ameerpet") is True)
    _check("very short answer still accepted (len < 3)", f("Rd") is True)

    # ── 4. Genuinely off-topic answers (questions, requests, denials) must
    #       still be rejected -- the fix must not have gutted this check. ──
    off_topic = [
        "How do I find my FIR number later?",
        "What is BNS 303?",
        "Can you tell me if this will take long?",
        "Please explain what happens next",
        "I want to know my rights first",
        "Not sure, I'll check and tell you",
    ]
    for msg in off_topic:
        _check(f"off-topic message still rejected: {msg!r}", f(msg) is False)

    # ── 5. A genuinely ambiguous long ramble -- no keyword, no digit, no
    #       comma, not matching a question pattern -- is still treated
    #       conservatively as off-topic (the function must still catch
    #       something). ──
    _check(
        "a long keyword-less single-segment ramble is still treated as ambiguous",
        f("I am extremely upset about everything that has happened lately") is False,
    )


if __name__ == "__main__":
    run()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
