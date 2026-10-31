# DHARA P1 — Legal-Release Containment: Release-Surface Inventory

**Audit date:** 2026-10-31  
**Commit:** fix/p1-step2-step3 (canonical v1 hash + structural withholding)  
**Status:** COMPLETE — all surfaces either FIXED or ALREADY GATED

---

## Surface 1 — `/api/advocate/cross-reference` (PRIMARY — was OPEN, now FIXED)

**File:** `backend/server.py` → `_normalise()` (line ~1580)  
**Risk before fix:** All substantive BNS mapping fields (`new_section`, `offence`,
`what_changed`, `source_link`, etc.) were returned in the JSON payload regardless
of the `correspondence_approval` gate result.  A boolean flag and UI banner were
in place but the server was still transmitting the data.  
**Fix applied (Step 3):**  
- `_normalise()` now builds a canonical v1 record object from the entry's
  `offence_text` and `punishment_text` fields and passes it to `_xref_check_corr()`.
- After the approval gate: when `correspondence_approval != "approved"`, all ten
  substantive fields are set to `None` before the response is serialised:
  `new_section, offence, what_changed, source_link, judicial_citation,
  review_source, reviewed_at, reviewed_by, mapping_version, new_subsection`.
- `review_status` is replaced with `"withheld_pending_approval"`.
- **Verified:** `GET /api/advocate/cross-reference?ipc=302` →  
  `new_section:null, offence:null, what_changed:null` (all 10 fields null).  
**Residual risk:** None — data does not leave the server.

---

## Surface 2 — `/api/chat/stream` context frame (`successor_act` line) (ALREADY GATED)

**File:** `backend/api/chat_router.py` lines 1043–1057  
**Status:** GATED — `_corr_ok` gate evaluated on every turn; `Successor provision:`
line only appended to the LLM context frame when
`_check_corr_approval(ipc_key, bns_key).approved` is True.  
**No action required.**

---

## Surface 3 — `/api/chat/stream` citation payload (`successor_act` field) (ALREADY GATED)

**File:** `backend/api/chat_router.py` lines 1261–1288  
**Status:** GATED — `_gated_successor_act = None` when `_cit_corr_ok` is False.
The citation dict carries `successor_act: None` for unapproved pairs —
the BNS section number never reaches the client.  
**No action required.**

---

## Surface 4 — `build_bns_identifier_hypothesis_response` (ALREADY GATED)

**File:** `backend/engine/answer_generator.py` lines 373–444  
**Status:** GATED — `correspondence_approved` boolean from
`check_section_correspondence_approval()` selects between a specific-claim body
(names the BNS section) and a hedged body (names neither BNS section nor punishment).
Unapproved → hedged body, no BNS section or punishment figure emitted.  
**No action required.**

---

## Surface 5 — `dead_with_successor` streaming filter (INTERNAL — NOT A LEAK SURFACE)

**File:** `backend/api/chat_router.py` line 899  
**Status:** This is an internal corpus hit filter that allows BNS hits to pass
through when the conversation is already about a dead IPC section with a known
successor act *family* (e.g. "Indian Penal Code" → "Bharatiya Nyaya Sanhita").
It does NOT reveal any cross-reference mapping data — it only decides whether a
BNS corpus hit is relevant context.  
**No action required.**

---

## Surface 6 — `law_status_guard.py` historical applicability check (SEPARATE GATE — NOT AFFECTED)

**File:** `backend/engine/law_status_guard.py` lines 279–315  
**Status:** Uses `check_approval("historical_applicability", ...)` — a **different**
approval record type from `"correspondence"`. The `_successor_act` added at line 308
comes from the law-status registry, not from the cross-reference mapping file, and
flows only to internal LLM context building (never directly to the user).  
**No action required.**

---

## Surface 7 — `corpus_db.py` BNS index (INTERNAL INDEX — NOT A LEAK SURFACE)

**File:** `backend/corpus_db.py` lines 303–340  
**Status:** Builds an internal `{bns_section: record}` index from `ipc_bns_mapping.json`
for `check_bns_family_identifier()`. This function returns a boolean existence flag
and a partial record to `build_bns_identifier_hypothesis_response` (Surface 4, already
gated). No raw mapping data is transmitted directly to users.  
**No action required.**

---

## Surface 8 — Frontend `ipc-bns-lookup.tsx` (DEFENSE IN DEPTH)

**File:** `frontend/app/ipc-bns-lookup.tsx`  
**Status:** PRIMARY control is the server (Surface 1). Frontend adds two layers:  
1. `NotYetApprovedBanner` shown for any non-`"approved"` / non-`"no_section"` value.  
2. `!isWithheld && !!item.offence` guard: offence text explicitly not rendered
   when `isWithheld` is true (defense in depth, Step 3 frontend fix).  
3. `what_changed` and `source_link` already guarded by null-falsy checks.  
4. `XRef` TypeScript interface updated: nullable fields (`new_section`, `offence`,
   `what_changed`, `source_link`, `judicial_citation`) now typed as `string | null`.  
**Contract invariant:** `NotYetApprovedBanner` and `non-null new_section` are
mutually exclusive — server ensures it; frontend enforces it as second layer.

---

## Surface 9 — Translation layer (NOT A RISK SURFACE)

**Files:** `backend/langpolicy.py`, `backend/dependencies.py` (translate_for_retrieval)  
**Status:** Translation functions translate user *queries* (input) for multilingual
retrieval. They do not transform or re-encode cross-reference mapping data before
returning it to users. Hindi/Tamil responses are generated by the LLM from
corpus-sourced context; the LLM context uses only the gated `successor_act` from
Surface 2/3 (already gated).  
**No action required.**

---

## Summary

| # | Surface                                    | Status            |
|---|--------------------------------------------|-------------------|
| 1 | `/api/advocate/cross-reference`            | ✅ FIXED (Step 3) |
| 2 | Chat stream — `successor_act` context line | ✅ Already gated  |
| 3 | Chat stream — citation `successor_act`     | ✅ Already gated  |
| 4 | Hypothesis response builder                | ✅ Already gated  |
| 5 | `dead_with_successor` filter               | ✅ Not a surface  |
| 6 | `law_status_guard` historical gate         | ✅ Separate gate  |
| 7 | `corpus_db` BNS index                      | ✅ Internal only  |
| 8 | Frontend `ipc-bns-lookup.tsx`              | ✅ Defense-in-depth |
| 9 | Translation layer                          | ✅ Not a surface  |

**All surfaces contained.** The only leak path was Surface 1; it is now closed.
