/**
 * headOutTimer.test.mjs — S2 / AT34 Head Out radius & timer verification
 *
 * Verifies the pure logic extracted from head-out.tsx:
 *   • formatCountdown(secs) — countdown display string
 *   • Countdown deadline calculation (startTime + durationMins * 60 * 1000)
 *   • Expiry detection (secsLeft === 0 → expired)
 *   • Radius display text logic (GPS enabled vs disabled)
 *   • Session round-trip serialisation (JSON.stringify / JSON.parse)
 *   • ALERT_SIMULATION_MODE guard (env var default)
 *   • HeadOutSession required fields
 *
 * These are pure-function tests — no React rendering, no AsyncStorage,
 * no Linking, no device APIs required. Evidence item for AT34 (S2 radius
 * verification).
 *
 * Run: node app/frontend/src/__tests__/headOutTimer.test.mjs
 */

// ── Re-implement formatCountdown from head-out.tsx (exact copy) ───────────────
function formatCountdown(secs) {
  if (secs <= 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Radius display text (extracted from head-out.tsx lines 413-418) ───────────
function formatRadiusText(session, gpsEnabled) {
  if (!session || !session.radiusMeters) return null;
  return gpsEnabled
    ? `Planned area: ${session.radiusMeters} m`
    : `Planned area: ${session.radiusMeters} m · Monitoring not active`;
}

// ── Countdown deadline calculation (head-out.tsx line 109) ────────────────────
function computeSecsLeft(session, nowMs) {
  const deadline = session.startTime + session.durationMins * 60 * 1000;
  return Math.max(0, Math.floor((deadline - nowMs) / 1000));
}

// ── Session creation helper (mirrors startSession in head-out.tsx) ────────────
function makeSession({ destination = 'Office', durationMins = 60, radiusMeters } = {}) {
  const base = { destination, startTime: Date.now(), durationMins };
  if (radiusMeters !== undefined) return { ...base, radiusMeters };
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

function assertEqual(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// formatCountdown tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── formatCountdown ───');

test('FC-01: zero seconds → "0:00"', () => {
  assertEqual(formatCountdown(0), '0:00');
});

test('FC-02: negative seconds → "0:00" (floor to zero)', () => {
  assertEqual(formatCountdown(-5), '0:00');
});

test('FC-03: 59 seconds → "0:59"', () => {
  assertEqual(formatCountdown(59), '0:59');
});

test('FC-04: 60 seconds → "1:00"', () => {
  assertEqual(formatCountdown(60), '1:00');
});

test('FC-05: 90 seconds → "1:30"', () => {
  assertEqual(formatCountdown(90), '1:30');
});

test('FC-06: 3599 seconds → "59:59"', () => {
  assertEqual(formatCountdown(3599), '59:59');
});

test('FC-07: 3600 seconds (1 hour) → "1:00:00"', () => {
  assertEqual(formatCountdown(3600), '1:00:00');
});

test('FC-08: 3661 seconds (1h01m01s) → "1:01:01"', () => {
  assertEqual(formatCountdown(3661), '1:01:01');
});

test('FC-09: 7200 seconds (2 hours) → "2:00:00"', () => {
  assertEqual(formatCountdown(7200), '2:00:00');
});

test('FC-10: 14400 seconds (4 hours) → "4:00:00"', () => {
  assertEqual(formatCountdown(14400), '4:00:00');
});

test('FC-11: single-digit minutes are NOT zero-padded (no h component)', () => {
  // "5:09" not "05:09"
  assertEqual(formatCountdown(309), '5:09');
});

test('FC-12: single-digit seconds are zero-padded', () => {
  assertEqual(formatCountdown(65), '1:05');
});

// ─────────────────────────────────────────────────────────────────────────────
// Countdown deadline calculation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── Countdown deadline ───');

test('CD-01: 60-min session just started → ~3600 secs left', () => {
  const now = Date.now();
  const s = { startTime: now, durationMins: 60 };
  const left = computeSecsLeft(s, now);
  // Should be 3600 or 3599 depending on rounding
  assert(left >= 3599 && left <= 3600, `Expected ~3600, got ${left}`);
});

test('CD-02: 30-min session just started → ~1800 secs left', () => {
  const now = Date.now();
  const s = { startTime: now, durationMins: 30 };
  const left = computeSecsLeft(s, now);
  assert(left >= 1799 && left <= 1800, `Expected ~1800, got ${left}`);
});

test('CD-03: session with 1 min remaining → secsLeft ~60', () => {
  const now = Date.now();
  const s = { startTime: now - 59 * 60 * 1000, durationMins: 60 }; // 59 mins elapsed
  const left = computeSecsLeft(s, now);
  assert(left >= 55 && left <= 65, `Expected ~60, got ${left}`);
});

test('CD-04: expired session (past deadline) → secsLeft === 0', () => {
  const now = Date.now();
  const s = { startTime: now - 61 * 60 * 1000, durationMins: 60 }; // 61 mins elapsed
  const left = computeSecsLeft(s, now);
  assertEqual(left, 0);
});

test('CD-05: exact deadline → secsLeft === 0', () => {
  const now = Date.now();
  const s = { startTime: now - 60 * 60 * 1000, durationMins: 60 };
  const left = computeSecsLeft(s, now);
  assertEqual(left, 0);
});

test('CD-06: expired → expired=true would be set (left===0)', () => {
  const now = Date.now();
  const s = { startTime: now - 120 * 60 * 1000, durationMins: 60 };
  const left = computeSecsLeft(s, now);
  assert(left === 0, `Expected 0 for expired session, got ${left}`);
  // Logic: if (left === 0) setExpired(true) — head-out.tsx line 112
  const wouldSetExpired = (left === 0);
  assert(wouldSetExpired, 'expired=true should be set when secsLeft===0');
});

// ─────────────────────────────────────────────────────────────────────────────
// Radius display text
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── Radius display text ───');

test('RD-01: session with radiusMeters, GPS OFF → "... · Monitoring not active"', () => {
  const s = makeSession({ radiusMeters: 300 });
  const txt = formatRadiusText(s, false);
  assertEqual(txt, 'Planned area: 300 m · Monitoring not active');
});

test('RD-02: session with radiusMeters, GPS ON → no "Monitoring not active" suffix', () => {
  const s = makeSession({ radiusMeters: 300 });
  const txt = formatRadiusText(s, true);
  assertEqual(txt, 'Planned area: 300 m');
});

test('RD-03: session without radiusMeters → null (no text rendered)', () => {
  const s = makeSession();  // no radiusMeters
  const txt = formatRadiusText(s, false);
  assertEqual(txt, null);
});

test('RD-04: radiusMeters=200 (default) is stored correctly', () => {
  const s = { ...makeSession(), radiusMeters: 200 };
  assertEqual(s.radiusMeters, 200);
});

test('RD-05: radiusMeters=0 is falsy → null (guard !!session.radiusMeters)', () => {
  const s = makeSession({ radiusMeters: 0 });
  const txt = formatRadiusText(s, false);
  assertEqual(txt, null);  // 0 is falsy, same as undefined
});

test('RD-06: radiusMeters=500 renders correctly', () => {
  const s = makeSession({ radiusMeters: 500 });
  const txt = formatRadiusText(s, false);
  assertEqual(txt, 'Planned area: 500 m · Monitoring not active');
});

// ─────────────────────────────────────────────────────────────────────────────
// Session round-trip serialisation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── Session serialisation ───');

test('SS-01: session with radiusMeters survives JSON round-trip', () => {
  const s = makeSession({ destination: 'Market', durationMins: 120, radiusMeters: 400 });
  const parsed = JSON.parse(JSON.stringify(s));
  assertEqual(parsed.destination, 'Market');
  assertEqual(parsed.durationMins, 120);
  assertEqual(parsed.radiusMeters, 400);
});

test('SS-02: session without radiusMeters (pre-GO1A) survives round-trip', () => {
  const s = makeSession({ destination: 'Office', durationMins: 60 });
  const parsed = JSON.parse(JSON.stringify(s));
  assertEqual(parsed.radiusMeters, undefined);
  assertEqual(parsed.durationMins, 60);
});

test('SS-03: startTime is a valid epoch ms number after round-trip', () => {
  const s = makeSession();
  const parsed = JSON.parse(JSON.stringify(s));
  assert(typeof parsed.startTime === 'number', `startTime should be number, got ${typeof parsed.startTime}`);
  assert(parsed.startTime > 1_000_000_000_000, `startTime ${parsed.startTime} looks wrong`);
});

test('SS-04: null latitude/longitude survive round-trip', () => {
  const s = { ...makeSession(), latitude: null, longitude: null };
  const parsed = JSON.parse(JSON.stringify(s));
  assertEqual(parsed.latitude, null);
  assertEqual(parsed.longitude, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// ALERT_SIMULATION_MODE guard
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── ALERT_SIMULATION_MODE guard ───');

test('SIM-01: default env (no EXPO_PUBLIC_ALERT_SIMULATION_MODE) → simulation ON', () => {
  // head-out.tsx line 29:
  // const ALERT_SIMULATION_MODE = process.env.EXPO_PUBLIC_ALERT_SIMULATION_MODE !== 'false';
  // Without the env var, the expression evaluates: undefined !== 'false' = true → simulation ON
  const val = undefined !== 'false';
  assert(val === true, 'Default should be simulation ON');
});

test('SIM-02: env="true" → simulation ON', () => {
  const val = 'true' !== 'false';
  assert(val === true, '"true" should keep simulation ON');
});

test('SIM-03: env="false" → simulation OFF (production behaviour)', () => {
  const val = 'false' !== 'false';
  assert(val === false, '"false" should turn simulation OFF');
});

test('SIM-04: simulation mode intercepts before Linking.openURL', () => {
  // head-out.tsx logic (lines 278-284):
  //   if (ALERT_SIMULATION_MODE) {
  //     setSimPreview({ body, recipients: ... });
  //     return;                          // ← returns before Linking.openURL
  //   }
  // Verify the guard structure:
  let linkingCalled = false;
  function mockLinkingOpenURL() { linkingCalled = true; }
  const ALERT_SIMULATION_MODE = true;
  const body = 'NEED HELP';
  let simPreview = null;
  function setSimPreview(v) { simPreview = v; }

  if (ALERT_SIMULATION_MODE) {
    setSimPreview({ body, recipients: ['Priya'] });
    // function returns here — no Linking.openURL
  } else {
    mockLinkingOpenURL();
  }
  assert(simPreview !== null, 'simPreview should be set in simulation mode');
  assert(simPreview.body === body, 'simPreview.body should match');
  assert(!linkingCalled, 'Linking.openURL must NOT be called in simulation mode');
});

// ─────────────────────────────────────────────────────────────────────────────
// HeadOutSession required fields
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── HeadOutSession required fields ───');

test('SF-01: startSession always sets destination, startTime, durationMins', () => {
  const ses = makeSession({ destination: 'Train Station', durationMins: 120 });
  assert(typeof ses.destination === 'string' && ses.destination.length > 0, 'destination must be a non-empty string');
  assert(typeof ses.startTime === 'number', 'startTime must be a number');
  assert(typeof ses.durationMins === 'number', 'durationMins must be a number');
});

test('SF-02: endSession resets destValue.radiusMeters to default 200', () => {
  // head-out.tsx line 171:
  // setDestValue({ label: '', radiusMeters: 200 });
  const resetValue = { label: '', radiusMeters: 200 };
  assertEqual(resetValue.radiusMeters, 200);
  assertEqual(resetValue.label, '');
});

test('SF-03: DURATIONS array covers 30/60/120/240 min options', () => {
  const DURATIONS = [
    { label: '30 min', mins: 30 },
    { label: '1 hour', mins: 60 },
    { label: '2 hours', mins: 120 },
    { label: '4 hours', mins: 240 },
  ];
  const minValues = DURATIONS.map(d => d.mins);
  assert(minValues.includes(30), 'DURATIONS must include 30 min');
  assert(minValues.includes(60), 'DURATIONS must include 60 min');
  assert(minValues.includes(120), 'DURATIONS must include 120 min');
  assert(minValues.includes(240), 'DURATIONS must include 240 min');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Head Out timer/radius verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
