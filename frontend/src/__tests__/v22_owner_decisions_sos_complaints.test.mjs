/**
 * v2.2 — owner decisions, 22 Nov (existing flags, default OFF).
 * (1) UI_V22_ONE_SOS: the red emergency button reads "SOS" everywhere —
 *     the docked/floating GlobalHelpButton no longer says "Help".
 * (2) UI_V22_SWEEP: Complaints hides its header "+" only while the list is
 *     definitely empty (loaded, no error, no items); the big "Start a
 *     complaint" button stays; "+" returns with the first complaint.
 * (3) Retention periods on My Data: kept as they are (no change here).
 * Run with: node --experimental-strip-types --test src/__tests__/v22_owner_decisions_sos_complaints.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

test('(1) red emergency button text and name read SOS with ONE_SOS on; Help with it off', () => {
  const s = read('src', 'components', 'dhara', 'GlobalHelpButton.tsx');
  assert.match(s, /<Text style=\{styles\.txt\}>\{UI_V22_ONE_SOS \? 'SOS' : 'Help'\}<\/Text>/);
  assert.match(s, /accessibilityLabel=\{UI_V22_ONE_SOS \? 'SOS — emergency numbers and what to do next' : 'Help — emergency numbers and what to do next'\}/);
  assert.match(s, /import \{ UI_V22_ONE_SOS \} from '\.\.\/\.\.\/uiV22Flags';/);
  // Destination unchanged: still opens Emergency.
  assert.match(s, /router\.push\('\/emergency'\)/);
});

test('(2) list reports "definitely empty" only when loaded, no error, no items', () => {
  const s = read('src', 'home', 'ComplaintsList.tsx');
  assert.match(s, /const definitelyEmpty = !loading && !error && items\.length === 0;/);
  assert.match(s, /useEffect\(\(\) => \{ onEmptyChange\?\.\(definitelyEmpty\); \}, \[definitelyEmpty, onEmptyChange\]\);/);
  // Big empty-state button is untouched.
  assert.match(s, /testID=\{`\$\{scope\}-first-complaint`\}[^\n]*>Start a complaint</);
});

test('(2) Complaints header "+" hidden only with SWEEP on AND an empty list', () => {
  const s = read('app', 'complaints.tsx');
  assert.match(s, /const hideHeaderAdd = UI_V22_SWEEP && listEmpty;/);
  assert.match(s, /const \[listEmpty, setListEmpty\] = useState\(false\);/); // starts shown
  // 27 Nov: the "+" now rides in the shared title row's right slot; the
  // rule is the same (hidden only when hideHeaderAdd).
  assert.match(s, /right=\{hideHeaderAdd \? undefined : \(\s*\n\s*<Pressable testID="complaints-create"/);
  assert.match(s, /<ComplaintsList all onEmptyChange=\{setListEmpty\} \/>/);
});

test('(3) My Data retention periods unchanged by this PR', () => {
  const s = read('app', 'my-data.tsx');
  assert.ok(s.includes('retention_policy'), 'retention list still rendered');
});
