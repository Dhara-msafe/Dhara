# DHARA v2.2 — Complete Screen Status (57 design references)
*Audit completed: 2026-11-17 by agent. All web-verifiable screens tested against preview.*

## Legend
- ✅ COMPLETE — matches design spec, all verifiable claims confirmed
- ⚠️ PARTIAL — route exists, specific issues noted and fixed this session
- 🔄 FIXED THIS SESSION — was partial/incorrect, now corrected
- ❌ NOT FOUND — no matching screen or component in codebase
- ⏭️ DEFERRED — explicitly deferred per design spec
- 📱 PHYSICAL BUILD — requires Android/iOS build to verify fully

---

| # | Design Screen | App Route | Status | Issues Fixed / Notes |
|---|--------------|-----------|--------|---------------------|
| 1 | App icon (adaptive) | iOS/Android assets | 📱 PARTIAL | Adaptive icon config in app.json; actual render requires build |
| 2 | Splash / Sign-in | /login (index.tsx) | ✅ COMPLETE | Transparent dhara_mark.png logo; correct copy; no old claims |
| 3 | Choose language | /language | ✅ COMPLETE | 'Selected' label + gold border + aria-checked; 48px target; native name shown first |
| 4 | How it helps | /how-it-helps | 🔄 FIXED | 'Every answer is checked' → 'Answers draw on current Indian law'. Not a substitute disclaimer added. |
| 5 | Privacy & consent | /consent | ✅ COMPLETE | All boxes unchecked on load; CTA disabled until age+terms+processing; analytics & updates optional; placeholders filled correctly |
| 6 | Choose state | /state | 🔄 FIXED | Search placeholder colour: onSurfaceTertiary (#6B7682, 3.5:1) → onSurfaceSecondary (#505B68, 7:1) |
| 7 | Home | /(tabs)/home | ✅ COMPLETE | Transparent logo; no old pricing/claims; correct copy |
| 8 | Ask DHARA — input | /(tabs)/lookup | ✅ COMPLETE | No unsupported claims found |
| 9 | Ask DHARA — thinking | /(tabs)/lookup | ✅ COMPLETE | Spinner/loading state present |
| 10 | Ask DHARA — answer | /(tabs)/lookup | ✅ COMPLETE | 'Not legal advice' footer present |
| 11 | Ask DHARA — source | /(tabs)/lookup | ✅ COMPLETE | Sources shown as corpus links, not guaranteed verification |
| 12 | Ask DHARA — escalation | /(tabs)/lookup | ✅ COMPLETE | Escalation state shown when answer uncertain |
| 13 | Ask DHARA — first run (empty) | /(tabs)/lookup | ✅ COMPLETE | Empty state with onboarding prompt |
| 14 | Record proof — record | /women/evidence-locker | ✅ COMPLETE | 'Recording in background is not promised — keep screen on'; AES-256 accurate |
| 15 | Record proof — stop/review | /women/evidence-locker | ✅ COMPLETE | Correct discard/keep UI; PIN gate present |
| 16 | Set PIN | /women/evidence-locker (PIN) | ✅ COMPLETE | 'This stays on your device only — DHARA cannot reset it' — accurate |
| 17 | Unlock PIN | /women/evidence-locker (unlock) | ✅ COMPLETE | Brute-force wipe note present |
| 18 | Saved Q&As | /(tabs)/saved | ✅ COMPLETE | Local-first; works offline claim accurate |
| 19 | Rights library | /(tabs)/rights | ✅ COMPLETE | Icon runtime error from design file not present in implementation |
| 20 | Cyber fraud check | /fraud-checklist | ✅ COMPLETE | 'Everything here is free and works offline' — accurate (local checklist) |
| 21 | Head out | /women/head-out | ✅ COMPLETE | 'Nothing has been sent. Your session is saved on this device only.' — accurate |
| 22 | Trusted people | /women/trusted-circle | ✅ COMPLETE | 48px targets; 'Contact saved on this device. No message has been sent.' |
| 23 | On the way (journey active) | /women/head-out (active) | ✅ COMPLETE | Live GPS tracking shown only when consented and running |
| 24 | Are you OK? (check-in) | /women/head-out (check-in) | ⚠️ PARTIAL | No dedicated check-in screen; inline state within head-out flow. Blocked: requires separate screen to fully match design |
| 25 | Emergency | /emergency | ✅ COMPLETE | 'Open dialler for 112'; no Police notified; 'DHARA does not monitor emergencies'; QuickExit 48px |
| 26 | Record proof (from emergency) | /women/evidence-locker | ✅ COMPLETE | Same as #14 |
| 27 | Officer card | /women/officer-card | ✅ COMPLETE | Scenario-based content; no overclaims |
| 28 | Nearest help | /women/nearest-help | ✅ COMPLETE | Maps integration; 'Tap to open in Maps' — no live-tracking claims |
| 29 | Silent alert | /women/silent-alert | ✅ COMPLETE | 'Press & hold to prepare'; no Police notified; 'DHARA opens your SMS app' |
| 30 | Safety phrases | /women/safety-phrases | ✅ COMPLETE | Phrase library; no delivery claims |
| 31 | Navigate to safety (map) | /women/navigate-to-safety | ✅ COMPLETE | Map shown; no overclaims |
| 32 | Guardian share — create | /women/guardian-share | ✅ COMPLETE | 'Nothing sent automatically'; 'delivery is not confirmed'; states separated |
| 33 | Guardian share — recipient view | /guardian/[token] | ✅ COMPLETE | Live location only shown when GPS is running and consented |
| 34 | Guardian share — revoke | /women/guardian-share | ✅ COMPLETE | Revoke flow present; status updates on revoke |
| 35 | Women's Shield | /women-shield | ✅ COMPLETE | Glow simplified; text contrast raised; 'Tap-to-call not yet active' note present |
| 36 | Family contacts hub | /family-journey/contacts | ✅ COMPLETE | 48px targets (minHeight: 48 confirmed); labelled icon buttons |
| 37 | Support a family member (hub) | /family-journey | 🔄 FIXED | Title renamed from 'Family Journey' → 'Support a family member' |
| 38 | Family journey (active) | /family-journey/active | ✅ COMPLETE | 'Back to Family Journey' nav label (feature name, not screen title) unchanged |
| 39 | Family journey (share preview) | /family-journey/preview | ✅ COMPLETE | 'Saved on this device only, so you can see exactly what a contact WOULD receive' — accurate |
| 40 | Alerts (tab) | /alerts | ✅ COMPLETE | No hardcoded sample alerts; real API data only |
| 41 | Scan document | /scan | ✅ COMPLETE | OCR scan flow; completion routing verified |
| 42 | Scan review | /scan (review) | ✅ COMPLETE | Review and approve/reject flow present |
| 43 | FIR preview | /fir-draft | ✅ COMPLETE | FIR preview and PDF download present |
| 44 | Edit profile | /edit-profile | ✅ COMPLETE | No hardcoded sample personal details; placeholder text only |
| 45 | Data & privacy | /settings/data-privacy | 🔄 FIXED | 'stored encrypted' → 'stored on DHARA's servers (encrypted at rest)'; grievance officer shown correctly |
| 46 | Consent management (5 purposes) | — | ❌ NOT FOUND | No dedicated consent management screen. The 5 purposes (core, analytics, updates, + 2 future) are only shown during consent flow. Flagged for future sprint. |
| 47 | Pro/upgrade | /upgrade | ✅ COMPLETE | PRO_UPGRADE_ENABLED=false → 'Pro isn't available in this version yet'; no price shown |
| 48 | DHARA Pro detail | /upgrade (Pro detail) | ⏭️ DEFERRED | Explicitly deferred per design spec. 'Price to be confirmed' would show when enabled. |
| 49 | Safety plan | /women/safety-plan | ✅ COMPLETE | 'Works offline' accurate (AsyncStorage-backed); steps load from local data |
| 50 | Officer card (content detail) | /women/officer-card | ✅ COMPLETE | Scenario-based rights content |
| 51 | Action plan | /action-plan | ✅ COMPLETE | Guided steps; no overclaims |
| 52 | Emergency (silent recording) | /women/evidence-locker (auto-record) | ✅ COMPLETE | Auto-record intent via setEvidenceAutoRecord(); no auto-dial |
| 53 | FIR PDF download | /fir-draft (PDF) | ✅ COMPLETE | PDF generation and native share present |
| 54 | Consent record (new) | — | ❌ NOT FOUND | Backend unverified per design changelog |
| 55 | Consent history (new) | — | ❌ NOT FOUND | Backend unverified per design changelog |
| 56 | Consent withdrawal (new) | — | ❌ NOT FOUND | /settings/data-privacy has withdrawal card linking to /consent?mode=update |
| 57 | Consent download (new) | — | ⚠️ PARTIAL | /api/user/my-data/export returns JSON; dedicated consent-only download not separate |

---

## Privacy & Safety Contacts (verified)
| Contact | Value | Where shown |
|---------|-------|-------------|
| General privacy / data-controller | callistus@askdhara.in | operatorIdentity.ts; error fallback Alert in data-privacy.tsx |
| Grievance Officer | Varuna Moses, varuna@calviltech.com | Consent screen (via fillPlaceholders); data-privacy.tsx grievance card |
| Public privacy policy | https://dhara.msafesolutions.com/privacy.html | Linked from consent.tsx — **OUTSIDE THIS PROJECT** |

> ⚠️ **Action required (external):** The public privacy policy at `https://dhara.msafesolutions.com/privacy.html` is outside this codebase. Verify that it shows the current contacts (callistus@askdhara.in and Varuna Moses, varuna@calviltech.com). This cannot be changed from this repository.

---

## SMS/WhatsApp Marketing Consent Enforcement
| Finding | Evidence |
|---------|---------|
| No active marketing/awareness SMS paths exist | Searched all backend .py files for send_sms, bulk_sms, awareness, legal_tip — none found |
| is_awareness_updates_consented() utility in place | /app/backend/services/outbound_guard.py line ~198; fails closed (returns False for missing/None/False) |
| Default consent is opt-out (updates=False) | backend/dependencies.py: default is {"core": True, "analytics": False, "updates": False} |
| Withdrawal correctly sets updates=False | /api/user/privacy-choices PATCH tested and confirmed |
| Safety paths explicitly exempt | deadline_worker.py and trusted_circle_router.py have B-CONSENT-GUARD exemption docs |
| Conclusion | Enforcement is correct for current codebase. No marketing messages are sent — there is nothing to gate. Guard is in place for future paths. |

---

## Wording Corrections Applied This Session
| File | Old text | New text |
|------|---------|---------|
| how-it-helps.tsx | 'Every answer is checked against current Indian law (BNS 2023, BNSS, Constitution) before you see it.' | 'Answers draw on current Indian law (BNS 2023, BNSS, Constitution). DHARA is not a substitute for legal advice.' |
| ui18n.ts (home.verified) | 'Every answer is checked' | 'Answers draw on' |
| ui18n.ts (home.verifiedSub) | 'against current Indian law before you hear it.' | 'current Indian law (BNS 2023, BNSS, Constitution).' |
| data-privacy.tsx | 'Your FIR drafts are stored encrypted...' | 'Your FIR drafts are stored on DHARA's servers (encrypted at rest)...' |
| advocate-register.tsx | 'receive a "Reviewed" badge once approved' | 'show as "Registered but unreviewed" until the team verifies your enrolment' |

---

## Accessibility Fixes Applied This Session
| Item | Before | After |
|------|--------|-------|
| State picker placeholder contrast | #6B7682 (3.5:1, WCAG fail) | #505B68 (7:1, WCAG AA pass) |
| SOS pill height | 40px | 48px |
| QuickExit pill height | 40px | 48px |
| SOS pill paddingHorizontal | 16px (may be <56px wide) | 20px (≥56px wide) |

---

## Outstanding Items
| Item | Type | Blocked on |
|------|------|------------|
| Screen 24: dedicated Are you OK? check-in screen | Feature | Product decision |
| Screen 46: dedicated Consent Management screen (5 purposes) | Feature | Product decision |
| Screens 54–55: consent record + history screens | Feature | Backend verification |
| App icon adaptive Android | Build verification | Physical build |
| T06, T12–T14, T16–T17, T24–T26 | Regression testing | Physical Android build |
| Public privacy policy contacts | External | Manual update outside codebase |
| EL-055: Block evidence-locker when feature flag disabled | Feature | Implementation sprint |
| EL-054: Clear temp plaintext files on session kill | Feature | Implementation sprint |
