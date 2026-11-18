// B-70 (14 Nov 2026): "Three different grievance contacts in the app. Use
// one." Tracker note: "Wait for counsel to confirm the wording; prepare the
// change now."
//
// operatorIdentity.ts already documented itself as the "single source of
// truth ... across the app", but three screens never actually read it --
// each hardcoded its own value instead:
//   - app/my-data.tsx          -> "grievance@calviltech.com" (no name)
//   - app/grievance.tsx        -> "grievance@calviltech.com" (no name)
//   - app/settings/data-privacy.tsx -> local GRIEVANCE_EMAIL / GRIEVANCE_
//     OFFICER_NAME constants, "The Grievance Officer, Calvil Technologies"
// ...while app/consent.tsx (via operatorIdentity.ts) showed a fourth: "Varuna
// Moses, varuna@calviltech.com". A user who opened more than one of these
// screens would see visibly different contact details for what must be the
// same legally required grievance officer.
//
// This is prep work, not the final wording: operatorIdentity.ts's actual
// name/email values are an editorial/legal decision (same as the consent
// copy in B-62), not something this fix invents or changes. What's fixed is
// that every screen now reads the SAME constants, so confirming the final
// wording is a one-file edit (operatorIdentity.ts) instead of hunting down
// each screen again. backend/legal.py's own Terms & Conditions document body
// text is deliberately left untouched -- that's published legal content, the
// same category of out-of-engineering-scope change B-62 already drew the
// line at, not a code wiring defect.
//
// Source-level wiring checks -- these are React Native screens with RN/Expo
// imports and can't be executed directly in this test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const screens = {
  'my-data.tsx': path.join(root, 'app', 'my-data.tsx'),
  'grievance.tsx': path.join(root, 'app', 'grievance.tsx'),
  'data-privacy.tsx': path.join(root, 'app', 'settings', 'data-privacy.tsx'),
};

for (const [label, file] of Object.entries(screens)) {
  test(`B-70: ${label} imports the grievance contact from operatorIdentity.ts, not a local hardcode`, () => {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /from\s+['"]@\/src\/operatorIdentity['"]/);
    assert.match(src, /grievanceOfficerName/);
    assert.match(src, /grievanceContactEmail/);
    assert.match(src, /isGrievanceContactPlaceholder/);
    // The old hardcoded literal must not still be sitting there as a second,
    // competing source of truth.
    assert.doesNotMatch(src, /'grievance@calviltech\.com'/);
  });

  test(`B-70: ${label} fail-closed-hides the grievance line/action if the contact is ever an unconfirmed placeholder`, () => {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /isGrievanceContactPlaceholder\(\)/);
  });
}

test('B-70: data-privacy.tsx keeps SUPPORT_EMAIL separate -- it is a different, general contact, not part of this consolidation', () => {
  const src = readFileSync(screens['data-privacy.tsx'], 'utf8');
  // SUPPORT_EMAIL is now imported from operatorIdentity.ts (privacyContactEmail)
  // so it is no longer a string literal here — verify the import wiring instead.
  assert.match(src, /privacyContactEmail/);
  assert.match(src, /SUPPORT_EMAIL\s*=\s*privacyContactEmail/);
  // Merged 16 Nov with W6-J05: the grievance row now opens the in-app
  // /grievance screen (no mailto at all), and the officer footer is still
  // hidden while the contact is an unconfirmed placeholder.
  assert.match(src, /router\.push\('\/grievance'/);
  assert.match(src, /!isGrievanceContactPlaceholder\(\)/);
});

test('B-70: operatorIdentity.ts (the single source) is untouched wording-wise -- this fix only wires screens to it', () => {
  const src = readFileSync(path.join(root, 'src', 'operatorIdentity.ts'), 'utf8');
  assert.match(src, /single source of truth/i);
  assert.match(src, /export const grievanceOfficerName/);
  assert.match(src, /export const grievanceContactEmail/);
});

// 17 Nov 2026: owner confirmed the grievance mailbox grievances@askdhara.in.
// The app screens read it from operatorIdentity.ts; the Terms text served by
// the backend (backend/legal.py, clause 21) must name the same officer and
// mailbox, and no old address may survive anywhere the user can see it.
test('B-70: operatorIdentity.ts uses the confirmed grievance mailbox grievances@askdhara.in', () => {
  const src = readFileSync(path.join(root, 'src', 'operatorIdentity.ts'), 'utf8');
  assert.match(src, /grievanceContactEmail\s*=\s*'grievances@askdhara\.in'/);
  assert.match(src, /grievanceOfficerName\s*=\s*'Varuna Moses'/);
});

test('B-70: the Terms text (backend/legal.py) names the same officer and mailbox', () => {
  const src = readFileSync(path.join(root, '..', 'backend', 'legal.py'), 'utf8');
  assert.match(src, /Grievance Officer: Varuna Moses — grievances@askdhara\.in/);
  assert.doesNotMatch(src, /grievance@calviltech\.com|varuna@calviltech\.com/);
});
