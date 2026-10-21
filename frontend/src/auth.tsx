import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { API_BASE as API } from './apiBase';

// Required for iOS to properly complete the auth session
WebBrowser.maybeCompleteAuthSession();

// Routing is shared; all credential and session handling below stays unchanged.
const TOKEN_KEY = 'gk_token';
const USER_KEY = 'gk_user';
const LANG_KEY = 'gk_lang';
const MODEL_KEY = 'gk_model';
const AUTO_SPEAK_KEY = 'dhara_auto_speak';
const TTS_VOLUME_KEY = 'dhara_tts_volume';
const TTS_VOICE_KEY  = 'dhara_tts_voice';

export type User = { id: string; email: string; name: string; phone?: string; language: string; state?: string | null; state_name?: string; is_grandfathered?: boolean; is_pro?: boolean; pro_since?: string | null; pro_samples_used?: number; pro_samples_limit?: number; pro_samples_remaining?: number; drafts_used?: number; drafts_free_limit?: number; drafts_remaining?: number; daily_queries_cap?: number | null; daily_queries_left?: number | null; daily_questions_cap?: number | null; daily_questions_left?: number | null; daily_voice_cap?: number | null; daily_voice_left?: number | null; terms_accepted?: boolean; terms_version?: string; terms_accepted_at?: string; is_guest?: boolean; guest_question_count?: number; guest_question_limit?: number; guest_expires_at?: string };
export type Language = { code: string; name: string; native: string; tts: string };
export type ModelChoice = { label: string; recommended?: boolean };

