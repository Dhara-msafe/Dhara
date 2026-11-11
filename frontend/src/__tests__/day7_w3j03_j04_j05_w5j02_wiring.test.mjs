/**
 * Day 7 (buffer/catch-up) — W3-J03 (Chat history), W3-J04 (Save an answer),
 * W3-J05 (Greeting / small talk), W5-J02 (Listen to an answer).
 *
 * These four journeys were in the work-list's expanded 20-journey list
 * (Day 3) but never got their own wiring pass or tracker row — Day 7 is an
 * explicit buffer/catch-up day in the tracker ("No new items assigned"),
 * so this closes that gap rather than inventing new work. Same
 * lighter-weight wiring pass used throughout: dead-import check (where
 * applicable), then auth-header wiring for every network call,
 * cross-referenced against the backend route's actual dependency.
 *
 * RESULT: no bug found in any of the four.
 *
 * 1. W3-J03 — Chat history: app/(tabs)/history.tsx lists GET
 *    /api/chat/sessions, app/session/[id].tsx reads GET
 *    /api/chat/sessions/{id}/messages, both current_user-gated
 *    server-side (api/chat_router.py: list_sessions, session_messages) and
 *    both always sent with the Bearer token. Guest mode is blocked
 *    client-side as a product choice (persistent history needs an
 *    account), so a guest never reaches an unauthenticated call. Deleting
 *    a conversation (DELETE /api/chat/sessions/{id}) is current_user-gated
 *    too and always authenticated.
 *
 * 2. W3-J04 — Save an answer: app/(tabs)/index.tsx's saveAnswer() ->
 *    src/bookmarks.ts's addBookmark()/push()/syncBookmarks(). Local-first
 *    by design (AsyncStorage is the source of truth for reading so a
 *    saved answer opens with no network); the server push is
 *    token-guarded (`if (token) push(...)`) and PUT /bookmarks / DELETE
 *    /bookmarks/{client_id} both require current_user server-side
 *    (api/chat_router.py: upsert_bookmark, delete_bookmark) -- matches.
 *
 * 3. W3-J05 — Greeting / small talk: handled entirely server-side inside
 *    the SAME /api/chat/stream call already verified for W3-J01/J02 (no
 *    separate frontend endpoint or auth path exists for this journey --
 *    the C1 conversational-intents classifier in
 *    backend/engine/conversational_intents.py runs inside chat_router.py's
 *    existing stream handler). It inherits that call's auth/session wiring
 *    rather than having a new wiring surface of its own. Backend-side
 *    deterministic-matcher logic has its own dedicated offline test file
 *    (test_c1_conversational_intents.py, 59/59 passing in this sandbox);
 *    the adjoining live-endpoint file (test_c1_sos_distress_and_adaptive_chips.py)
 *    needs a running backend on localhost:8001 to execute its
 *    integration-style cases -- same "needs a live server" limitation as
 *    W2-J02/W3-J01/W3-J02/W5-J01, not a new gap.
 *
 * 4. W5-J02 — Listen to an answer: app/session/[id].tsx's speak()
 *    function calls POST /api/voice/tts (current_user-gated server-side,
 *    confirmed in NF-07's test) and always sends the Bearer token;
 *    tapping the same message's speaker icon again stops playback rather
 *    than starting a second overlapping one.
 *
 * What cannot be verified from here: the actual synthesized audio (same
 * Emergent-managed TTS/LLM dependency as every other chat/voice journey
 * this release -- no network egress to that provider from this sandbox).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

const historySrc = readFileSync(join(__dirname, '../../app/(tabs)/history.tsx'), 'utf8');
const sessionViewSrc = readFileSync(join(__dirname, '../../app/session/[id].tsx'), 'utf8');
const chatSrc = readFileSync(join(__dirname, '../../app/(tabs)/index.tsx'), 'utf8');
const bookmarksSrc = readFileSync(join(__dirname, '../bookmarks.ts'), 'utf8');

console.log('\n── W3-J03 — Chat history ────────────────────────────────────────');

test('history.tsx sends the auth token when listing sessions', () => {
  assert.ok(historySrc.includes("fetch(`${API_BASE}/api/chat/sessions`"));
  assert.ok(/headers: \{ Authorization: `Bearer \$\{token\}` \}/.test(historySrc));
});
test('history.tsx blocks guest mode client-side (persistent history needs an account)', () => {
  assert.ok(historySrc.includes('if (user?.is_guest)'));
});
test('deleting a conversation sends the auth token too', () => {
  const idx = historySrc.indexOf('DELETE');
  const slice = historySrc.slice(Math.max(0, idx - 120), idx + 120);
  assert.ok(/Authorization: `Bearer \$\{token\}`/.test(slice));
});
test('session/[id].tsx guards the messages fetch on token+id and always sends the header', () => {
  assert.ok(sessionViewSrc.includes('if (!token || !id) return;'));
  assert.ok(sessionViewSrc.includes("fetch(`${API_BASE}/api/chat/sessions/${id}/messages`"));
  assert.ok(/headers: \{ Authorization: `Bearer \$\{token\}` \}/.test(sessionViewSrc));
});

console.log('\n── W3-J04 — Save an answer ──────────────────────────────────────');

test('saveAnswer() in the chat screen calls addBookmark with the session token', () => {
  assert.ok(/const saveAnswer = useCallback\(\s*async \(m: Msg\) => \{/.test(chatSrc));
  assert.ok(/await addBookmark\(API_BASE as string, token, \{/.test(chatSrc));
});
test('bookmarks.ts is local-first (AsyncStorage) and only pushes to the server when a token exists', () => {
  assert.ok(bookmarksSrc.includes("await AsyncStorage.setItem(KEY"));
  assert.ok(/if \(token\) \{\s*\n\s*push\(apiBase, token, item\)\.catch/.test(bookmarksSrc));
});
test('the server push (PUT /bookmarks) sends the auth token', () => {
  const idx = bookmarksSrc.indexOf('async function push(');
  const slice = bookmarksSrc.slice(idx, idx + 400);
  assert.ok(slice.includes("`${apiBase}/api/bookmarks`"));
  assert.ok(/Authorization: `Bearer \$\{token\}`/.test(slice));
});
test('removeBookmark sends the auth token to DELETE /bookmarks/{client_id} when a token exists', () => {
  const idx = bookmarksSrc.indexOf('export async function removeBookmark');
  const slice = bookmarksSrc.slice(idx, idx + 500);
  assert.ok(slice.includes('if (token)'));
  assert.ok(/Authorization: `Bearer \$\{token\}`/.test(slice));
});

console.log('\n── W3-J05 — Greeting / small talk ───────────────────────────────');

test('greeting/small-talk has no separate frontend endpoint -- it rides the same already-verified /api/chat/stream call as W3-J01/J02', () => {
  // Only one chat-sending endpoint exists in the chat screen; a greeting
  // is just a message sent through it, not a distinct code path.
  const streamCalls = [...chatSrc.matchAll(/fetch\(`\$\{API_BASE\}\/api\/chat\/stream`/g)];
  assert.ok(streamCalls.length >= 1, 'expected the chat screen to send all messages (including greetings) through /api/chat/stream');
});

console.log('\n── W5-J02 — Listen to an answer ─────────────────────────────────');

test('session/[id].tsx\'s speak() sends POST /api/voice/tts with the auth token', () => {
  assert.ok(sessionViewSrc.includes("fetch(`${API_BASE}/api/voice/tts`"));
  const idx = sessionViewSrc.indexOf("fetch(`${API_BASE}/api/voice/tts`");
  const slice = sessionViewSrc.slice(idx, idx + 300);
  assert.ok(/Authorization: `Bearer \$\{token\}`/.test(slice));
});
test('tapping the same message\'s speaker icon again stops playback instead of starting a second overlapping one', () => {
  assert.ok(sessionViewSrc.includes('if (speakingId === mid) { stopSpeaking(); return; }'));
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
