# Dialler re-enable (reverse of SAFE-SOS-001) — Playwright snippet for the browser_automation tool (iteration 82).
# Paste the body into browser_automation with page_url=<EXPO_PUBLIC_BACKEND_URL>/language, viewport 375x667.
# Seeds auth the same way as /app/tests/family_journey_ui_test.py, plus:
#   ws_panic_lesson_seen='1'                       (skip the first-visit panic lesson on /women-shield)
#   ws_trusted_circle_<uid> = [fake TEST_ contact]  (local-only, this browser context)
#   dhara_visitor_session = {...}                   (visitor screens spin forever without it)
# Web detection: react-native-web Linking.openURL sends tel: via window.location (NOT capturable),
# and every other scheme (sms:, https:) via window.open (stubbed below and recorded).
# The "Simulated — nothing sent" notice uses window.alert (stubbed and recorded).

BASE = "https://dhara-shield-2.preview.emergentagent.com"  # = frontend/.env EXPO_PUBLIC_BACKEND_URL

INIT_JS = """
window.__opened = []; window.__alerts = [];
window.open = function(u){ window.__opened.push(String(u)); return null; };
window.alert = function(m){ window.__alerts.push(String(m)); };
"""

SEED_JS = """async (B) => {
  const r = await fetch(B + '/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email:'voicetest2026@example.com', password:'TestPass123!'})});
  const d = await r.json(); const uid = d.user.id;
  localStorage.setItem('gk_token', d.token); localStorage.setItem('gk_user', JSON.stringify(d.user));
  localStorage.setItem('gk_consent_prefs', JSON.stringify({core:true,analytics:false,updates:false}));
  localStorage.setItem('gk_consent_version','2026-10-01');
  localStorage.setItem('gk_lang', JSON.stringify({code:'en',name:'English',native:'English',tts:'en-IN'}));
  localStorage.setItem('lang_onboarded_v1_'+uid,'1');
  localStorage.setItem('ws_panic_lesson_seen','1');
  localStorage.setItem('ws_trusted_circle_'+uid, JSON.stringify([{id:'TEST_c1',name:'TEST_Contact',phone:'+910000000001',notify:true}]));
  localStorage.setItem('dhara_visitor_session', JSON.stringify({touristLang:{code:'en',label:'English',native:'English'},
    indianState:'MH',indianStateName:'Maharashtra',createdAt:new Date().toISOString()}));
  return uid;
}"""

# Flow covered in iteration 82 (results):
# /me sos-button -> sos-dial-{112,100,181,1098,15100,108} (no 1091 in list), tap -> no alert            PASS
# /women-shield hl-{112,181,14490,1930,1098,15100,14416} + ws-tool-school-outline 'Call'               PASS
# /emergency call-112 'Tap to call' -> status "Continue in your phone's dialler..."                    PASS
# / (chat) send "help me" -> sos-emergency-banner sos-call-{112,1091,100} tap -> no alert               PASS
# /action-plan?scenario=violence_at_home safety-gate-danger -> safety-call-112/1091; unsure -> 181      PASS
# /fraud-checklist fraud-action-call1930, /missing missing-call-{112,1098}, /missing/result chips       PASS
# /women/nearest-help nearest-call-112, /women/officer-card officer-call-{181,14490}                    PASS
# /visitor/emergency 'Call 112 now'                                                                    PASS
# /visitor/intent 'Call 112 — Emergency' is at y~808 with no ScrollView -> unreachable at 375x667      FAIL (layout)
# /women/silent-alert alert-contact-TEST_c1 -> blocked alert shown BUT window.open('sms:+91...')       FAIL (CRITICAL)
