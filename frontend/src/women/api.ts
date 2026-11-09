import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../apiBase';
import { getStoredPhrase, storePhrase } from './codePhraseStore';
import { getActiveUserIdSync, whenAuthHydrated } from '../auth';

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
// switching accounts, because logout() never cleared them and nothing
// scoped them by user.
//
// Fix, in two independent parts:
//
// 1) _identityKeyOrNull() namespaces every read/write by the account id
//    captured SYNCHRONOUSLY via getActiveUserIdSync() (see auth.tsx) — no
//    async re-read of storage mid-operation, so a save initiated as
//    Account A can never land under Account B's key just because an
//    account switch happened while the write was in flight. When nobody
//    is signed in (sync cache is null, even after hydration), this
//    returns null: callers FAIL CLOSED (empty read, write silently
//    skipped) rather than falling back to any shared/guest bucket — a
//    shared bucket is exactly the same class of bug this fix closes, just
//    with a smaller blast radius (anonymous visitors instead of named
//    accounts), so it is refused outright rather than reintroduced.
//
// 2) _quarantineLegacyOnce() handles the pre-existing flat-key data left
//    over from before this fix shipped. Its ownership cannot be
//    determined — the old key recorded no owner at all — so it is NEVER
//    copied into any account's live, readable storage automatically.
//    Instead it is moved, once (marker-guarded, idempotent, safe to
//    interrupt/retry), into a private "*_legacy_unclaimed_v1" key that no
//    get*() function ever reads and no screen ever displays or grants
//    permissions from. The data is preserved (not deleted — satisfies
//    "do not lose existing data") but inert until a possible future
//    explicit "recover my old contacts" flow is built that requires the
//    user to affirmatively confirm ownership before anything is restored.
const CIRCLE_KEY  = 'ws_trusted_circle';
const PLAN_KEY    = 'ws_safety_plan';
const CHECKIN_KEY = 'ws_checkin_enabled';

async function _identityKeyOrNull(storeBase: string): Promise<string | null> {
  await whenAuthHydrated();
  const uid = getActiveUserIdSync();
  return uid ? `${storeBase}_${uid}` : null;
}

async function _quarantineLegacyOnce(storeBase: string): Promise<void> {
  const markerKey      = `${storeBase}_legacy_quarantined_v1`;
  const quarantineKey  = `${storeBase}_legacy_unclaimed_v1`;
  try {
    if (await AsyncStorage.getItem(markerKey)) return;   // already handled — never repeat, never re-quarantine
    const legacy = await AsyncStorage.getItem(storeBase);
    if (legacy != null) {
      // Preserve under the private key only if nothing is already parked
      // there (idempotent against an interrupted/retried run), THEN clear
      // the old flat slot so no other code path can read it either.
      const alreadyParked = await AsyncStorage.getItem(quarantineKey);
      if (alreadyParked == null) await AsyncStorage.setItem(quarantineKey, legacy);
      await AsyncStorage.removeItem(storeBase);
    }
    await AsyncStorage.setItem(markerKey, '1');
  } catch {
    // Best-effort only. If this throws partway (e.g. app killed mid-write),
    // the marker is simply not set yet — next call retries from scratch,
    // which is safe because every step above is itself idempotent.
  }
}

/** Defensive JSON parse for on-device data: corrupt/partial/unexpected
 * content must never crash a screen — treat it as "no saved data" rather
 * than throwing. */
function _safeParse<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export type Contact = { id: string; name: string; phone: string; email?: string; relationship?: string; notify?: boolean };

export async function getCircle(): Promise<Contact[]> {
  await _quarantineLegacyOnce(CIRCLE_KEY);
  const key = await _identityKeyOrNull(CIRCLE_KEY);
  if (!key) return [];
  return _safeParse<Contact[]>(await AsyncStorage.getItem(key), []);
}
export async function saveCircle(list: Contact[]): Promise<void> {
  const key = await _identityKeyOrNull(CIRCLE_KEY);
  if (!key) return;   // fail closed — refuse to persist without a known identity
  await AsyncStorage.setItem(key, JSON.stringify(list.slice(0, 3)));
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
    await _quarantineLegacyOnce(SILENT_EVIDENCE_KEY);
    const key = await _identityKeyOrNull(SILENT_EVIDENCE_KEY);
    if (!key) return false;
    return (await AsyncStorage.getItem(key)) === 'true';
  } catch { return false; }
}
/** Persist the "Also start Evidence Recording" toggle preference. */
export async function setSilentAlertEvidencePref(enabled: boolean): Promise<void> {
  try {
    const key = await _identityKeyOrNull(SILENT_EVIDENCE_KEY);
    if (!key) return;
    await AsyncStorage.setItem(key, enabled ? 'true' : 'false');
  } catch {}
}
export async function getPlan(): Promise<Record<string, string>> {
  await _quarantineLegacyOnce(PLAN_KEY);
  const key = await _identityKeyOrNull(PLAN_KEY);
  if (!key) return {};
  return _safeParse<Record<string, string>>(await AsyncStorage.getItem(key), {});
}
export async function savePlan(ans: Record<string, string>): Promise<void> {
  const key = await _identityKeyOrNull(PLAN_KEY);
  if (!key) return;
  await AsyncStorage.setItem(key, JSON.stringify(ans));
}
export async function getCheckin(): Promise<boolean> {
  await _quarantineLegacyOnce(CHECKIN_KEY);
  const key = await _identityKeyOrNull(CHECKIN_KEY);
  if (!key) return false;
  return (await AsyncStorage.getItem(key)) === '1';
}
export async function setCheckin(v: boolean): Promise<void> {
  const key = await _identityKeyOrNull(CHECKIN_KEY);
  if (!key) return;
  await AsyncStorage.setItem(key, v ? '1' : '0');
}

// ── Nearest Help — in-app Places (New) search pilot (default OFF) ──────────
// Same FEATURE_GOOGLE_PLACES_V1 pilot as destination search. Both calls
// THROW on any non-2xx/network error so the caller can fail closed to the
// pre-existing "open in external Maps" action — never a silent provider
// swap. Results are raw Google Places data, never labelled as officially
// verified government facilities.
export type NearbyPlace = {
  place_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  distance_meters: number | null;
};

export async function fetchNearbyPlaces(
  category: 'police' | 'hospital', lat: number, lng: number,
): Promise<NearbyPlace[]> {
  const r = await fetch(
    `${API_BASE}/api/geo/nearby?category=${category}&lat=${lat}&lng=${lng}`
  );
  if (!r.ok) throw new Error(`geo_nearby_${r.status}`);
  const j = await r.json();
  return j.results ?? [];
}

export async function fetchPlacesTextSearch(
  query: string, lat?: number, lng?: number,
): Promise<NearbyPlace[]> {
  const loc = (lat != null && lng != null) ? `&lat=${lat}&lng=${lng}` : '';
  const r = await fetch(`${API_BASE}/api/geo/search-text?query=${encodeURIComponent(query)}${loc}`);
  if (!r.ok) throw new Error(`geo_search_text_${r.status}`);
  const j = await r.json();
  return j.results ?? [];
}