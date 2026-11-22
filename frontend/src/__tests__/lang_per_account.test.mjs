/**
 * Language per account (owner GO, 22 Nov).
 *
 * Bug: 'gk_lang' is one value per browser/phone, so a new account whose
 * profile says EN saw Telugu left by an older account (Me, Ask placeholder,
 * and answers). Fix:
 * - signing in to an existing account uses that account's saved profile
 *   language; a just-created account (sign-up, first Google sign-in — the
 *   backend now says is_new) gets the language used through onboarding saved
 *   to its profile; guests keep the device value
 * - changing language while signed in to an account saves it to the profile
 *   (PATCH /api/auth/language, which existed but was never called)
 * - signing out returns to the device language
 * - 97ac37d (changing language when signed in no longer restarts setup) is
 *   untouched: setLanguage never navigates; app/language.tsx keeps its
 *   isChange routing.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/lang_per_account.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const auth = read('src', 'auth.tsx');
const backend = read('..', 'backend', 'api', 'auth_router.py');

test('language list moved unchanged to src/languages.ts, with a code lookup', async () => {
  const { LANGUAGES, languageForCode } = await import(join(root, 'src', 'languages.ts'));
  assert.equal(LANGUAGES.length, 23);
  assert.equal(languageForCode('te').native, 'తెలుగు');
  assert.equal(languageForCode('en').tts, 'en-IN');
  assert.equal(languageForCode(''), null);
  assert.equal(languageForCode('xx'), null);
  assert.ok(!/const LANGUAGES: Language\[\] = \[/.test(read('app', 'language.tsx')), 'no second copy in the route file');
  assert.match(read('app', 'language.tsx'), /import \{ LANGUAGES \} from '@\/src\/languages';/);
});

test('startup: a signed-in account uses its profile language; guests the device value', () => {
  assert.match(auth, /const profileLang = hydratedUser && !hydratedUser\.is_guest \? languageForCode\(hydratedUser\.language\) : null;\s*\n\s*if \(profileLang\) setLanguageState\(profileLang\);\s*\n\s*else if \(l\) setLanguageState\(JSON\.parse\(l\)\);/);
  assert.match(auth, /const freshLang = !fresh\.is_guest \? languageForCode\(fresh\.language\) : null;/);
});

test('sign-in: existing account -> own language; new account -> save onboarding choice; guest -> untouched', () => {
  assert.match(auth, /if \(!u\.is_guest\) \{\s*\n\s*if \(opts\.isNew\) \{/);
  assert.match(auth, /const own = languageForCode\(u\.language\);\s*\n\s*if \(own\) setLanguageState\(own\);/);
  // new account reads the device (onboarding) value, not in-memory state
  assert.match(auth, /const dev = await AsyncStorage\.getItem\(LANG_KEY\); if \(dev\) code = JSON\.parse\(dev\)\.code \|\| code;/);
});

test('which sign-in paths count as new', () => {
  assert.match(auth, /const data = await r\.json\(\);\s*\n\s*await persist\(data\.token, data\.user, \{ isNew: true \}\);/); // register
  assert.equal((auth.match(/persist\(data\.token, data\.user, \{ isNew: !!data\.is_new \}\)/g) || []).length, 2, 'both Google paths (web redirect + native)');
  // email login and guest: plain persist (login -> profile wins; guest -> device)
  assert.equal((auth.match(/await persist\(data\.token, data\.user\);/g) || []).length, 2);
});

test('backend tells the app when an account was just created (additive field)', () => {
  assert.match(backend, /class AuthOut\(BaseModel\):\s*\n\s*token: str\s*\n\s*user: dict\s*\n(\s*#[^\n]*\n)*\s*is_new: bool = False/);
  assert.match(backend, /return \{"token": make_token\(uid\), "user": public_user\(doc\), "is_new": True\}/);
  assert.match(backend, /"is_new": not bool\(existing\)\}/);
  // the profile language route the app now calls
  assert.match(backend, /@router\.patch\("\/auth\/language"\)/);
});

test('changing language: account -> profile; guest/signed-out -> device; no navigation (97ac37d)', () => {
  const fn = auth.slice(auth.indexOf('const setLanguage = useCallback'), auth.indexOf('const setAutoSpeak = useCallback'));
  assert.match(fn, /if \(t && u && !u\.is_guest\) \{\s*\n\s*await saveProfileLanguage\(t, l\.code\);\s*\n\s*\} else \{\s*\n\s*await AsyncStorage\.setItem\(LANG_KEY, JSON\.stringify\(l\)\);/);
  assert.ok(!/router|navigate|replace\(/.test(fn), 'setLanguage must not navigate');
  assert.match(auth, /fetch\(`\$\{API\}\/api\/auth\/language`, \{\s*\n\s*method: 'PATCH'/);
  // 97ac37d: the language screen still routes by isChange.
  assert.match(read('app', 'language.tsx'), /if \(isChange\) \{\s*\n\s*if \(router\.canGoBack\(\)\) router\.back\(\);/);
});

test('signing out returns to the device language', () => {
  const lo = auth.slice(auth.indexOf('  const logout = async'), auth.indexOf('  const logout = async') + 4000);
  assert.match(lo, /setUser\(null\);\s*\n[\s\S]{0,200}const dev = await AsyncStorage\.getItem\(LANG_KEY\);\s*\n\s*setLanguageState\(dev \? JSON\.parse\(dev\) : DEFAULT_LANG\);/);
});
