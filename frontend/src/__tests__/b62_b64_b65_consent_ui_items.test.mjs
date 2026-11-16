// B-62 + B-64 + B-65 (14 Nov 2026): three small UI items grouped on the
// tracker as "Consent wording/placeholders; switch accessibility; sidebar
// beside consent screens."
//
// B-65 (fixed): on a wide browser, app/_layout.tsx always wrapped every
// screen -- including /consent, /login, /signup, /forgot-password and
// /delete-account -- in the desktop shell's DesktopFrame, which renders a
// full app navigation sidebar (Women's Shield, FIR draft, Dhara Engine, …)
// beside them. Showing that sidebar next to the REQUIRED consent screen in
// particular invited the user to navigate away into the full app before
// finishing a compliance step; the same sidebar makes no sense next to a
// pre-auth sign-in/sign-up screen either. Fixed by excluding this fixed
// list of standalone routes from the wide-web desktop shell.
//
// B-64 (fixed): most <Switch> toggles across the app had no
// accessibilityLabel. React Native's Switch is automatically exposed to a
// screen reader as a "switch" with its on/off state, but without a label a
// screen-reader user hears only "switch, on" with no idea what it
// controls -- the adjacent sighted-only <Text> label is not announced
// together with it. Added accessibilityLabel to every one found.
//
// B-62 (verified, no code change): checked for the literal bug this kind of
// ticket usually means -- an unfilled {{PLACEHOLDER}} token reaching the
// screen. consent.tsx's fillPlaceholders() is applied everywhere a
// consentStrings field uses the {{DATA_LOCATION}} / {{GRIEVANCE_OFFICER_NAME}}
// / {{GRIEVANCE_EMAIL}} tokens, and the grievance line is hidden entirely
// (not shown with a placeholder) while the grievance contact itself is still
// an unconfirmed placeholder. No unfilled token reaches the UI. The actual
// consent *wording* is explicitly still DRAFT pending counsel/native-speaker
// review (consentStrings.ts's own CONSENT_META.status says so) -- an
// editorial decision, not an engineering defect, so no copy was rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

// ── B-65 ─────────────────────────────────────────────────────────────────
test('B-65: the desktop sidebar shell excludes consent, login, signup, forgot-password and delete-account', () => {
  const src = readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');
  assert.match(src, /STANDALONE_ROUTES\s*=\s*\[[^\]]*'\/consent'[^\]]*\]/);
  assert.match(src, /STANDALONE_ROUTES[\s\S]*?'\/login'/);
  assert.match(src, /STANDALONE_ROUTES[\s\S]*?'\/signup'/);
  assert.match(src, /STANDALONE_ROUTES[\s\S]*?'\/forgot-password'/);
  assert.match(src, /STANDALONE_ROUTES[\s\S]*?'\/delete-account'/);
  assert.match(src, /isWideWeb\s*=\s*Platform\.OS === 'web' && width >= 1200 && !isStandaloneScreen/);
});

// ── B-64 ─────────────────────────────────────────────────────────────────
function switchesMissingLabel(src) {
  // Find every <Switch ...> opening tag (may span multiple lines) and check
  // it carries an accessibilityLabel prop.
  const tags = src.match(/<Switch\b[\s\S]*?\/>/g) || [];
  return tags.filter((t) => !/accessibilityLabel\s*=/.test(t));
}

const switchFiles = [
  'app/(tabs)/settings.tsx',
  'app/settings/data-privacy.tsx',
  'app/women/code-phrase.tsx',
  'app/women/head-out/circle.tsx',
  'app/women/silent-alert.tsx',
  'app/women/trusted-circle.tsx',
  'app/women-shield.tsx',
  'app/invite/[id].tsx',
  'app/family-journey/contacts.tsx',
  'app/family-journey/index.tsx',
];

for (const rel of switchFiles) {
  test(`B-64: every <Switch> in ${rel} has an accessibilityLabel`, () => {
    const src = readFileSync(path.join(root, rel), 'utf8');
    const missing = switchesMissingLabel(src);
    assert.equal(missing.length, 0, `${missing.length} <Switch> without accessibilityLabel in ${rel}:\n${missing.join('\n---\n')}`);
  });
}

// ── B-62 ─────────────────────────────────────────────────────────────────
test('B-62: every {{PLACEHOLDER}} token used in consentStrings.ts is filled before render in consent.tsx', () => {
  const stringsSrc = readFileSync(path.join(root, 'src', 'consentStrings.ts'), 'utf8');
  const consentSrc = readFileSync(path.join(root, 'app', 'consent.tsx'), 'utf8');
  const tokensUsed = new Set((stringsSrc.match(/\{\{[A-Z_]+\}\}/g) || []));
  assert.ok(tokensUsed.size > 0, 'expected consentStrings.ts to use at least one {{TOKEN}} placeholder');
  for (const token of tokensUsed) {
    assert.ok(consentSrc.includes(`'${token}'`) || consentSrc.includes(`"${token}"`),
      `${token} is used in consentStrings.ts but has no fill entry in consent.tsx's PLACEHOLDERS map`);
  }
  // Every field that can contain a token must be passed through fillPlaceholders
  // before being rendered, not rendered raw.
  assert.match(consentSrc, /fillPlaceholders\(strings\.storage\)/);
  assert.match(consentSrc, /fillPlaceholders\(strings\.grievance\)/);
  // The grievance line itself must be hidden, not shown with a stand-in
  // value, while the real contact is still an unconfirmed placeholder.
  assert.match(consentSrc, /showGrievanceLine\s*&&/);
});
