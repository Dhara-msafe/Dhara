/**
 * First-run permission setup — pure logic (no react-native import, so it
 * runs under node:test). RN glue lives in src/permissions/setup.ts.
 *
 * Asked once, right after the consent page on first launch: microphone,
 * location (while the app is open only) and notifications. Camera and photos
 * stay asked in context — most users rarely need them.
 */
export type PermissionKey = 'microphone' | 'location' | 'notifications';
export type PermissionOutcome = 'granted' | 'denied' | 'blocked' | 'unavailable';

/** Where onboarding continues after the setup screen (same values consent.tsx used). */
export type SetupNext = 'home' | 'signup' | 'guest' | 'login';

export function parseSetupNext(raw: unknown): SetupNext {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'home' || v === 'signup' || v === 'guest' ? v : 'login';
}

/** Map an expo permission response to our outcome. */
export function toOutcome(res: { granted?: boolean; status?: string; canAskAgain?: boolean } | null | undefined): PermissionOutcome {
  if (!res) return 'unavailable';
  if (res.granted || res.status === 'granted') return 'granted';
  return res.canAskAgain === false ? 'blocked' : 'denied';
}

export const PERMISSION_ITEMS: ReadonlyArray<{ key: PermissionKey; icon: string; title: string; why: string }> = [
  { key: 'microphone', icon: 'mic-outline', title: 'Microphone', why: 'Ask questions by voice and record evidence when you choose to.' },
  { key: 'location', icon: 'location-outline', title: 'Location', why: 'Share where you are in an emergency and find help nearby. Only while DHARA is open.' },
  { key: 'notifications', icon: 'notifications-outline', title: 'Notifications', why: 'Get alerts from your trusted circle and updates on your requests.' },
];

export const SETUP_COPY = {
  eyebrow: 'Before you start',
  title: 'Set up DHARA',
  intro: 'Allow these now so help works instantly when you need it. You can change them any time in your phone settings.',
  allow: 'Allow',
  skip: 'Skip for now',
  continue: 'Continue',
  blockedHint: 'Turned off in phone settings',
  openSettings: 'Open phone settings',
} as const;

/** Silent Alert: give up on a fresh GPS fix after this long. */
export const EMERGENCY_FIX_TIMEOUT_MS = 10_000;
/** Silent Alert: a last-known position older than this is not offered. */
export const LAST_KNOWN_MAX_AGE_MS = 10 * 60_000;

/**
 * Pick the position to share in an emergency: a fresh fix if one arrived in
 * time, otherwise the phone's last known position if it is recent enough.
 */
export function pickEmergencyFix<T extends { timestamp: number }>(
  fresh: T | null,
  lastKnown: T | null,
  nowMs: number,
): { point: T; stale: boolean } | null {
  if (fresh) return { point: fresh, stale: false };
  if (lastKnown && nowMs - lastKnown.timestamp <= LAST_KNOWN_MAX_AGE_MS) return { point: lastKnown, stale: true };
  return null;
}
