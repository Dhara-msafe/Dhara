/**
 * Day 3 — W3-J01 (ask a legal question), W3-J02 (follow-up question),
 * W5-J01 (ask by voice) — source-level wiring checks.
 *
 * Same convention as nearestHelp.logic.test.mjs: app/(tabs)/index.tsx imports
 * react-native and can't be executed directly in plain Node, so this file
 * does source-level assertions on the real file instead of re-implementing
 * its logic. What this file CAN confirm from this sandbox:
 *   - /api/chat/stream (the endpoint both a first question and a follow-up
 *     question use) sends the session auth token.
 *   - A follow-up question reuses the same session_id the first answer's
 *     "session" SSE frame handed back — not a separate, unauthenticated, or
 *     stateless call.
 *   - /api/chat/followup (auto-generated suggestion CHIPS) is a distinct,
 *     fire-and-forget call — NOT the mechanism for the user's own follow-up
 *     question — and it also sends the auth token.
 *   - The voice flow (record -> whisperTranscribeFile -> transcript preview
 *     -> sendTranscript) ends up calling the exact same send() used for a
 *     typed question, so it inherits the same auth/session wiring above.
 *   - whisperTranscribeFile (src/voice/stt.ts) sends the auth token to
 *     /api/voice/transcribe.
 *
 * What this file deliberately does NOT and CANNOT check: a real LLM answer
 * coming back, or real audio being transcribed. Both /api/chat/stream's
 * answer and /api/voice/transcribe's transcript are produced by a live call
 * to Emergent's hosted model/Whisper proxy (see backend/services/ai_gateway.py,
 * which imports emergentintegrations.llm.chat and reads EMERGENT_LLM_KEY, and
 * src/voice/stt.ts's own header: "OpenAI Whisper, Emergent-managed"). This
 * sandbox has no network egress to that provider and no real key — see
 * backend/tests/test_voice_transcribe.py and test_head_out_places_autocomplete.py
 * for the equivalent live-endpoint contracts, which need a running backend
 * + real credentials to execute (same limitation already logged against
 * W2-J02 on Day 2).
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

const chatSrc = readFileSync(join(__dirname, '../../app/(tabs)/index.tsx'), 'utf8');
const sttSrc = readFileSync(join(__dirname, '../voice/stt.ts'), 'utf8');

console.log('\n── W3-J01 / W3-J02 — chat/stream auth + session continuity ─────');

test('chat/stream request sends the session auth token', () => {
  assert.ok(/fetch\(`\$\{API_BASE\}\/api\/chat\/stream`/.test(chatSrc));
  assert.ok(/Authorization: `Bearer \$\{token\}`/.test(chatSrc));
});
test('chat/stream request body carries session_id (so a follow-up continues the same case, not a fresh one)', () => {
  assert.ok(/body: JSON\.stringify\(\{[\s\S]{0,80}message: q,[\s\S]{0,40}session_id: sessionId,/.test(chatSrc));
});
test('the session_id used on the next request is the one the backend handed back, not invented client-side', () => {
  assert.ok(chatSrc.includes('if (payload.session_id && capturedConvKey === convKeyRef.current)'));
  assert.ok(chatSrc.includes('setSessionId(payload.session_id)'));
});
test('a 401 mid-chat forces logout rather than showing a generic chat error', () => {
  assert.ok(/res\.status === 401[\s\S]{0,120}forceLogout\(\)/.test(chatSrc));
});

console.log('\n── /api/chat/followup — distinct from the user\'s own follow-up ─');

test('/api/chat/followup is a separate, fire-and-forget call for suggestion chips, not the user\'s follow-up question', () => {
  assert.ok(chatSrc.includes("fetch(`${API_BASE}/api/chat/followup`"));
  // It must not block the main answer: wrapped in its own async IIFE with a
  // swallowed catch, and only fired after the main answer already rendered.
  assert.ok(/\(async \(\) => \{\s*try \{\s*const fqRes = await fetch\(`\$\{API_BASE\}\/api\/chat\/followup`/.test(chatSrc));
  assert.ok(/\}\)\(\);/.test(chatSrc));
});
test('the follow-up-chips call also sends the session auth token', () => {
  const idx = chatSrc.indexOf('/api/chat/followup');
  const slice = chatSrc.slice(idx, idx + 300);
  assert.ok(/Authorization: `Bearer \$\{token\}`/.test(slice));
});

console.log('\n── W5-J01 — voice question converges on the same send() path ───');

test('sendTranscript hands the heard text to the same send() used for typed questions', () => {
  assert.ok(/const sendTranscript = useCallback\(\(\) => \{[\s\S]{0,300}if \(t\) send\(t\);/.test(chatSrc));
});
test('editing the transcript before sending reuses the normal text input, not a separate voice-only send path', () => {
  assert.ok(/const editTranscriptInComposer = useCallback\(\(\) => \{[\s\S]{0,120}setInput\(transcriptPreview\);/.test(chatSrc));
});
test('recording is gated on having a session token (no anonymous mic capture)', () => {
  assert.ok(/const startRecording = useCallback\(async \(\) => \{\s*if \(!token \|\| micStartingRef\.current\) return;/.test(chatSrc));
});

console.log('\n── Whisper transcription (src/voice/stt.ts) ─────────────────────');

test('whisperTranscribeFile sends the session auth token to /api/voice/transcribe', () => {
  assert.ok(sttSrc.includes("fetch(`${apiBase}/api/voice/transcribe`"));
  assert.ok(/headers: \{ Authorization: `Bearer \$\{token\}` \}/.test(sttSrc));
});
test('an expired/invalid session on transcription is surfaced distinctly (not a generic error)', () => {
  assert.ok(/res\.status === 401[\s\S]{0,60}__session_expired__/.test(sttSrc));
});
test('transcription documents that it is a cloud (Emergent-managed) call, not on-device — the reason it needs a live server to verify end-to-end', () => {
  assert.ok(/Emergent-managed/.test(sttSrc));
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
