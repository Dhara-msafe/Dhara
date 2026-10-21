import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../apiBase';
import { getStoredPhrase, storePhrase } from './codePhraseStore';
import { getActiveUserId } from '../auth';

export type Helpline = {
  service_id: string; name: string; number: string; channel: string;
  categories: string[]; scope: string; hours: string; languages: string;
  source_url: string; verified_at: string | null; verified: boolean; active: boolean;
};
export type RightsCard = {
  card_id: string; scenario_key: string; language: string; situation: string;
  verdict: string; why: string; law: any[]; do_now: string[]; if_refused: string;
  original?: { verdict: string; why: string } | null;
  emergency: string | null; evidence_tips: string; release_state: string;
};
export type Flags = {
  women_shield_enabled: boolean; women_cards_min_release_state: string;
  discreet_mode_enabled: boolean; trusted_circle_enabled: boolean; evidence_locker_enabled: boolean;
};
export type RouteResult = { urgency: string; scenario_key: string | null; card: RightsCard | null; services: Helpline[] };

const base = `${API_BASE}/api/women`;

export async function fetchFlags(): Promise<Flags | null> {
  try { const r = await fetch(`${base}/flags`); return r.ok ? await r.json() : null; } catch { return null; }
}
export async function fetchHelplines(category?: string): Promise<Helpline[]> {
  try {
    const url = category ? `${base}/helplines?category=${category}` : `${base}/helplines`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const d = await r.json();
    return d.services || [];
  } catch { return []; }
}
export async function safetyRoute(body: { text?: string; lang: string; state?: string; scenario_key?: string }): Promise<RouteResult | null> {
  try {
    const r = await fetch(`${base}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// ── On-device safety data (DPDP: private, never leaves the device) ───────────
// These four keys used to be flat/global — one shared value for the WHOLE
// DEVICE regardless of which account was signed in. On a shared device,
// Account B could see Account A's saved Trusted Circle contacts (and
// safety-plan answers / check-in toggle / evidence preference) after
// switching accounts, because logout() never clears them and nothing
// scoped them by user. _scopedKey() namespaces every read/write by the
// CURRENTLY signed-in account id (falls back to a shared 'guest' bucket
// only when nobody is signed in at all — an inherent limit of unauthenticated
// local storage, not something fixable without requiring login).
//
// _migrateLegacyFlatKeyOnce() preserves whatever was already saved under
// the old flat key — copied, once, to whichever account happens to read it
// FIRST after this ships (exactly matching the old single-shared-list
// behaviour for that one account), guarded by its own marker key so it
// can never run a second time and leak into a later, different account.
const CIRCLE_KEY  = 'ws_trusted_circle';
const PLAN_KEY    = 'ws_safety_plan';
const CHECKIN_KEY = 'ws_checkin_enabled';

async function _scopedKey(base: string): Promise<string> {
  const uid = await getActiveUserId();
  return `${base}_${uid || 'guest'}`;
}

async function _migrateLegacyFlatKeyOnce(base: string): Promise<void> {
  const markerKey = `${base}_migrated_v1`;
  try {
    if (await AsyncStorage.getItem(markerKey)) return;
    const legacy = await AsyncStorage.getItem(base);
    if (legacy != null) {
      const scoped = await _scopedKey(base);
      const existing = await AsyncStorage.getItem(scoped);
      if (existing == null) await AsyncStorage.setItem(scoped, legacy);
    }
    await AsyncStorage.setItem(markerKey, '1');
  } catch {
    // best-effort only — migration must never block normal reads/writes
  }
}

export type Contact = { id: string; name: string; phone: string; email?: string; notify?: boolean };

export async function getCircle(): Promise<Contact[]> {
  await _migrateLegacyFlatKeyOnce(CIRCLE_KEY);
  const v = await AsyncStorage.getItem(await _scopedKey(CIRCLE_KEY));
  return v ? JSON.parse(v) : [];
}
export async function saveCircle(list: Contact[]): Promise<void> {
  await AsyncStorage.setItem(await _scopedKey(CIRCLE_KEY), JSON.stringify(list.slice(0, 3)));
}
/** @deprecated use getStoredPhrase() from codePhraseStore directly. */
export async function getCodePhrase(): Promise<string> {
  return getStoredPhrase();
}
/** @deprecated use storePhrase() from codePhraseStore directly. */
export async function saveCodePhrase(p: string): Promise<void> {
  await storePhrase(p);
}

// ── Silent Alert evidence preference ──────────────────────────────────────────
const SILENT_EVIDENCE_KEY = 'ws_silent_alert_evidence_pref';
/** Returns whether "Also start Evidence Recording" toggle is ON. */
export async function getSilentAlertEvidencePref(): Promise<boolean> {
  try {
    await _migrateLegacyFlatKeyOnce(SILENT_EVIDENCE_KEY);
    return (await AsyncStorage.getItem(await _scopedKey(SILENT_EVIDENCE_KEY))) === 'true';
  } catch { return false; }
}
/** Persist the "Also start Evidence Recording" toggle preference. */
export async function setSilentAlertEvidencePref(enabled: boolean): Promise<void> {
  try { await AsyncStorage.setItem(await _scopedKey(SILENT_EVIDENCE_KEY), enabled ? 'true' : 'false'); }
  catch {}
}
export async function getPlan(): Promise<Record<string, string>> {
  await _migrateLegacyFlatKeyOnce(PLAN_KEY);
  const v = await AsyncStorage.getItem(await _scopedKey(PLAN_KEY));
  return v ? JSON.parse(v) : {};
}
export async function savePlan(ans: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(await _scopedKey(PLAN_KEY), JSON.stringify(ans));
}
export async function getCheckin(): Promise<boolean> {
  await _migrateLegacyFlatKeyOnce(CHECKIN_KEY);
  return (await AsyncStorage.getItem(await _scopedKey(CHECKIN_KEY))) === '1';
}
export async function setCheckin(v: boolean): Promise<void> {
  await AsyncStorage.setItem(await _scopedKey(CHECKIN_KEY), v ? '1' : '0');
}
