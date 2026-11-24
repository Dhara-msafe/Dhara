// B-76 (24 Nov 2026): sign-out (and account deletion, which calls logout)
// removes device-wide keys that describe the person who just used the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');
const auth = read('src/auth.tsx');
const logout = auth.slice(auth.indexOf('const logout = async () => {'), auth.indexOf('const forceLogout'));

for (const [key, file, decl] of [
  ['ws_privacy_audit_v1', 'src/women/privacyAuditLog.ts', /const AUDIT_KEY\s*= 'ws_privacy_audit_v1'/],
  ['dhara_visitor_session', 'src/visitor/session.ts', /const KEY = 'dhara_visitor_session'/],
  ['dhara_visitor_embassy_key', 'app/visitor/lost-passport.tsx', /const EMBASSY_KEY_STORAGE = 'dhara_visitor_embassy_key'/],
]) {
  test(`sign-out removes ${key} (same name as in ${file})`, () => {
    assert.match(read(file), decl, `key renamed in ${file}? update logout too`);
    assert.ok(logout.includes(`'${key}'`), `${key} not removed in logout()`);
  });
}

test('account deletion goes through the same logout', () => {
  assert.match(auth, /const logoutAfterAccountDeletion = useCallback\(async \(\) => \{[\s\S]{0,200}await logout\(\);/);
});
