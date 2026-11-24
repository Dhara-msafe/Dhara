// DEL-LOCAL-01 (24 Nov 2026): deleting an account removes its on-phone copies
// in every feature (D-09), except the Evidence Locker (needs a decision).
// Each key here must match how the owning file names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');
const acct = read('src/accountStorage.ts');

// [key in accountStorage, owning file, how the owning file builds it]
const KEYS = [
  ['`ws_safety_plan_${uid}`', 'src/women/api.ts', /const PLAN_KEY\s*= 'ws_safety_plan'/],
  ['`ws_trusted_circle_${uid}`', 'src/women/api.ts', /const CIRCLE_KEY\s*= 'ws_trusted_circle'/],
  ['`ws_checkin_enabled_${uid}`', 'src/women/api.ts', /const CHECKIN_KEY = 'ws_checkin_enabled'/],
  ['`ws_silent_alert_evidence_pref_${uid}`', 'src/women/api.ts', /const SILENT_EVIDENCE_KEY = 'ws_silent_alert_evidence_pref'/],
  ['`ws_discreet_${uid}`', 'app/women-shield.tsx', /`ws_discreet_\$\{user\.id\}`/],
  ['`ws_shake_opt_in_${uid}`', 'app/women/code-phrase.tsx', /`ws_shake_opt_in_\$\{user\?\.id \?\? 'device'\}`/],
  ['`missing_answers_${uid}`', 'src/missing/support.ts', /`missing_answers_\$\{userId\}`/],
  ['`missing_support_${uid}`', 'src/missing/support.ts', /`missing_support_\$\{userId\}`/],
  ['`dhara_myfiles_states_${uid}`', 'app/(tabs)/myfiles.tsx', /`dhara_myfiles_states_\$\{user\?\.id \|\| 'guest'\}`/],
  ['`fj_enabled_v1_${uid}`', 'src/familyJourney/store.ts', /const ENABLED_KEY = 'fj_enabled_v1'/],
  ['`fj_journey_v1_${uid}`', 'src/familyJourney/store.ts', /const JOURNEY_KEY = 'fj_journey_v1'/],
  ['`lang_onboarded_v1_${uid}`', 'src/components/LanguageOnboardModal.tsx', /`lang_onboarded_v1_\$\{uid\}`/],
  ['`gk_consent_version:${uid}`', 'src/consentStorage.ts', /CONSENT_VERSION_KEY = 'gk_consent_version'/],
  ['`gk_consent_prefs:${uid}`', 'src/consentStorage.ts', /CONSENT_PREFS_KEY = 'gk_consent_prefs'/],
  ['`ws_code_phrase_v2_${uid}`', 'src/women/codePhraseStore.ts', /const SECURE_KEY_BASE = 'ws_code_phrase_v2'/],
  ['`ws_hide_screen_v2_${uid}`', 'src/women/codePhraseStore.ts', /`ws_hide_screen_v2_\$\{uid\}`/],
];

for (const [key, file, decl] of KEYS) {
  test(`deletion removes ${key} (named in ${file})`, () => {
    assert.ok(acct.includes(key), `${key} missing from accountStorage.ts`);
    assert.match(read(file), decl, `key name changed in ${file}? update accountStorage.ts`);
  });
}

test('scoped stores use <base>_<uid> (women/api, Family Journey, code phrase)', () => {
  assert.match(read('src/women/api.ts'), /return uid \? `\$\{storeBase\}_\$\{uid\}` : null;/);
  assert.match(read('src/familyJourney/store.ts'), /return uid \? `\$\{base\}_\$\{uid\}` : null;/);
  assert.match(read('src/women/codePhraseStore.ts'), /SECURE_KEY_BASE\}_\$\{/);
  assert.match(read('src/consentStorage.ts'), /:\$\{/);
});

test('Evidence Locker is left alone (needs a decision)', () => {
  const body = acct.slice(acct.indexOf('const accountDeletionAsyncKeys'));
  assert.doesNotMatch(body, /[`']evidence_|dhara_local_recordings|dhara_evidence_/);
});

test('both deletion screens call the clean-up before signing out', () => {
  assert.match(read('app/(tabs)/settings.tsx'), /await clearAccountLocalData\(user\?\.id\);\s*await logoutAfterAccountDeletion\(\);/);
  assert.match(read('app/delete-account.tsx'), /await clearAccountLocalData\(user\.id\);/);
});
