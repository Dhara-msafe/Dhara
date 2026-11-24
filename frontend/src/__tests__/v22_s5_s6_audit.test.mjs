// v2.2 Batch 2 (S5+S6) audit lock-in. Per screen-manifest.csv and
// DESIGN_CHANGELOG.md, most Batch 2 screens needed no code change — this
// confirms the specific, already-correct behaviour so a future edit can't
// silently regress it. See the tracking sheet's "Progress Notes" column for
// the full reasoning per screen.
// Run: node --experimental-strip-types --test src/__tests__/v22_s5_s6_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, ...p.split('/')), 'utf8');

// -- id6 Home: manifest says "voice-first action kept; typing alternative
// labelled". Both already true — lock them in.
test('Home keeps the mic as the primary action and labels the typing alternative', () => {
  const home = read('app/(tabs)/home.tsx');
  assert.match(home, /testID="home-mic"/);
  assert.match(home, /accessibilityLabel="Ask DHARA a question by voice"/);
  assert.match(home, /testID="home-type-button"/);
  assert.match(home, /accessibilityLabel="Type your question instead"/);
});

// -- ids 7/8/10/12/13 (Listening/Type/Heard/Answer/Sources): manifest says
// these are merged states inside the main chat screen, not separate screens.
// COPY_AND_CAPABILITY_AUDIT.csv says Answer/Sources content is "Unchanged in
// design" — production already uses honest verification/staleness/IPC->BNS
// states rather than a flat "verified" claim. Lock in that honesty.
test('the Ask flow citation card shows a DRAFT fallback instead of inventing official text', () => {
  const chat = read('app/(tabs)/index.tsx');
  assert.match(chat, /DRAFT — reviewed official text for this section is not yet available\./);
});

test('the Ask flow citation card carries a real verified-at label, staleness and IPC→BNS notices, not a blanket "verified" claim', () => {
  const chat = read('app/(tabs)/index.tsx');
  assert.match(chat, /verifiedLabel\(c\.verified_at\)/);
  assert.match(chat, /isStale\(c\.verified_at\)/);
  assert.match(chat, /renumbered or replaced under BNS 2023/);
});

// -- id28/29 (Rights library / One right): the mockup's search box doesn't
// exist in the app — building it would be new functionality, out of scope
// (same call as Guardian share in Batch 1). The accordion (id29) is already
// the inline expand/collapse in rights.tsx.
test('Rights screen has no search input to label (confirms it is out of scope, not missed)', () => {
  const rights = read('app/(tabs)/rights.tsx');
  assert.doesNotMatch(rights, /placeholder=.*[Ss]earch/);
});

test('Rights screen implements the one-right detail as an inline accordion, not a separate screen', () => {
  const rights = read('app/(tabs)/rights.tsx');
  assert.match(rights, /setExpanded\(open \? null : t\.id\)/);
  assert.match(rights, /accessibilityState=\{\{ expanded: open \}\}/);
});

// -- id30 Dhara Engine: placeholder sample content, audited for overclaiming
// copy (encryption/verification/police-notified style claims) and found
// clean. Lock in that it stays clean.
test('Dhara Engine has no overclaiming copy (encrypted/verified/police-notified/guarantee)', () => {
  const engine = read('app/engine.tsx');
  assert.doesNotMatch(engine, /\bencrypted\b/i);
  assert.doesNotMatch(engine, /\bguarantee/i);
  assert.doesNotMatch(engine, /police (has been |is )?notified/i);
});
