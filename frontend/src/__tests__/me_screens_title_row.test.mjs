// 26 Nov 2026 (Vivek): every screen opened from Me uses one title row
// (src/ui/PageTitleRow.tsx): same back arrow, same title font, size and
// left edge, subtitle wrapped to at most two lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');

test('the shared row: one arrow, one title style, two-line subtitle', () => {
  const src = read('src/ui/PageTitleRow.tsx');
  assert.match(src, /name="chevron-back" size=\{24\} color=\{c\.navy\}/);
  assert.match(src, /accessibilityLabel="Go back"/);
  assert.match(src, /titleSize: 20/);
  assert.match(src, /fontFamily: theme\.fonts\.displayBold, fontSize: PAGE_TITLE\.titleSize/);
  assert.match(src, /subtitleLines: 2/);
  assert.match(src, /numberOfLines=\{PAGE_TITLE\.subtitleLines\}/);
  assert.match(src, /accessibilityLabel=\{subtitle\}/, 'screen readers get the full subtitle');
});

const SCREENS = [
  ['src/components/dhara/ScreenHeader.tsx', 'screen-back'],   // Edit profile, Trusted Circle, Notifications
  ['src/familyJourney/ui.tsx', 'fj-back'],                    // Family Journey
  ['app/settings/data-privacy.tsx', null],
  ['app/(tabs)/settings.tsx', 'settings-back'],
  ['app/(tabs)/history.tsx', 'history-back'],
  ['app/(tabs)/saved.tsx', 'saved-back'],
  ['app/language.tsx', 'language-back'],
  ['app/state.tsx', 'state-back'],
  ['app/(tabs)/advocate.tsx', 'advocate-back'],
];
for (const [file, backId] of SCREENS) {
  test(`${file} uses the shared title row`, () => {
    const src = read(file);
    assert.match(src, /import \{ PageTitleRow \} from /);
    assert.match(src, /<PageTitleRow\b/);
    if (backId) assert.match(src, new RegExp(`backTestID="${backId}"`));
  });
}

test('first launch keeps its own layout (Language step 1, State after sign-up)', () => {
  const lang = read('app/language.tsx');
  assert.match(lang, /\{isChange \? \(\s*\/\/[^\n]*\n[^\n]*\n\s*<PageTitleRow/);
  assert.ok(lang.includes('STEP 1 OF 4'));
  const st = read('app/state.tsx');
  assert.match(st, /\{onboarding \? \(\s*<View style=\{styles\.header\}>/);
});

test('Settings goes back to whoever opened it', () => {
  assert.match(read('app/(tabs)/settings.tsx'), /onBack=\{\(\) => router\.navigate\(tabBackTarget\(from\) as any\)\}/);
  assert.equal(read('app/(tabs)/me.tsx').split("'/(tabs)/settings?from=me'").length - 1, 2);
  assert.match(read('app/(tabs)/index.tsx'), /'\/\(tabs\)\/settings\?from=ask'/);
});
