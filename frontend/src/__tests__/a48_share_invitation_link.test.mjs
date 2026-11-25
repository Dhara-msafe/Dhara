// A48: an invitation must not depend on email. Whenever the server mints a
// link, she can send it herself.
// Run: node --experimental-strip-types --test src/__tests__/a48_share_invitation_link.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const screen = readFileSync(join(root, 'app/women/trusted-circle.tsx'), 'utf8');
const api = readFileSync(join(root, 'src/trustedCircle/api.ts'), 'utf8');
const router = readFileSync(join(root, '..', 'backend/api/trusted_circle_router.py'), 'utf8');

test('the invite reply carries a link the app can use', () => {
  assert.match(api, /invite_path\?: string \| null/);
  assert.match(api, /invite_url\?: string \| null/);
});

test('the screen falls back to its own backend address', () => {
  assert.match(screen, /res\.invite_url \|\| \(res\.invite_path \? `\$\{API_BASE\}\$\{res\.invite_path\}` : null\)/);
});

test('she is offered the link whenever one exists, email or not', () => {
  assert.match(screen, /testID="circle-invite-link"/);
  assert.match(screen, /testID="circle-invite-share"/);
  assert.match(screen, /Share\.share\(/);
});

test('the shared message says he needs no app and what it means', () => {
  const fn = screen.slice(screen.indexOf('async function shareInvitation'), screen.indexOf('async function shareInvitation') + 600);
  assert.match(fn, /safety contact/i);
  assert.match(fn, /check in/i);
  assert.match(fn, /no app needed/i);
});

test('a failed email now points her at the link instead of a dead end', () => {
  const branch = screen.slice(screen.indexOf('res.email_pending'), screen.indexOf('res.email_pending') + 260);
  assert.match(branch, /link below/);
  assert.doesNotMatch(branch, /install DHARA, or try again later/);
});

test('she can put the panel away', () => {
  assert.match(screen, /testID="circle-invite-dismiss"/);
  assert.match(screen, /setInviteLink\(null\)/);
});

test('the server mints a link for every contact without an account', () => {
  assert.match(router, /if not invitee:\n\s+invite_token, token_hash = ge\.new_token\(\)/);
  assert.match(router, /"channel":\s+"email" if email else "link"/);
});

test('the plain token is still never stored', () => {
  assert.match(router, /"invite_token_hash":\s+token_hash/);
  assert.doesNotMatch(router, /"invite_token":\s+invite_token/);
});
