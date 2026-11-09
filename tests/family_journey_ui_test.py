# Family Journey (Phase 1 preview) — Playwright snippet for the browser_automation tool (iteration 78).
# Paste the body into browser_automation with page_url=<EXPO_BACKEND_URL>/language.
# Fast auth: login via fetch then seed localStorage (gk_token, gk_user, gk_consent_*, gk_lang, lang_onboarded_v1_<uid>).
# Journey record lives in localStorage key fj_journey_v1_<uid>; master switch in fj_enabled_v1_<uid> ('0' = off).
# Use ':visible' locators — hub/new/contacts stay mounted behind /active (stack).
# Iteration 79: global Help FAB is hidden on /family-journey/* (switches clickable with real mouse clicks).

BASE = "https://dhara-shield-2.preview.emergentagent.com"  # = frontend/.env EXPO_PUBLIC_BACKEND_URL

SEED_AUTH_JS = """async (B) => {
  const r = await fetch(B + '/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email:'voicetest2026@example.com', password:'TestPass123!'})});
  const d = await r.json(); const uid = d.user.id;
  localStorage.setItem('gk_token', d.token); localStorage.setItem('gk_user', JSON.stringify(d.user));
  localStorage.setItem('gk_consent_prefs', JSON.stringify({core:true,analytics:false,updates:false}));
  localStorage.setItem('gk_consent_version','2026-10-01');
  localStorage.setItem('gk_lang', JSON.stringify({code:'en',name:'English',native:'English',tts:'en-IN'}));
  localStorage.setItem('lang_onboarded_v1_'+uid,'1');
  return uid;
}"""

# Flow covered (all passed in iteration 78):
# /family-journey (fj-master-toggle, fj-phase-notice, fj-start-plan, fj-help-row, sos-pill)
# /family-journey/new (fj-new-error on empty, fj-destination/depart/arrive/return, fj-checkin-*)
# /family-journey/contacts (fj-pick-*, fj-mode-{arrival|missedCheckin|helpRequest}-*, fj-mode-confirm, fj-confirm-yes/cancel)
# /family-journey/preview (exact copy + 'Preview — nothing has been sent.', fj-preview-start)
# /family-journey/active (fj-checkin-now, fj-arrived, fj-change-plan, fj-open-previews, fj-help-request,
#   fj-help-confirm, fj-message-preview, fj-stop, fj-stop-confirm)
# /settings/data-privacy (fj-privacy-toggle + existing buttons)
# Network: only GET /api/trusted-circle/accepted is issued by Family Journey.

# Iteration 79 retest checks (all via browser_automation):
# - master switch OFF in hub -> fj-back to /home: home-family-journey-card gone; tab-me: [data-testid="me-me.familyJourney"] gone
# - /settings/data-privacy fj-privacy-toggle reflects OFF; flipping ON restores card+row without reload
# - switch '0' + direct goto /family-journey/{new,contacts,preview,active} -> fj-off-screen
# - Start -> only one fj-active-screen in DOM; Stop -> dismissTo hub, DOM has no active/contacts/new/preview
# - KNOWN BUG: active -> fj-change-plan -> new -> contacts -> preview -> fj-preview-back-active lands on /contacts (router.back())

# Iteration 80 retest (all via browser_automation, 375x667):
# - home card -> hub -> new -> contacts -> preview -> fj-preview-start: DOM only hub+active; fj-back -> hub  (PASS)
# - active -> fj-change-plan -> fj-new-continue -> fj-contacts-continue -> fj-preview-back-active -> /active; fj-back -> hub (PASS)
# - Stop: tap fj-stop then the sheet button fj-confirm-yes (fj-stop-confirm is the sheet container) -> hub, stack cleared (PASS)
# - Me row EN 'Family Journey / Preview', HI 'फैमिली जर्नी / प्रीव्यू' (PASS)
# - EDGE (LOW): deep-link /family-journey/new -> ... -> Start: dismissTo('/family-journey') pushes hub ON TOP of new/contacts
#   (hub not in stack), so Back x2 from hub reopens 'Choose contacts' then 'Change the plan'.
