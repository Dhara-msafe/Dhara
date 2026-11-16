import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { API_BASE as API } from './apiBase';
// B-25: the sign-in token is a bearer credential (anyone holding it can act as
// the user) and used to be written with a plain AsyncStorage.setItem(), which
// on Android/iOS is an unencrypted file on disk -- readable by anything with
// filesystem access to the app's sandbox (a rooted/jailbroken device, a backup
// extraction tool, another app via a misconfigured content provider). The
// `storage` helper already exists for exactly this (secureGet/secureSet/
// secureRemove -> Keychain on iOS, EncryptedSharedPreferences on Android; falls
// back to AsyncStorage on web, which has no OS keychain anyway) but auth.tsx
// wasn't using it for the token. See storage/index.ts's own "AUTH TOKENS" note.
import { storage } from '@/src/utils/storage';
// B002 fix: keep cover state clean across sign-in / sign-out transitions
import { deactivateCover } from './women/coverState';
import { useHeadOutWizard } from './women/headOutWizardStore';
import { CONSENT_ANON_KEY } from './consentStorage';
import { useLocationUploadQueue } from './safety/locationUploadQueue';

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

export type User = { id: string; email: string; name: string; phone?: string; language: string; state?: string | null; state_name?: string; is_grandfathered?: boolean; is_pro?: boolean; pro_since?: string | null; pro_samples_used?: number; pro_samples_limit?: number; pro_samples_remaining?: number; drafts_used?: number; drafts_free_limit?: number; drafts_remaining?: number; daily_queries_cap?: number | null; daily_queries_left?: number | null; daily_questions_cap?: number | null; daily_questions_left?: number | null; daily_voice_cap?: number | null; daily_voice_left?: number | null; terms_accepted?: boolean; terms_version?: string; terms_accepted_at?: string; is_guest?: boolean; guest_question_count?: number; guest_question_limit?: number; guest_expires_at?: string; photo_url?: string | null; has_password?: boolean };
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
  loginWithGoogle: () => Promise<boolean>;
  googleError: { message: string; minor: boolean } | null;
  clearGoogleError: () => void;
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
  // W1-J04: a failed Google sign-in on the web (the page returns from Google)
  // used to fail silently; the login screen now shows why.
  const [googleError, setGoogleError] = useState<{ message: string; minor: boolean } | null>(null);
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
              const r = await _fetchAuth(`${API}/api/auth/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sid }),
              });
              if (!r.ok) {
                setGoogleError({ message: await _extractError(r, 'Google sign-in failed. Please try again.'), minor: false });
              } else {
                const data = await r.json();
                const minorMsg = await _minorBlockedMessage(data.token);
                // W1-J04: same sign-in path as the app (persist links the earlier
                // consent and resets the previous account's cover state).
                if (minorMsg) setGoogleError({ message: minorMsg, minor: true });
                else await persist(data.token, data.user);
              }
            } catch (e: any) {
              setGoogleError({ message: e?.message || 'Google sign-in failed. Please try again.', minor: false });
            }
            // Clean the URL fragment
            window.history.replaceState(window.history.state, '', window.location.pathname);
          }
          setLoading(false);
          _resolveHydration();
          return;
        }
      }

      const [secureT, legacyT, u, l, a, v, vm] = await Promise.all([
        storage.secureGet<string | null>(TOKEN_KEY, null),
        // B-25: before this fix, the token was written as a raw (non-JSON)
        // string straight into AsyncStorage. Check for it once so an app
        // already installed on someone's phone doesn't get silently signed
        // out the moment this ships -- migrate it into the secure store and
        // remove the plaintext copy, rather than forcing a fresh login.
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
        AsyncStorage.getItem(LANG_KEY),
        AsyncStorage.getItem(AUTO_SPEAK_KEY),
        AsyncStorage.getItem(TTS_VOLUME_KEY),
        AsyncStorage.getItem(TTS_VOICE_KEY),
      ]);
      let t = secureT;
      if (!t && legacyT) {
        t = legacyT;
        try {
          await storage.secureSet(TOKEN_KEY, legacyT);
          await AsyncStorage.removeItem(TOKEN_KEY);
        } catch { /* best-effort migration; keep using the legacy token this session */ }
      }
      if (t) setToken(t);
      let hydratedUser: User | null = null;
      if (u) { hydratedUser = JSON.parse(u); setUser(hydratedUser); }
      _setActiveUserIdCache(hydratedUser);
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
      _resolveHydration();
      // W1-J06 (12 Nov 2026): the saved session was trusted without asking the
      // server, so an expired or revoked token still showed the signed-in app.
      // Check it once in the background: 401 -> sign out with "session expired";
      // OK -> refresh the saved profile; no network -> keep the saved session.
      if (t) {
        try {
          const r = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
          if (r.status === 401) {
            setSessionExpired(true);
            await logout();
          } else if (r.ok && _activeUserIdCache) {
            const fresh = await r.json();
            await AsyncStorage.setItem(USER_KEY, JSON.stringify(fresh));
            setUser(fresh);
          }
        } catch { /* offline: keep the saved session */ }
      }
    })();
  }, []);

  const persist = async (t: string, u: User) => {
    // B002 fix: clear the *previous* session's cover flag before switching
    // identity. Handles guest→auth, auth→guest, and auth-A→auth-B transitions.
    // Uses _activeUserIdCache (synchronous, always current) to avoid any
    // async gap where a concurrent session-switch could read a stale value.
    const prevScope = _activeUserIdCache || 'device';
    const newScope  = u.id  || 'device';
    if (prevScope !== newScope) {
      try { await deactivateCover(prevScope); } catch { /* best-effort */ }
    }
    // Update the synchronous identity cache FIRST, before any async
    // AsyncStorage I/O — see its own doc comment for why this ordering
    // matters (atomic capture for any concurrent on-device-storage read).
    _setActiveUserIdCache(u);
    // B-25: the token is a bearer credential -- store it in the Keychain /
    // EncryptedSharedPreferences, not a plain AsyncStorage file.
    await storage.secureSet(TOKEN_KEY, t);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    // W1-J01 / B-67: the consent given before sign-in was logged under an
    // anonymous id. Attach it to this account once, then forget the id so a
    // later account on this phone never claims it. Best-effort, never blocks.
    void (async () => {
      try {
        const anonId = await AsyncStorage.getItem(CONSENT_ANON_KEY);
        if (!anonId) return;
        const r = await fetch(`${API}/api/consent/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify({ anon_id: anonId }),
        });
        if (r.ok) await AsyncStorage.removeItem(CONSENT_ANON_KEY);
      } catch { /* best-effort */ }
    })();
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
        // Structured detail object (e.g. B-16 login lockout: { code, message,
        // retry_after_seconds }) — show its message verbatim.
        if (err?.detail && typeof err.detail === 'object' && !Array.isArray(err.detail)
            && typeof err.detail.message === 'string' && err.detail.message) {
          return err.detail.message;
        }
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
    // B-69: a server or gateway error with no readable reason (e.g. an HTML
    // 502/503 page while the backend restarts) used to show only the bare
    // fallback ("Registration failed"). Say what happened and what to do.
    if (r.status >= 500) {
      return `${fallback}. DHARA's server had a problem (error ${r.status}). Please try again in a moment.`;
    }
    return fallback;
  };

  // B-24: sign-in calls must not spin forever on a bad network.
  const NETWORK_MSG = 'Could not reach DHARA. Check your internet connection and try again.';
  const _fetchAuth = async (url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch {
      throw new Error(NETWORK_MSG);
    } finally {
      clearTimeout(timer);
    }
  };

  // B-35: an under-18 account gets 403 minor_blocked on every call. Detect it
  // before signing in, so the user sees the guardian message instead of an app
  // where nothing works.
  const _minorBlockedMessage = async (tok: string): Promise<string | null> => {
    try {
      const r = await _fetchAuth(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${tok}` } });
      if (r.status !== 403) return null;
      const body = await r.json().catch(() => null);
      const d = body?.detail;
      return d?.code === 'minor_blocked'
        ? (d.message || 'Please ask a parent or guardian to help you set up Dhara.')
        : null;
    } catch {
      return null;
    }
  };

  const login = async (email: string, password: string) => {
    const r = await _fetchAuth(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await _extractError(r, 'Login failed'));
    const data = await r.json();
    const minorMsg = await _minorBlockedMessage(data.token);
    if (minorMsg) {
      const err: any = new Error(minorMsg);
      err.code = 'minor_blocked';
      throw err;
    }
    await persist(data.token, data.user);
  };

  const register = async (email: string, password: string, name: string, phone: string, terms_accepted: boolean, terms_version: string) => {
    const r = await _fetchAuth(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, phone, terms_accepted, terms_version }),
    });
    if (!r.ok) throw new Error(await _extractError(r, 'Registration failed'));
    const data = await r.json();
    await persist(data.token, data.user);
  };

  const continueAsGuest = async (langCode?: string) => {
    const r = await _fetchAuth(`${API}/api/auth/guest`, {
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
        // W1-J07: if the user signed out while this request was in flight, do
        // not write their profile back onto the device.
        if (!_activeUserIdCache) return;
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
        setUser(u);
      }
    } catch {}
  };

  const logout = async () => {
    // B002 fix: capture the departing user's scope BEFORE clearing the cache,
    // then deactivate their cover flag so it does not persist to the next session.
    const prevScope = _activeUserIdCache || 'device';
    // Update the synchronous identity cache FIRST (see its doc comment) —
    // any on-device storage read/write that starts AFTER this line sees
    // "nobody signed in" immediately, even before the AsyncStorage
    // multiRemove below actually finishes.
    _setActiveUserIdCache(null);
    // Best-effort: clear the departing user's cover flag (B002 fix)
    try { await deactivateCover(prevScope); } catch { /* non-blocking */ }
    // P0-Fix1e: clear FIR session data on logout
    // B-60: Head Out data must not carry over to the next account on this phone.
    try { useHeadOutWizard.getState().reset(); } catch { /* non-blocking */ }
    // W1-J08 (12 Nov 2026): data that belongs to the departing account and
    // would otherwise reach the next account on this phone:
    //  - unsent Head Out location points (they hold this person's positions and
    //    retry forever with the next account's sign-in, getting 403);
    //  - unsent issue reports (they would be filed under the next account);
    //  - the pointer to an in-progress FIR draft and its module/language.
    try { useLocationUploadQueue.getState().clearAll(); } catch { /* non-blocking */ }
    // B-25: the token lives in the secure store now, not AsyncStorage.
    await storage.secureRemove(TOKEN_KEY);
    // Also clear any pre-migration plaintext copy, in case this device never
    // ran the hydration migration above (e.g. signed out before its next launch).
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.multiRemove([
      USER_KEY, 'fir_draft_state', 'gk_fir_session',
      'ws_head_out_session', 'dhara_head_out_recents_v1', 'dhara_head_out_wizard_draft',
      'dhara_loc_queue', 'issue_reports_pending_v1',
      'fir_active_session_v3', 'fir_selected_module_v1', 'fir_draft_lang_v3',
    ]);
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
      return false; // the page leaves for Google; sign-in finishes on return
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

    if (!callbackUrl) return false; // all three sources empty = genuine cancel

    // Emergent uses hash fragment: msafelegalaid://#session_id=...
    const m = callbackUrl.match(/[?#&]session_id=([^&#]+)/);
    if (!m) return false;

    const sid = decodeURIComponent(m[1]);
    if (usedSessionIds.current.has(sid)) return false; // dedup
    usedSessionIds.current.add(sid);

    const r = await _fetchAuth(`${API}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid }),
    });
    if (!r.ok) throw new Error(await _extractError(r, 'Google sign-in failed. Please try again.'));
    const data = await r.json();
    const minorMsg = await _minorBlockedMessage(data.token);
    if (minorMsg) {
      const err: any = new Error(minorMsg);
      err.code = 'minor_blocked';
      throw err;
    }
    await persist(data.token, data.user);
    return true;
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
    <Ctx.Provider value={{ token, user, loading, language, setLanguage, autoSpeak, setAutoSpeak, ttsVolume, setTtsVolume, ttsVoiceMode, setTtsVoiceMode, setUserState, login, register, continueAsGuest, loginWithGoogle, logout, refreshUser, hydrateSession: persist, sessionExpired, clearSessionExpired, forceLogout, googleError, clearGoogleError: () => setGoogleError(null) }}>
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
 * Synchronous, in-memory mirror of "who is signed in right now" — updated
 * the INSTANT persist()/logout() run (before their own AsyncStorage I/O),
 * so any code that reads it captures the exact identity active at the
 * moment it was called, with no async gap during which a concurrent
 * login/logout could change the answer mid-read. This is what
 * src/women/api.ts uses to namespace on-device data per account: reading
 * a plain in-memory variable is atomic in JS's single-threaded model
 * (no other code runs between "the function starts" and "it reads this
 * variable" unless THAT function itself awaits first) — the previous
 * design (re-reading AsyncStorage's USER_KEY async, on every call) had a
 * real race where a save initiated as Account A could finish writing
 * under Account B's key if an account switch landed in the gap.
 */
let _activeUserIdCache: string | null = null;
let _hydrationResolve: (() => void) | null = null;
let _hydrationDone = false;
const _hydrationPromise: Promise<void> = new Promise((resolve) => { _hydrationResolve = resolve; });

function _setActiveUserIdCache(u: User | null) {
  _activeUserIdCache = u?.id ?? null;
}
function _resolveHydration() {
  if (_hydrationDone) return;
  _hydrationDone = true;
  _hydrationResolve?.();
  _hydrationResolve = null;
}

/** Synchronous read of the active account id — null if nobody is signed in
 * (not even a guest session). Safe to call before hydration resolves (will
 * correctly return null, matching "missing identity" semantics); callers
 * that need to wait for the real persisted session first should await
 * whenAuthHydrated() before calling this. */
export function getActiveUserIdSync(): string | null {
  return _activeUserIdCache;
}
/** Resolves once the initial session-restore effect has run (or immediately
 * if it already has). Lets non-component modules avoid a brief false
 * "nobody is signed in" read on cold app start, before AsyncStorage's
 * persisted token/user has had a chance to load into memory. */
export function whenAuthHydrated(): Promise<void> {
  return _hydrationPromise;
}

/** @deprecated kept for any other remaining caller; prefer
 * getActiveUserIdSync() + whenAuthHydrated() for new code — this async
 * version re-reads AsyncStorage on every call and does not capture
 * identity atomically relative to a concurrent login/logout. */
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
