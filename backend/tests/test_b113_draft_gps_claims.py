"""B-113 (21 Nov retest): the generated draft claimed 'the precise GPS
coordinates of the incident location are available' when none were captured,
and invented facts ('forcibly took... before I could raise adequate alarm').

Prompt-construction test: generate_draft's LLM call is intercepted and the
PROMPT inspected — with no captured GPS the prompt must carry the explicit
'NOT captured' instruction (and never a coordinates line); with a real fix it
must carry the coordinates; and the anti-invention instruction must always be
present in both the prompt and the system message.

Run standalone:
    DB_NAME=dhara_qa_test MONGO_URL=mongodb://localhost:1 \
    EMERGENT_LLM_KEY=dummy JWT_SECRET=dummy \
    python3 backend/tests/test_b113_draft_gps_claims.py
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


def _check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


captured = {}


class _FakeChat:
    def __init__(self, api_key=None, session_id=None, system_message=None):
        captured["system"] = system_message

    def with_model(self, *a):
        return self

    def with_params(self, **kw):
        return self

    async def send_message(self, msg):
        captured["prompt"] = getattr(msg, "text", None) or str(msg)
        return "LETTER"


class _FakeUserMessage:
    def __init__(self, text):
        self.text = text


async def run():
    fir_engine.LlmChat = _FakeChat
    fir_engine.UserMessage = _FakeUserMessage

    base = {"informant_name": "A", "description": "Two men on a bike snatched my phone", "incident_place_text": "MG Road"}

    # 1. No GPS captured → explicit NOT-captured instruction, no coordinates
    await fir_engine.generate_draft({**base, "incident_gps": {"source": "unavailable_no_coords"}}, [], [], "en", "English", "k")
    p = captured["prompt"]
    _check("no-GPS prompt says coordinates were NOT captured",
           "GPS coordinates: NOT captured" in p, p[:300])
    _check("no-GPS prompt forbids mentioning GPS in the letter",
           "Do NOT mention GPS" in p)
    _check("no-GPS prompt has no captured-coordinates line",
           "(captured in-app)" not in p)

    # 2. Real GPS fix → coordinates stated
    await fir_engine.generate_draft({**base, "incident_gps": {"lat": 17.38, "lng": 78.48}}, [], [], "en", "English", "k")
    p2 = captured["prompt"]
    _check("real-GPS prompt carries the coordinates",
           "17.38, 78.48 (captured in-app)" in p2, p2[:300])

    # 3. Anti-invention rule in prompt and system message, both runs
    for label, text in (("prompt", p), ("prompt(gps)", p2), ("system", captured["system"])):
        _check(f"anti-invention instruction present in {label}",
               "NEVER" in text and "invent" in text.lower() or "did not state" in text,
               text[:200])


if __name__ == "__main__":
    asyncio.run(run())
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
