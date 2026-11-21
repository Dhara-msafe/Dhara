/** B-109 (21 Nov web retest): no mic on the GPS question (web fallback box)
 * and on the mobile-number question. Phone gets its mic from the backend
 * input_type (tested in backend/tests/test_b109_b108_fir_mic_and_tokens.py);
 * this pins the web GPS fallback composer's voice wiring. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(import.meta.dirname, '..', '..', 'app/fir-draft/index.tsx'), 'utf8');

test('web GPS fallback composer offers the mic with the real recording handlers', () => {
  const start = src.indexOf("{inputType === 'gps' && !gpsAvailable && (");
  assert.ok(start > 0, 'GPS fallback block present');
  const block = src.slice(start, src.indexOf(')}', src.indexOf('/>', start)) + 2);
  assert.match(block, /showVoice\b(?!=\{false\})/);
  assert.doesNotMatch(block, /showVoice=\{false\}/);
  assert.match(block, /onStartRecord=\{onMicPressIn\}/);
  assert.match(block, /onStopRecord=\{onMicPressOut\}/);
  assert.match(block, /isRecording=\{isRecording\}/);
  assert.match(block, /micPanHandlers=\{micPanResponder\.panHandlers\}/);
  // Same send path as the normal composer.
  assert.match(block, /onSend=\{handleTextSend\}/);
});