type AuthCtx = {
  token: string | null;
  user: User | null;
  loading: boolean;
  language: Language;
  setLanguage: (l: Language) => Promise<void>;
  autoSpeak: boolean;
  setAutoSpeak: (v: boolean) => Promise<void>;
  /** Playback loudness for spoken answers, 0.0–1.0. Persisted across sessions. */
  ttsVolume: number;
  setTtsVolume: (v: number) => Promise<void>;
  /** Voice engine for spoken answers: cloud TTS or a free native Indian accent. */
  ttsVoiceMode: TtsVoiceMode;
  setTtsVoiceMode: (v: TtsVoiceMode) => Promise<void>;
  setUserState: (code: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, phone: string, terms_accepted: boolean, terms_version: string) => Promise<void>;
  /** Anonymous trial — no email/phone/password. Server enforces a 5-question quota + 24h expiry. */
  continueAsGuest: (language?: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hydrateSession: (token: string, user: User) => Promise<void>;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  forceLogout: () => Promise<void>;
};

export type TtsVoiceMode = 'cloud' | 'device-female' | 'device-male';
const DEFAULT_LANG: Language = { code: 'en', name: 'English', native: 'English', tts: 'en-IN' };

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANG);
  // Keep <html lang> in step with the selected language so screen readers pronounce web content correctly.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && language?.code) {
      document.documentElement.lang = language.code;
    }
  }, [language?.code]);
  const [autoSpeak, setAutoSpeakState] = useState<boolean>(true);
  const [ttsVolume, setTtsVolumeState] = useState<number>(1.0);
  const [ttsVoiceMode, setTtsVoiceModeState] = useState<TtsVoiceMode>('cloud');
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  // Guard: prevent the same session_id being exchanged twice on Android
  const usedSessionIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      // ── Web: detect session_id in URL before checking stored token ──
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const combined = window.location.hash + '&' + window.location.search;
        const m = combined.match(/[?#&]session_id=([^&#]+)/);
        if (m) {
          const sid = decodeURIComponent(m[1]);
          if (!usedSessionIds.current.has(sid)) {
            usedSessionIds.current.add(sid);
            try {
              const r = await fetch(`${API}/api/auth/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sid }),
              });
              if (r.ok) {
                const data = await r.json();
                await AsyncStorage.setItem(TOKEN_KEY, data.token);
                await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
                setToken(data.token);
                setUser(data.user);
              }
            } catch {}
            // Clean the URL fragment
            window.history.replaceState(window.history.state, '', window.location.pathname);
          }
          setLoading(false);
          return;
        }
      }

      const [t, u, l, a, v, vm] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
        AsyncStorage.getItem(LANG_KEY),
        AsyncStorage.getItem(AUTO_SPEAK_KEY),
        AsyncStorage.getItem(TTS_VOLUME_KEY),
        AsyncStorage.getItem(TTS_VOICE_KEY),
      ]);
      if (t) setToken(t);
      if (u) setUser(JSON.parse(u));
      if (l) setLanguageState(JSON.parse(l));
      if (a !== null) setAutoSpeakState(a === '1');
      if (v !== null) {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) setTtsVolumeState(Math.min(1, Math.max(0, n)));
      }
      if (vm === 'cloud' || vm === 'device-female' || vm === 'device-male') {
        setTtsVoiceModeState(vm);
      }
      setLoading(false);
    })();
  }, []);

  const persist = async (t: string, u: User) => {
    await AsyncStorage.setItem(TOKEN_KEY, t);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  /** Safely extract a human-readable error message from any fetch Response.
   *  Handles: JSON string detail, JSON array detail (Pydantic v2), plain text,
   *  and non-parseable bodies (e.g. HTML error pages from proxies).        */
  const _extractError = async (r: Response, fallback: string): Promise<string> => {
    try {
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const err = await r.json();
        if (typeof err?.detail === 'string' && err.detail) return err.detail;
        if (Array.isArray(err?.detail) && err.detail.length > 0) {
          const first = err.detail[0];
          const field = Array.isArray(first?.loc) ? String(first.loc[first.loc.length - 1] ?? '') : '';
          const msg   = typeof first?.msg === 'string' ? first.msg : '';
          return field && msg ? `${field}: ${msg}` : msg || fallback;
        }
        if (typeof err?.message === 'string' && err.message) return err.message;
      } else {
        // Non-JSON body (e.g. plain text or HTML from proxy) — discard it
        await r.text().catch(() => {});
      }
    } catch {
      // r.json() / r.text() itself threw (body already consumed or malformed)
    }
    return fallback;
  };

  const login = async (email: string, password: string) => {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await _extractError(r, 'Login failed'));
    const data = await r.json();
    await persist(data.token, data.user);
  };

  const register = async (email: string, password: string, name: string, phone: string, terms_accepted: boolean, terms_version: string) => {
    const r = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, phone, terms_accepted, terms_version }),
    });
    if (!r.ok) throw new Error(await _extractError(r, 'Registration failed'));
    const data = await r.json();
    await persist(data.token, data.user);
  };

  const continueAsGuest = async (langCode?: string) => {
    const r = await fetch(`${API}/api/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: langCode || language.code || 'en' }),
    });
    if (!r.ok) throw new Error(await _extractError(r, 'Could not start guest session'));
    const data = await r.json();
    await persist(data.token, data.user);
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const r = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) {
        await forceLogout();
        return;
      }
      if (r.ok) {
        const u = await r.json();
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
        setUser(u);
      }
    } catch {}
  };

  const logout = async () => {
    // P0-Fix1e: clear FIR session data on logout
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, 'fir_draft_state', 'gk_fir_session']);
    setToken(null);
    setUser(null);
  };

  // Any authenticated fetch call site should call this the moment it sees a
  // 401 — logs the user out AND flags sessionExpired (distinct from a plain
  // logout) so the login screen can show "Your session has expired" instead
  // of a bare form, per the "never dead-end the user" rule for auth failures.
  const forceLogout = useCallback(async () => {
    setSessionExpired(true);
    await logout();
  }, []);

  const clearSessionExpired = useCallback(() => setSessionExpired(false), []);

  const setLanguage = useCallback(async (l: Language) => {
    setLanguageState(l);
    await AsyncStorage.setItem(LANG_KEY, JSON.stringify(l));
  }, []);

  const setAutoSpeak = useCallback(async (v: boolean) => {
    setAutoSpeakState(v);
    await AsyncStorage.setItem(AUTO_SPEAK_KEY, v ? '1' : '0');
  }, []);

  const setTtsVolume = useCallback(async (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setTtsVolumeState(clamped);
    await AsyncStorage.setItem(TTS_VOLUME_KEY, String(clamped));
  }, []);

  const setTtsVoiceMode = useCallback(async (v: TtsVoiceMode) => {
    setTtsVoiceModeState(v);
    await AsyncStorage.setItem(TTS_VOICE_KEY, v);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    // Platform-specific redirect URL (critical per playbook)
    const redirectUrl = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? window.location.origin + '/' : '')
      : Linking.createURL('');

    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.location.href = authUrl;
      return;
    }

    // Register deep link listener BEFORE opening browser (Android fallback)
    let deepLinkUrl: string | null = null;
    const sub = Linking.addEventListener('url', (e) => { deepLinkUrl = e.url; });

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    sub.remove();

    // Per playbook: try result.url → listener → getInitialURL
    // Android often returns 'dismiss' even on success — don't treat as cancel yet
    const callbackUrl: string | null =
      (result as any).url || deepLinkUrl || await Linking.getInitialURL();

    if (!callbackUrl) return; // all three sources empty = genuine cancel

    // Emergent uses hash fragment: msafelegalaid://#session_id=...
    const m = callbackUrl.match(/[?#&]session_id=([^&#]+)/);
    if (!m) return;

    const sid = decodeURIComponent(m[1]);
    if (usedSessionIds.current.has(sid)) return; // dedup
    usedSessionIds.current.add(sid);

    const r = await fetch(`${API}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || 'Google sign-in failed');
    const data = await r.json();
    await persist(data.token, data.user);
  }, []);

  // Jurisdiction — state / UT decides rent, liquor, stamp duty and traffic fine
  // amounts, so the server needs it to serve the local rule with the answer.
  const setUserState = useCallback(async (code: string) => {
    if (!token) return;
    const r = await fetch(`${API}/api/auth/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ state: code }),
    });
    if (r.status === 401) {
      await forceLogout();
      throw new Error('Your session has expired — please sign in again');
    }
    if (!r.ok) throw new Error('Could not save your state');
    const data = await r.json();
    setUser((prev) => {
      const next = prev ? { ...prev, state: data.state, state_name: data.state_name } : prev;
      if (next) AsyncStorage.setItem(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, [token, forceLogout]);

  return (
    <Ctx.Provider value={{ token, user, loading, language, setLanguage, autoSpeak, setAutoSpeak, ttsVolume, setTtsVolume, ttsVoiceMode, setTtsVoiceMode, setUserState, login, register, continueAsGuest, loginWithGoogle, logout, refreshUser, hydrateSession: persist, sessionExpired, clearSessionExpired, forceLogout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}

/**
 * Fire-and-forget structured error report — captures the REAL error so a
 * failure gives a real diagnosis next time instead of another guessing
 * round, without ever surfacing the raw error to the user (callers keep
 * showing their own friendly message regardless of what this does).
 * Deliberately swallows its own failures — logging must never itself
 * become a second point of failure.
 */
export function logClientError(
  token: string | null,
  context: string,
  err: unknown,
  extra?: { retried?: boolean },
): void {
  if (!token) return;
  const e = err as any;
  const body = {
    context,
    error_name: e?.name ? String(e.name) : undefined,
    error_message: e?.message ? String(e.message).slice(0, 1000) : String(err ?? '').slice(0, 1000),
    platform: Platform.OS,
    retried: extra?.retried,
  };
  fetch(`${API}/api/client-error-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export const API_BASE = API;

/**
 * Reads the CURRENTLY signed-in account's id straight from the same
 * AsyncStorage key (`gk_user`) that `persist()`/`logout()` above already
 * write/remove on every login, refresh, and sign-out — the single source
 * of truth for "who is active right now", usable from plain (non-hook)
 * modules like src/women/api.ts to namespace on-device data per account.
 * Returns null if nobody is signed in (not even a guest session).
 */
export async function getActiveUserId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.id ?? null;
  } catch {
    return null;
  }
}
