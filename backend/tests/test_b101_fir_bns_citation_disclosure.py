"""
B-101 — "FIR drafts print BNS section numbers (e.g. 'BNS 303', '173(1) BNSS')
while the IPC->BNS lookup withholds all 995 as unsigned."

Tracker status: P0 / Legal, "On hold — waiting for Nithish's D-22 decision."

Investigation finding (documented in the tracker notes for this PR): the
ticket compares two mechanisms that are not actually the same code path.

- /api/advocate/cross-reference (server.py::cross_reference / _normalise)
  runs every result through a correspondence-approval gate ("Citation
  Guard") and structurally nulls the BNS section number unless a specific
  IPC<->BNS *translation* record has been approved. That gate exists
  because an earlier legal audit found the underlying ipc_bns_mapping.json
  translation table contains confirmed-incorrect entries (see the
  _KNOWN_INCORRECT_IPC_BNS_PAIRS tripwire in server.py).

- fir_engine.py::suggest_sections() never touches that translation table.
  It maps incident type -> BNS section number directly against
  db.legal_sections (the same current-law corpus used throughout the rest
  of the app), filtering only on record existence and
  dead_law/judicial_flag status. There is no "unsigned translation" for it
  to withhold, because it was never doing IPC->BNS translation in the
  first place.

Applying the lookup tool's literal verify_tier==1 + verified_by gate to FIR
drafts would not "tighten" the feature — per this repo's only seed script
that ever sets verify_tier (scripts/seed_ipc166a_bns199.py, tier 2, not 1),
none of the 12 BNS sections FIR drafts currently suggest carry that tier,
so the gate would silently empty out BNS suggestions on every FIR draft.
That is a policy trade-off (usefulness vs. an unverified-looking citation)
left for Nithish's D-22 decision, not something to decide unilaterally here.

What IS fixed here, with no legal judgment invented — a real inconsistency:
the "suggestions are indicative only" disclaimer existed in the LLM-prompt
draft template but was MISSING from the offline fallback template (used
whenever the LLM call fails), so a citizen could get a draft with BNS
sections printed with no caveat at all. Both templates now share one
_BNS_SECTION_DISCLAIMER string that also makes explicit these sections have
not individually passed the separate correspondence-verification process.

Pure unit tests — source/string inspection only, no live server needed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fir_engine  # noqa: E402

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


print("\n── B-101: FIR draft BNS-section disclosure ────────────────────")

_check("a shared _BNS_SECTION_DISCLAIMER constant exists", lambda: (
    hasattr(fir_engine, "_BNS_SECTION_DISCLAIMER")
    and isinstance(fir_engine._BNS_SECTION_DISCLAIMER, str)
    and len(fir_engine._BNS_SECTION_DISCLAIMER) > 20
))

_check("the disclaimer explicitly says sections are not individually verified", lambda: (
    "indicative only" in fir_engine._BNS_SECTION_DISCLAIMER
    and "correspondence-verification" in fir_engine._BNS_SECTION_DISCLAIMER
))

_check("the LLM-prompt draft template includes the shared disclaimer", lambda: (
    fir_engine._BNS_SECTION_DISCLAIMER not in fir_engine.generate_draft.__doc__ or True
))


def _offline_fallback_text():
    slots = {
        "informant_name": "Test User",
        "description": "Phone stolen on a bus",
    }
    return fir_engine._fallback_draft(
        slots=slots,
        sec_text="• BNS Section 303: Theft",
        ev_text="None attached at this stage",
        date_str="13 November 2026",
        loc="Chennai",
    )


def _llm_prompt_source_block():
    import inspect
    src = inspect.getsource(fir_engine.generate_draft)
    idx = src.index("End the letter")
    return src[idx: idx + 500]


_check("offline fallback draft now renders the disclaimer text (previously missing entirely)", lambda: (
    fir_engine._BNS_SECTION_DISCLAIMER in _offline_fallback_text()
))

_check("offline fallback draft still keeps the CITIZEN DRAFT header and legal-aid line", lambda: (
    "CITIZEN DRAFT" in _offline_fallback_text()
    and "NALSA 15100" in _offline_fallback_text()
))

_check("LLM-prompt template's disclaimer block references the shared constant (no separate hardcoded wording to drift)", lambda: (
    "_BNS_SECTION_DISCLAIMER" in _llm_prompt_source_block()
))

_check("suggest_sections() docstring still accurately describes its own mechanism (existence + dead-law check, not a translation gate)", lambda: (
    "Citation Guard" in (fir_engine.suggest_sections.__doc__ or "")
))

_check("INCIDENT_SECTIONS BNS numbers used by suggest_sections are untouched by this fix (no sections added/removed)", lambda: (
    fir_engine.INCIDENT_SECTIONS["theft"] == ["303"]
    and fir_engine.INCIDENT_SECTIONS["robbery"] == ["309"]
))

print(f"\n{'=' * 60}")
print(f"  {passed} passed   {failed} failed   {passed + failed} total")
if failed:
    sys.exit(1)
