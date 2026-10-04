# Help and voice repair verification — 4 October 2026

## Scope and limitations
- Original request: Help 112, Silent alert, Record now, Officer card, Nearest help not working; also earlier redesigned-screen mic routing/TTS fallback.
- Backend, authentication, protected environment/config and `src/voice/` unchanged. Existing test account from `test_credentials.md`, no credential changes. FIR-specific gesture parity remains separate.
- Do not claim automatic/silent delivery, secure/tamper-proof evidence, live verified nearby service distances, or actual emergency dispatch. UI now discloses these limits.

## Verification
- `/app/test_reports/iteration_24.json`: focused partial run verified dialler status, Help tiles, contact validation/add; duplicate Silent Alert stack after `replace` blocked remaining checks. Tester changed report only. Fixed using `router.dismissTo('/women/silent-alert')`.
- `20261004_022855`: single Silent Alert instance after return; dummy contact added/removed; SMS URL encoded body, no delivery claim; all three external Maps queries correct; actual browser capture and save with synthetic microphone. Initial playback assertion was inconclusive after scroll; retested below.
- `20261004_023012`: real officer card, source/refusal/Silent; Home and gold Ask start hands-free capture, cancel and repeated entry; blur stops all synthetic stream tracks; All-help mic denial surfaced. No actual STT provider call.
- `20261004_023407`: both action-plan and officer card request cloud audio in Hindi, Marathi, Tamil with actual translated card text. Device voices deliberately unavailable and TTS transport intercepted using valid WAV audio to avoid provider costs. Stop and Silent exercised. Physical voice quality not assessed. Previous immediate post-load tap assertions were timing-inconclusive; settled navigation/header controls passed.
- `20261004_023504`: real browser MediaRecorder with synthetic tone input; saved with network offline; actual audio player starts; saved blob survives full document reload; confirm-delete removes it. Officer simulated 503 shows Retry; actual API restored card. 320px document has no horizontal overflow.
- `20261004_023622`: evidence microphone denial visible and stopped; location denial still permits manual alert; browser NotAllowedError exposes tap-to-play and retries prepared audio without new synthesis.
- Screenshot/log roots: `/root/.emergent/automation_output/<timestamp>/`. No real calls or SMS sent. Test dummy contact removed in verification context. Browser test storage is isolated from user data.

## Static checks
- All changed modules lint clean. `yarn tsc --noEmit` has 12 pre-existing errors in unrelated me/settings/intake/login/my-data/upgrade/analytics files; no errors in changed modules.
- Console contains existing deprecation/unsupported-web-notification warnings plus intentionally simulated 503. No new app render exception.

## Remaining manual checks
- Physical Android/iOS dialler handoff (do not place a test emergency call), SMS composition, mic permission prompt/recording, local file durability and device speech.
- Live provider STT/TTS and audible Hindi/Marathi/Tamil quality were not tested with paid calls.
- Cached rights-card translations need professional review; Marathi text contains questionable rendering of cognizable. Existing backend content not edited in this scope.
- Encrypted/sealed media packages and automatic verified-contact delivery remain backlog; current recorder is local audio, not a secured evidence package.