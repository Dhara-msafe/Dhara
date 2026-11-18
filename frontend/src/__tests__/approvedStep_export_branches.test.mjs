/**
 * approvedStep_export_branches.test.mjs
 *
 * Verifies the three mutually-exclusive export branches in
 * ApprovedStep.tsx's doExport() function (copy / web-share / native-share),
 * the outbound simulation guard on the shareExternal code path, and that
 * the equivalent refactors in pay-upi.tsx and consent.tsx have no
 * control-flow regressions.
 *
 * Approach: source-wiring checks (readFileSync + structural analysis) for
 * React-Native component files that cannot be executed under plain
 * `node --test` (they transitively import react-native / expo APIs — see
 * helpActions.test.mjs for the same convention).  The outbound simulate/live
 * path logic is extracted inline from the policy table, mirroring the
 * classification-regex extraction used in outboundGuard.test.mjs.
 *
 * Run:
 *   node --experimental-strip-types --test \
 *     src/__tests__/approvedStep_export_branches.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPROVED_STEP = join(ROOT, 'src', 'notetaker', 'steps', 'ApprovedStep.tsx');
const PAY_UPI       = join(ROOT, 'app', 'pay-upi.tsx');
const CONSENT       = join(ROOT, 'app', 'consent.tsx');
const OUTBOUND      = join(ROOT, 'src', 'outbound.ts');

const approvedSrc = readFileSync(APPROVED_STEP, 'utf8');
const payUpiSrc   = readFileSync(PAY_UPI,       'utf8');
const consentSrc  = readFileSync(CONSENT,       'utf8');
const outboundSrc = readFileSync(OUTBOUND,      'utf8');

// ── Helper: extract a named function's body by matching braces ─────────────
function extractFn(src, name) {
  const sig = src.indexOf(`const ${name} = async (`);
  assert.ok(sig !== -1, `function "${name}" not found`);
  const braceStart = src.indexOf('{', sig);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(braceStart, i + 1); }
  }
  throw new Error(`could not find end of "${name}"`);
}

// ── Helper: extract the content of an if/else-if/else block ───────────────
// Returns the text between the opening { and its matching } for the branch
// whose header matches `headerRe`.
function extractBranchBlock(src, headerRe) {
  const m = headerRe.exec(src);
  if (!m) return null;
  const braceStart = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(braceStart + 1, i); }
  }
  return null;
}

const doExportBody = extractFn(approvedSrc, 'doExport');

// ═══════════════════════════════════════════════════════════════════════════
// 1. STRUCTURE — three mutually exclusive branches
// ═══════════════════════════════════════════════════════════════════════════

describe('ApprovedStep.tsx — doExport branch structure', () => {

  test('has copy branch', () => {
    assert.match(doExportBody, /if\s*\(\s*mode\s*===\s*'copy'\s*\)/);
  });

  test('has web branch as else-if on Platform.OS', () => {
    assert.match(doExportBody, /else\s+if\s*\(\s*Platform\.OS\s*===\s*'web'\s*\)/);
  });

  test('has native else branch (the previously missing gate)', () => {
    // The regression was: `} else {` was absent, making the native code
    // fall through into the web branch.  Assert the closing brace of the
    // web shareExternal call is immediately followed by `} else {`.
    assert.match(doExportBody, /shareExternal\(\s*\{[^}]*\}\s*\)\s*;\s*\}\s*else\s*\{/);
  });

  test('web and native blocks are separated: web block closes before FileSystem appears', () => {
    const webBlock = extractBranchBlock(
      doExportBody,
      /else\s+if\s*\(\s*Platform\.OS\s*===\s*'web'\s*\)\s*\{/,
    );
    assert.ok(webBlock !== null, 'web branch block not found');
    assert.ok(
      !webBlock.includes('FileSystem'),
      `FileSystem must NOT appear inside the web branch; found in: ${webBlock}`,
    );
    assert.ok(
      !webBlock.includes('Sharing.'),
      `Sharing.* must NOT appear inside the web branch; found in: ${webBlock}`,
    );
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 2. COPY BRANCH — clipboard only, no share APIs
// ═══════════════════════════════════════════════════════════════════════════

describe('ApprovedStep.tsx — copy branch', () => {

  const copyBlock = extractBranchBlock(doExportBody, /if\s*\(\s*mode\s*===\s*'copy'\s*\)\s*\{/);

  test('copy block is non-null', () => {
    assert.ok(copyBlock !== null);
  });

  test('copy branch uses Clipboard.setString', () => {
    assert.match(copyBlock, /Clipboard\.setString/);
  });

  test('copy branch does not call shareExternal', () => {
    assert.ok(!copyBlock.includes('shareExternal'), 'copy branch must not call shareExternal');
  });

  test('copy branch does not touch FileSystem or Sharing', () => {
    assert.ok(!copyBlock.includes('FileSystem'), 'copy branch must not use FileSystem');
    assert.ok(!copyBlock.includes('Sharing.'), 'copy branch must not use expo-sharing');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 3. WEB BRANCH — shareExternal only
// ═══════════════════════════════════════════════════════════════════════════

describe('ApprovedStep.tsx — web branch', () => {

  const webBlock = extractBranchBlock(
    doExportBody,
    /else\s+if\s*\(\s*Platform\.OS\s*===\s*'web'\s*\)\s*\{/,
  );

  test('web block is non-null', () => {
    assert.ok(webBlock !== null);
  });

  test('web branch calls shareExternal exactly once', () => {
    const hits = (webBlock.match(/shareExternal\s*\(/g) || []).length;
    assert.equal(hits, 1, `web branch must call shareExternal exactly once; found ${hits}`);
  });

  test('web branch passes { message: text } to shareExternal', () => {
    assert.match(webBlock, /shareExternal\(\s*\{\s*message:\s*text\s*\}/);
  });

  test('web branch does not touch FileSystem', () => {
    assert.ok(!webBlock.includes('FileSystem'), 'web branch must not use FileSystem');
  });

  test('web branch does not call Sharing.isAvailableAsync or Sharing.shareAsync', () => {
    assert.ok(!webBlock.includes('Sharing.'), 'web branch must not use expo-sharing');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NATIVE BRANCH — FileSystem + Sharing with shareExternal fallback
// ═══════════════════════════════════════════════════════════════════════════

describe('ApprovedStep.tsx — native branch', () => {

  // The native branch is the `else` block that follows the web branch.
  // We locate it by finding the FIRST `} else {` that appears AFTER the
  // web branch's shareExternal call, not the last one (which would be the
  // inner sharing-fallback else).
  function extractNativeBlock(body) {
    // 1. Find the web-branch's shareExternal call
    const webShareEnd = body.indexOf('await shareExternal({ message: text });');
    if (webShareEnd === -1) return null;
    // 2. Find the FIRST `} else {` after that point — this is the native opener
    const elseIdx = body.indexOf('} else {', webShareEnd);
    if (elseIdx === -1) return null;
    // 3. Extract content of the native block by matching braces
    const braceStart = body.indexOf('{', elseIdx + 1);
    let depth = 0;
    for (let i = braceStart; i < body.length; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') { depth--; if (depth === 0) return body.slice(braceStart + 1, i); }
    }
    return null;
  }

  const nativeBlock = extractNativeBlock(doExportBody);

  test('native block is non-null', () => {
    assert.ok(nativeBlock !== null, 'native else-branch not found in doExport');
  });

  test('native branch writes to FileSystem', () => {
    assert.match(nativeBlock, /FileSystem\.writeAsStringAsync/);
  });

  test('native branch checks Sharing.isAvailableAsync', () => {
    assert.match(nativeBlock, /Sharing\.isAvailableAsync\s*\(\s*\)/);
  });

  test('native branch calls Sharing.shareAsync when available', () => {
    assert.match(nativeBlock, /Sharing\.shareAsync\s*\(/);
  });

  test('native branch falls back to shareExternal when Sharing unavailable', () => {
    assert.match(nativeBlock, /shareExternal\(\s*\{\s*message:\s*text\s*\}/);
  });

  test('native branch does not call Clipboard.setString', () => {
    assert.ok(!nativeBlock.includes('Clipboard'), 'native branch must not set clipboard');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 5. IMPORT HYGIENE — Share removed, shareExternal imported
// ═══════════════════════════════════════════════════════════════════════════

describe('ApprovedStep.tsx — import hygiene', () => {

  test('Share is NOT imported from react-native', () => {
    // The violation that existed before the refactor.
    const rnImport = approvedSrc.match(/import\s*\{[^}]+\}\s*from\s*['"]react-native['"]/);
    assert.ok(rnImport, 'react-native import must exist');
    assert.ok(!rnImport[0].includes('Share,') && !rnImport[0].includes(', Share'),
      'Share must not be imported from react-native — route via shareExternal');
  });

  test('shareExternal is imported from @/src/outbound', () => {
    assert.match(approvedSrc, /import\s*\{[^}]*shareExternal[^}]*\}\s*from\s*['"]@\/src\/outbound['"]/);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 6. OUTBOUND SIMULATE / LIVE LOGIC — inline policy table (no native imports)
// ═══════════════════════════════════════════════════════════════════════════

describe('outbound.ts — shareExternal simulate/live paths (inline logic)', () => {

  // Inline port of the policy table and shouldDispatch() from outbound.ts.
  // This mirrors how outboundGuard.test.mjs extracts the classification
  // regexes rather than importing the module.
  const POLICY = {
    internal_qa:    { dialler: 'simulate', sms: 'simulate', external_share: 'simulate' },
    closed_testing: { dialler: 'live',     sms: 'live',     external_share: 'live'     },
    production:     { dialler: 'live',     sms: 'live',     external_share: 'live'     },
  };

  function shouldDispatch(channel, mode, profile) {
    const outboundLive = mode === 'live';
    return outboundLive && POLICY[profile][channel] === 'live';
  }

  // simulate / internal_qa  →  the current .env default
  test('simulate mode + internal_qa profile: external_share is NOT dispatched', () => {
    assert.equal(shouldDispatch('external_share', 'simulate', 'internal_qa'), false);
  });

  test('simulate mode + closed_testing profile: external_share is still NOT dispatched (master switch wins)', () => {
    assert.equal(shouldDispatch('external_share', 'simulate', 'closed_testing'), false);
  });

  test('simulate mode + production profile: external_share is still NOT dispatched', () => {
    assert.equal(shouldDispatch('external_share', 'simulate', 'production'), false);
  });

  // live mode
  test('live mode + internal_qa profile: external_share is NOT dispatched (profile restricts)', () => {
    assert.equal(shouldDispatch('external_share', 'live', 'internal_qa'), false);
  });

  test('live mode + closed_testing profile: external_share IS dispatched', () => {
    assert.equal(shouldDispatch('external_share', 'live', 'closed_testing'), true);
  });

  test('live mode + production profile: external_share IS dispatched', () => {
    assert.equal(shouldDispatch('external_share', 'live', 'production'), true);
  });

  // Verify these exact policy strings are still present in the source
  test('outbound.ts policy table still contains the simulate/live entries this test relies on', () => {
    assert.match(outboundSrc, /internal_qa.*external_share.*simulate/s);
    assert.match(outboundSrc, /closed_testing.*external_share.*live/s);
    assert.match(outboundSrc, /production.*external_share.*live/s);
  });

  // Verify shareExternal branches on shouldDispatch — not OUTBOUND_LIVE alone
  test('shareExternal source branches on shouldDispatch("external_share"), not OUTBOUND_LIVE alone', () => {
    const fnSrc = (() => {
      const start = outboundSrc.indexOf("export async function shareExternal(");
      const braceStart = outboundSrc.indexOf('{', start);
      let d = 0;
      for (let i = braceStart; i < outboundSrc.length; i++) {
        if (outboundSrc[i] === '{') d++;
        else if (outboundSrc[i] === '}') { d--; if (d === 0) return outboundSrc.slice(braceStart, i + 1); }
      }
    })();
    assert.match(fnSrc, /shouldDispatch\s*\(\s*['"]external_share['"]\s*\)/);
    // Must not branch on OUTBOUND_LIVE alone (that was the helpActions.ts bug — B-14)
    assert.ok(!fnSrc.includes('OUTBOUND_LIVE'), 'shareExternal must not branch on OUTBOUND_LIVE directly');
  });

  // Confirm current .env value is preserved
  test('current .env OUTBOUND_MODE is "simulate" (simulation preserved)', async () => {
    const { readFileSync: rf } = await import('node:fs');
    const env = rf(join(ROOT, '.env'), 'utf8');
    assert.match(env, /EXPO_PUBLIC_OUTBOUND_MODE\s*=\s*simulate/);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 7. pay-upi.tsx — openExternal refactor: no control-flow regression
// ═══════════════════════════════════════════════════════════════════════════

describe('pay-upi.tsx — openExternal refactor audit', () => {

  // Extract payWithUpiApp body
  const payFn = (() => {
    const start = payUpiSrc.indexOf('const payWithUpiApp = (');
    if (start === -1) return '';
    const braceStart = payUpiSrc.indexOf('{', start);
    let d = 0;
    for (let i = braceStart; i < payUpiSrc.length; i++) {
      if (payUpiSrc[i] === '{') d++;
      else if (payUpiSrc[i] === '}') { d--; if (d === 0) return payUpiSrc.slice(braceStart, i + 1); }
    }
    return '';
  })();

  test('payWithUpiApp body is non-empty', () => {
    assert.ok(payFn.length > 0);
  });

  test('calls openExternal, not Linking.openURL directly', () => {
    assert.match(payFn, /openExternal\s*\(/);
    assert.ok(!payFn.includes('Linking.openURL'), 'must not call Linking.openURL directly');
  });

  test('.catch() error handler still present after refactor', () => {
    assert.match(payFn, /\.catch\s*\(/);
  });

  test('error handler sets a user-visible error message', () => {
    assert.match(payFn, /setError\s*\(/);
  });

  test('Linking is NOT imported from react-native', () => {
    const rnImport = payUpiSrc.match(/import\s*\{[^}]+\}\s*from\s*['"]react-native['"]/);
    assert.ok(rnImport, 'react-native import must exist');
    assert.ok(!rnImport[0].includes('Linking'), 'Linking must not be in the react-native import');
  });

  test('openExternal is imported from @/src/outbound', () => {
    assert.match(payUpiSrc, /import\s*\{[^}]*openExternal[^}]*\}\s*from\s*['"]@\/src\/outbound['"]/);
  });

  // UPI URL classification — upi:// is NOT in any guarded scheme, so
  // openExternal passes it through to Linking.openURL in every mode.
  test('upi:// scheme is not classified as a guarded channel', () => {
    const DIALLER = /^\s*(tel|telprompt|facetime|skype|viber):/i;
    const SMS     = /^\s*(sms|smsto|mms):/i;
    const SHARE_SCHEME = /^\s*(mailto|whatsapp|intent|fb-messenger|tg):/i;
    const SHARE_HOST   = /^\s*https?:\/\/(wa\.me|api\.whatsapp\.com|t\.me)\b/i;
    const upiUrl = 'upi://pay?pa=test@upi&pn=DHARA&am=1&cu=INR';
    const isGuarded = DIALLER.test(upiUrl) || SMS.test(upiUrl) ||
                      SHARE_SCHEME.test(upiUrl) || SHARE_HOST.test(upiUrl);
    assert.equal(isGuarded, false,
      'upi:// must not be classified as a guarded channel; it must always pass through');
  });

  test('simulate mode: openExternal passes upi:// through (channel is null, guard not invoked)', () => {
    // Classification returns null → guard block is skipped → openURL called.
    // This is verified structurally: openExternal only blocks when channel !== null.
    assert.match(
      outboundSrc,
      /if\s*\(\s*channel\s*&&\s*!shouldDispatch\s*\(\s*channel\s*\)\s*\)/,
      'openExternal must gate on channel being non-null',
    );
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 8. consent.tsx — openStaticPage refactor: safe error handling present
// ═══════════════════════════════════════════════════════════════════════════

describe('consent.tsx — openStaticPage refactor audit', () => {

  test('calls openStaticPage, not Linking.openURL directly', () => {
    assert.match(consentSrc, /openStaticPage\s*\(/);
    assert.ok(!consentSrc.includes('Linking.openURL'), 'must not call Linking.openURL directly');
  });

  test('Linking is NOT imported from react-native', () => {
    const rnImport = consentSrc.match(/import\s*\{[^}]+\}\s*from\s*['"]react-native['"]/);
    assert.ok(rnImport, 'react-native import must exist');
    assert.ok(!rnImport[0].includes('Linking'), 'Linking must not be in the react-native import');
  });

  test('openStaticPage is imported from @/src/outbound', () => {
    assert.match(consentSrc, /import\s*\{[^}]*openStaticPage[^}]*\}\s*from\s*['"]@\/src\/outbound['"]/);
  });

  test('openStaticPage in outbound.ts has try/catch error handling', () => {
    const fnSrc = (() => {
      const start = outboundSrc.indexOf('export async function openStaticPage(');
      const braceStart = outboundSrc.indexOf('{', start);
      let d = 0;
      for (let i = braceStart; i < outboundSrc.length; i++) {
        if (outboundSrc[i] === '{') d++;
        else if (outboundSrc[i] === '}') { d--; if (d === 0) return outboundSrc.slice(braceStart, i + 1); }
      }
    })();
    assert.match(fnSrc, /try\s*\{/);
    assert.match(fnSrc, /catch/);
    assert.match(fnSrc, /Alert\.alert\s*\(/);
  });

  test('privacy policy link targets the correct live URL', () => {
    assert.match(consentSrc, /https:\/\/dhara\.msafesolutions\.com\/privacy\.html/);
  });

  test('privacy policy link uses read_full localised string as accessibilityLabel', () => {
    assert.match(consentSrc, /accessibilityLabel=\{strings\.read_full\}/);
  });

});
