import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../apiBase';

export type Helpline = {
  service_id: string; name: string; number: string; channel: string;
  categories: string[]; scope: string; hours: string; languages: string;
  source_url: string; verified_at: string | null; verified: boolean; active: boolean;
};
export type RightsCard = {
  card_id: string; scenario_key: string; language: string; situation: string;
  verdict: string; why: string; law: any[]; do_now: string[]; if_refused: string;
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
const CIRCLE_KEY = 'ws_trusted_circle';
const CODE_KEY = 'ws_code_phrase';
const PLAN_KEY = 'ws_safety_plan';
const CHECKIN_KEY = 'ws_checkin_enabled';

export type Contact = { id: string; name: string; phone: string };

export async function getCircle(): Promise<Contact[]> {
  const v = await AsyncStorage.getItem(CIRCLE_KEY); return v ? JSON.parse(v) : [];
}
export async function saveCircle(list: Contact[]): Promise<void> {
  await AsyncStorage.setItem(CIRCLE_KEY, JSON.stringify(list.slice(0, 3)));
}
export async function getCodePhrase(): Promise<string> {
  return (await AsyncStorage.getItem(CODE_KEY)) || '';
}
export async function saveCodePhrase(p: string): Promise<void> {
  await AsyncStorage.setItem(CODE_KEY, p);
}
export async function getPlan(): Promise<Record<string, string>> {
  const v = await AsyncStorage.getItem(PLAN_KEY); return v ? JSON.parse(v) : {};
}
export async function savePlan(ans: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(ans));
}
export async function getCheckin(): Promise<boolean> {
  return (await AsyncStorage.getItem(CHECKIN_KEY)) === '1';
}
export async function setCheckin(v: boolean): Promise<void> {
  await AsyncStorage.setItem(CHECKIN_KEY, v ? '1' : '0');
}
