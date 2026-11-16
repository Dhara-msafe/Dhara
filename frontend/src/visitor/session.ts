/**
 * Visitor Mode — Session & Feature Flags
 * Stored locally; no server account required.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'dhara_visitor_session';

export type VisitorLang = {
  code: string;
  label: string;      // in English
  native: string;     // in the language itself
};

export type VisitorSession = {
  touristLang: VisitorLang;  // the tourist's own language
  indianState: string;        // e.g. "MH" — the state they are in
  indianStateName: string;
  createdAt: string;
};

export const TOURIST_LANGUAGES: VisitorLang[] = [
  { code: 'en',  label: 'English',    native: 'English' },
  { code: 'fr',  label: 'French',     native: 'Français' },
  { code: 'de',  label: 'German',     native: 'Deutsch' },
  { code: 'es',  label: 'Spanish',    native: 'Español' },
  { code: 'pt',  label: 'Portuguese', native: 'Português' },
  { code: 'it',  label: 'Italian',    native: 'Italiano' },
  { code: 'ja',  label: 'Japanese',   native: '日本語' },
  { code: 'ko',  label: 'Korean',     native: '한국어' },
  { code: 'zh',  label: 'Chinese',    native: '中文' },
  { code: 'ar',  label: 'Arabic',     native: 'العربية' },
  { code: 'ru',  label: 'Russian',    native: 'Русский' },
  { code: 'hi',  label: 'Hindi',      native: 'हिन्दी' },
];

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: 'MH', name: 'Maharashtra' },
  { code: 'DL', name: 'Delhi' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'KL', name: 'Kerala' },
  { code: 'WB', name: 'West Bengal' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'BR', name: 'Bihar' },
  { code: 'HP', name: 'Himachal Pradesh' },
  { code: 'UK', name: 'Uttarakhand' },
  { code: 'GA', name: 'Goa' },
  { code: 'PB', name: 'Punjab' },
  { code: 'HR', name: 'Haryana' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'TS', name: 'Telangana' },
  { code: 'JK', name: 'Jammu & Kashmir' },
  { code: 'AS', name: 'Assam' },
  { code: 'OD', name: 'Odisha' },
  { code: 'CH', name: 'Chandigarh (UT)' },
];

export async function saveVisitorSession(s: VisitorSession): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

export async function loadVisitorSession(): Promise<VisitorSession | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function clearVisitorSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

// B-86: a direct URL hit or a page refresh on a downstream visitor screen
// (intent/emergency/lost-passport) that never went through /visitor first
// has no session ever saved -- loadVisitorSession() resolves to null and
// stays null forever. Every one of those screens used to gate on
// `if (!session) return <spinner>`, which can't tell "still loading" apart
// from "confirmed there's no session" -- so a visitor landing directly on
// e.g. /visitor/emergency saw a spinner that never went away, with no
// fallback or redirect back to setup anywhere.
//
// This hook tracks the two states separately and redirects to /visitor
// (where a session gets created) the moment loading resolves to "no
// session", instead of spinning forever. The caller only ever sees
// VisitorSession | null -- null covers both "still loading" and
// "redirecting now", which look identical to the user (a spinner) either
// way, so screens don't need to change how they render for it.
export function useVisitorSessionOrRedirect(): VisitorSession | null {
  const router = useRouter();
  const [status, setStatus] = useState<
    { kind: 'loading' } | { kind: 'found'; session: VisitorSession } | { kind: 'missing' }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadVisitorSession().then(s => {
      if (cancelled) return;
      setStatus(s ? { kind: 'found', session: s } : { kind: 'missing' });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status.kind === 'missing') router.replace('/visitor');
  }, [status.kind, router]);

  return status.kind === 'found' ? status.session : null;
}

// ── State → "official's language" for the Two-Way Interpreter ─────────────
// DHARA-B021: the interpreter used to hard-code Hindi as the "official"
// language everywhere regardless of which state the tourist is actually in.
// Single source of truth so every screen (intent menu card, interpreter
// screen itself) stays in sync — states not listed here default to Hindi.
export type LocalLang = { code: string; label: string; native: string };
export const HINDI_LANG: LocalLang = { code: 'hi', label: 'Hindi', native: 'हिन्दी' };
export const STATE_LOCAL_LANG: Record<string, LocalLang> = {
  TN: { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  KA: { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  KL: { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  AP: { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  TS: { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  WB: { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  GJ: { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
  MH: { code: 'mr', label: 'Marathi', native: 'मराठी' },
  PB: { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  AS: { code: 'as', label: 'Assamese', native: 'অসমীয়া' },
  OD: { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ' },
  GA: { code: 'kok', label: 'Konkani', native: 'कोंकणी' },
  JK: { code: 'ur', label: 'Urdu', native: 'اردو' },
};
export function getStateLocalLang(stateCode?: string): LocalLang {
  return (stateCode && STATE_LOCAL_LANG[stateCode]) || HINDI_LANG;
}
