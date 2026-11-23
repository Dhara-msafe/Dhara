"""B-115 — the FIR letter invented facts in its Subject line (reported:
"chain snatching" written for an incident the complainant described only as
a phone being snatched).

Root cause
----------
generate_draft()'s system message (_DRAFT_SYS) only said "Be factual. Use
exactly the information provided." -- generic enough that the LLM could
still write its own free-form Subject line (and body wording) and "round
up" a plain phone-snatching to the more stereotypical, more common FIR
phrase "chain snatching" without ever being told that doing so is a
fabrication, not a paraphrase. The non-LLM _fallback_draft() path (used only
when the LLM call fails) was already safe -- its Subject line came straight
from the complainant's own description -- but the two paths used two
different literal constructions for the same line, with no guarantee they'd
agree, and nothing stopped the LLM path from inventing its own subject.

Fix verified here:
1. A new _subject_line(desc) helper builds the Subject line deterministically
   from the complainant's own description text only (truncated, never
   reworded or relabeled), shared by both generate_draft()'s prompt and
   _fallback_draft(), so the two can never disagree and neither can invent
   a crime label the complainant never used.
2. generate_draft()'s prompt now hands the LLM that exact line and instructs
   it, in capitals, to reproduce it VERBATIM -- not compose its own.
3. _DRAFT_SYS now explicitly names the failure mode (substituting a
   different, more "typical" object/crime label than what was stated) and
   gives the exact phone/chain example from the bug report, rather than
   relying on a generic "be factual".

Pure unit / source-inspection tests -- no live LLM call, same convention as
the rest of this file's draft-generation tests.

Run standalone (not via pytest):
    python3 backend/tests/test_b115_letter_subject_no_fabrication.py
"""
import asyncio
import os
import sys

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
    # ── 1. _subject_line() builds straight from the description, verbatim,
    #       never substituting a different object/crime word. ───────────────
    s1 = fir_engine._subject_line("My phone was snatched by two men on a bike near the bus stop.")
    _check(
        "_subject_line() preserves 'phone', never invents 'chain'",
        "phone" in s1 and "chain" not in s1.lower(),
        detail=s1,
    )
    _check("_subject_line() starts with 'Complaint regarding'", s1.startswith("Complaint regarding "), detail=s1)

    # ── 2. Missing description never crashes and never invents a label. ────
    s2 = fir_engine._subject_line(None)
    _check(
        "_subject_line(None) falls back to the generic placeholder, no invented crime",
        "Details to be provided" in s2,
        detail=s2,
    )

    # ── 3. Long descriptions are truncated the same way the old inline
    #       literal did (80 chars of the actual description), not rewritten. ──
    long_desc = "A" * 200
    s3 = fir_engine._subject_line(long_desc)
    _check("_subject_line() truncates to the description's own first 80 chars", s3 == f"Complaint regarding {long_desc[:80]}", detail=s3)

    # ── 4. _fallback_draft() uses the exact same helper for its Subject
    #       line (the two code paths can no longer disagree). ───────────────
    fallback_text = fir_engine._fallback_draft(
        slots={"description": "My phone was snatched by two men on a bike near the bus stop."},
        sec_text="• none", ev_text="None attached at this stage", date_str="23 November 2026", loc="Not provided",
    )
    _check(
        "_fallback_draft()'s Subject line matches _subject_line() exactly, and never says 'chain'",
        f"Subject: {fir_engine._subject_line('My phone was snatched by two men on a bike near the bus stop.')}" in fallback_text
        and "chain" not in fallback_text.lower(),
        detail=fallback_text.splitlines()[2] if len(fallback_text.splitlines()) > 2 else fallback_text,
    )

    # ── 5. generate_draft()'s LLM prompt hands the model the deterministic
    #       subject line and tells it, explicitly, to use it verbatim. ──────
    captured_prompt = {}

    class _FakeChat:
        def __init__(self, *a, **kw):
            pass
        def with_model(self, *a, **kw):
            return self
        def with_params(self, *a, **kw):
            return self
        async def send_message(self, user_message):
            # UserMessage (emergentintegrations) stores its constructor args
            # loosely (args/kwargs) rather than as a fixed `.text` attribute.
            captured_prompt["text"] = getattr(user_message, "kwargs", {}).get("text") or (
                user_message.args[0] if getattr(user_message, "args", None) else str(user_message)
            )
            return "Subject: Complaint regarding My phone was snatched by two men on a bike near the bus stop.\n\n...rest of letter..."

    orig_LlmChat = fir_engine.LlmChat
    fir_engine.LlmChat = _FakeChat
    try:
        result = asyncio.run(fir_engine.generate_draft(
            slots={"description": "My phone was snatched by two men on a bike near the bus stop."},
            sections=[], evidence_files=[], language="en", language_name="English", llm_key="fake-key",
        ))
    finally:
        fir_engine.LlmChat = orig_LlmChat

    prompt_text = captured_prompt.get("text", "")
    _check(
        "the prompt instructs the model to use the Subject line verbatim",
        "verbatim" in prompt_text.lower() and 'Subject: Complaint regarding My phone was snatched' in prompt_text,
        detail=prompt_text,
    )
    _check(
        "the LLM's returned draft (simulated) still carries 'phone', not an invented 'chain'",
        "phone" in result.lower() and "chain" not in result.lower(),
        detail=result,
    )

    # ── 6. _DRAFT_SYS names the exact failure mode from the bug report. ─────
    _check(
        "_DRAFT_SYS explicitly forbids substituting a different crime object/label",
        "chain" in fir_engine._DRAFT_SYS.lower() and "substitute" in fir_engine._DRAFT_SYS.lower(),
        detail=fir_engine._DRAFT_SYS,
    )


if __name__ == "__main__":
    run()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
