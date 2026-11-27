import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('SOS 112 sits at the top of the screens that used to show the floating SOS', () => {
  for (const f of ['app/login.tsx', 'app/signup.tsx', 'app/forgot-password.tsx', 'app/delete-account.tsx', 'app/upgrade.tsx', 'app/permissions-setup.tsx']) {
    assert.match(read(f), /<SosPill112 /, f);
  }
});

test('SOS 112 button is at least 44 px tall', () => {
  assert.match(read('src/ui/kit.tsx'), /sos: \{[^}]*minHeight: 44/);
});

test('rights-card load errors are a calm notice, not the headline', () => {
  const o = read('app/women/officer-card.tsx');
  assert.match(o, /styles\.errBox/);
  assert.match(o, /Couldn't load the rights card/);
  const a = read('app/action-plan.tsx');
  assert.match(a, /card \? styles\.rightTitle : styles\.rightTitleQuiet/);
});

test('one back icon: no arrow-back left in app screens', () => {
  for (const f of ['app/ipc-bns-lookup.tsx', 'app/complaints.tsx', 'app/fir-draft/index.tsx', 'app/missing/index.tsx', 'app/upgrade.tsx', 'app/how-it-helps.tsx']) {
    assert.doesNotMatch(read(f), /"arrow-back"/, f);
  }
});

test('titles sit on the left in the shared title row', () => {
  for (const f of ['app/my-data.tsx', 'app/grievance.tsx', 'app/drafts/index.tsx', 'app/action-plan.tsx', 'app/fraud-checklist.tsx']) {
    assert.match(read(f), /<PageTitleRow/, f);
  }
});

test('sign-in pages: DHARA wordmark, readable tagline, white input boxes', () => {
  for (const f of ['app/signup.tsx', 'app/forgot-password.tsx', 'app/delete-account.tsx']) {
    const s = read(f);
    assert.match(s, />DHARA<\/Text>/, f);
    assert.match(s, /tag: \{ color: theme\.colors\.headerTagline/, f);
    assert.match(s, /  input: \{[^}]*backgroundColor: theme\.colors\.paper/, f);
  }
});

test('disabled buttons use the design system disabled colour', () => {
  assert.match(read('app/state.tsx'), /btnDisabled: \{ backgroundColor: theme\.colors\.disabledBg \}/);
  assert.match(read('app/women/head-out/destination.tsx'), /nextBtnDisabled: \{ backgroundColor: c\.disabledBg \}/);
});

test('fraud checklist shows no placeholder clock before it starts', () => {
  assert.match(read('app/fraud-checklist.tsx'), /\{startedAt \? <Text style=\{\[styles\.timer/);
});

// ── Batch A, re-audit of 27 Nov ──────────────────────────────────────────────
test('navy header never cuts the title to one line', () => {
  const h = read('src/components/dhara/ScreenHeader.tsx');
  assert.match(h, /styles\.title\} numberOfLines=\{2\}/);
  assert.doesNotMatch(h, /numberOfLines=\{subtitle \? 1 : 2\}/);
});

test('Pay by UPI matches the sign-in pages and has SOS 112', () => {
  const s = read('app/pay-upi.tsx');
  assert.match(s, /<SosPill112 testID="pay-upi-sos"/);
  assert.doesNotMatch(s, />Dhara<\/Text>/);
});

test('Sign up keeps the password eye inside its box', () => {
  const s = read('app/signup.tsx');
  assert.match(s, /pwWrap: \{[^}]*overflow: 'hidden'/);
  assert.match(s, /pwInput: \{ flex: 1, minWidth: 0/);
});

test('more screens use the shared title row', () => {
  for (const f of ['app/drafts/history.tsx', 'app/(tabs)/lookup.tsx', 'app/fir-draft/index.tsx', 'app/missing/index.tsx']) {
    assert.match(read(f), /<PageTitleRow/, f);
  }
});

test('small chips and the Shield header buttons are 44 px tall', () => {
  assert.match(read('app/fir-draft/index.tsx'), /langChip: \{\s*paddingHorizontal: 14, paddingVertical: 8, minHeight: 44/);
  assert.match(read('app/(tabs)/myfiles.tsx'), /filterChip:\s+\{[^}]*minHeight: 44/);
  assert.match(read('app/women-shield.tsx'), /backBtn: \{ width: 44, height: 44/);
});

// ── Back buttons, 27 Nov ─────────────────────────────────────────────────────
test('screens that had no way back now have a back button', () => {
  const ids: Record<string, string> = {
    'app/all-help.tsx': 'all-help-back',
    'app/(tabs)/voter-roll.tsx': 'voter-roll-back',
    'app/(tabs)/discover.tsx': 'lookup-hub-back',
    'app/delete-account.tsx': 'delete-account-back',
    'app/signup.tsx': 'signup-back',
    'app/emergency.tsx': 'emergency-back',
    'app/fir-draft/result.tsx': 'fir-result-error-back-top',
  };
  for (const [f, id] of Object.entries(ids)) assert.ok(read(f).includes(id), `${f} has ${id}`);
});

test('no text-arrow back buttons are left', () => {
  for (const f of ['app/voter-roll/form.tsx', 'app/missing/interview.tsx', 'app/missing/result.tsx', 'app/lookup-results.tsx', 'app/lookup-webview.tsx']) {
    const s = read(f);
    assert.doesNotMatch(s, /backText\}>←/, f);
    assert.doesNotMatch(s, /arrow-back-outline/, f);
    assert.match(s, /chevron-back/, f);
  }
});

// ── One bar: page title and back arrow inside the DHARA bar, 27 Nov ─────────
test('the DHARA bar shows the focused page title and back arrow', () => {
  const reg = read('src/ui/headerTitle.ts');
  assert.match(reg, /EXPO_PUBLIC_HEADER_TITLE_IN_BAR !== 'false'/); // backup switch
  assert.match(reg, /if \(owner === id\) \{ owner = null; current = null; emit\(\); \}/); // only the owner clears
  const auto = read('src/ui/AutoHeader.tsx');
  assert.match(auto, /export function PageAwareHeader/);
  assert.match(auto, /<AppHeader showBack onBack=\{page\.onBack\} title=\{page\.title\}/);
  assert.match(read('app/(tabs)/_layout.tsx'), /<PageAwareHeader testID="tabs-header" \/>/);
});

test('the title row steps aside under the bar but keeps the old row as backup', () => {
  const row = read('src/ui/PageTitleRow.tsx');
  assert.match(row, /const inBar = HEADER_TITLE_IN_BAR && underBar;/);
  assert.match(row, /if \(!subtitle\) return null;/);
  assert.match(row, /<View style=\{s\.row\} testID=\{testID\}>/); // old two-row layout still there
});
