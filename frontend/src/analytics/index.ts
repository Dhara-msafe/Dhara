/**
 * DHARA Three-Layer Analytics
 *
 * Sinks:
 *   1. PostHog EU  — cross-platform (native + web)
 *   2. GA4 gtag.js — web-only (injected in +html.tsx)
 *   3. Cloudflare  — web-only (script tag in +html.tsx; fires automatically)
 *
 * DPDP Act 2023 compliance:
 *   - No raw PII (name / phone / email / Aadhaar) in any event
 *   - User IDs SHA-256 hashed before identify() calls
 *   - maskAllInputs enforced in PostHog session replay config
 *   - Only behavioural properties sent (screen, tap type, lengths)
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type PostHogType from 'posthog-react-native';
import { CONSENT_PREFS_KEY } from '../consentStorage';

// ── PostHog constants ─────────────────────────────────────────────────────
export const POSTHOG_API_KEY = 'phc_sRQRpeBn6TEPHJmZ7DfDxLVP68yExZv3UUMQckBcxAGD';
export const POSTHOG_OPTIONS = {
  host: 'https://eu.i.posthog.com',
  // Disable auto-pageview here; we fire screen_view manually via the
  // AnalyticsNavigationTracker hook so we can attach the language prop.
  capturePageview: false,
  // P0 containment (T08 — analytics-consent defect, 2026-10-26
  // remediation): PostHogProvider mounts at app root, before any consent
  // decision exists. `defaultOptIn: false` + `autocapture: false` make the
  // freshly-constructed client start in a non-capturing state — nothing is
  // transmitted until an explicit optIn() call below, which only happens
  // once consent is loaded/granted as `true`.
  defaultOptIn: false,
  autocapture: false,
  // Session replay masking — DPDP Act 2023 compliance:
  // ensures no form field values, text, or images are recorded.
  sessionReplay: {
    maskAllInputs: true,
    maskAllTextInputs: true,
    maskAllImages: true,
  },
} as const;

// ── Lazy singleton ─────────────────────────────────────────────────────────
// Using a lazy singleton avoids import-time initialisation and ensures the
// PostHogProvider (which calls new PostHog()) is always in charge on native.
let _posthog: PostHogType | null = null;

// ── DPDP consent gate ───────────────────────────────────────────────────────
// P0 containment (T08 — analytics-consent defect): previously `null`
// (not-yet-loaded, including the entire pre-login / pre-consent-dialog
// window) was treated as "allowed", so screen_view and other events fired
// optimistically before any consent decision existed. Analytics must now
// default CLOSED and only open once consent is explicitly resolved to
// `true` — see trackEvent()/ga4()'s `!== true` check below.
// null  = not yet loaded / not yet decided — BLOCKED (fail closed)
// true  = user has explicitly accepted analytics — the only state that unblocks sinks
// false = user has declined/withdrawn analytics — all sinks silenced
let _analyticsConsent: boolean | null = null;
let _webScriptsLoaded = false;

/**
 * Applies a resolved consent value to every sink: syncs the PostHog
 * opt-in/opt-out state (PostHogProvider starts with `defaultOptIn: false`,
 * so nothing is captured until this explicitly opts in), and — on web only
 * — lazily injects the GA4/Cloudflare script tags for the first time
 * consent is confirmed `true` (they are never present in the static HTML
 * template at all; see app/+html.tsx and loadWebAnalyticsScriptsIfConsented()).
 * Opting out also asks PostHog to drop anything queued but not yet sent.
 */
function _applyConsentSideEffects(consent: boolean): void {
  try {
    if (consent) {
      ph()?.optIn();
      loadWebAnalyticsScriptsIfConsented();
    } else {
      // optOut() both stops future capture AND discards the in-memory
      // event queue per the PostHog RN SDK's documented opt-out behaviour
      // — satisfies "clear queued optional events on withdrawal".
      ph()?.optOut();
    }
  } catch {}
}

/**
 * Load the stored consent preferences for the given user and cache the result.
 * Call this once after login / consent changes so trackEvent checks are sync.
 */
export async function loadAnalyticsConsent(userId?: string): Promise<void> {
  try {
    const key = userId ? `${CONSENT_PREFS_KEY}:${userId}` : CONSENT_PREFS_KEY;
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const prefs = JSON.parse(raw) as { core: boolean; analytics: boolean; updates: boolean };
      _analyticsConsent = !!prefs.analytics;
    } else {
      // No stored preference — treat as not-consented (conservative default)
      _analyticsConsent = false;
    }
  } catch {
    _analyticsConsent = false;
  }
  _applyConsentSideEffects(_analyticsConsent === true);
}

/**
 * Synchronously update the in-memory consent cache (call after consent dialog resolves).
 */
export function updateConsentCache(analyticsAllowed: boolean): void {
  _analyticsConsent = analyticsAllowed;
  _applyConsentSideEffects(analyticsAllowed);
}

export function setPostHogInstance(instance: PostHogType): void {
  _posthog = instance;
}

function ph(): PostHogType | null {
  return _posthog;
}

// ── Web-only: consent-gated script loading ─────────────────────────────────
/**
 * GA4 (gtag.js) and the Cloudflare beacon used to be loaded unconditionally
 * as static <script> tags in app/+html.tsx — i.e. on every web page load,
 * before any consent decision could possibly exist. They are no longer
 * present there at all (see +html.tsx). This function injects them into
 * `document.head`, exactly once, ONLY after analytics consent has been
 * explicitly resolved to `true`. A no-op on native / SSR (no `document`).
 */
function loadWebAnalyticsScriptsIfConsented(): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  if (_webScriptsLoaded) return;
  _webScriptsLoaded = true;
  try {
    const gtagLib = document.createElement('script');
    gtagLib.async = true;
    gtagLib.src = 'https://www.googletagmanager.com/gtag/js?id=G-JDVMP7PKCV';
    document.head.appendChild(gtagLib);

    const gtagInit = document.createElement('script');
    gtagInit.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-JDVMP7PKCV', { send_page_view: false });
    `;
    document.head.appendChild(gtagInit);

    const cfBeacon = document.createElement('script');
    cfBeacon.defer = true;
    cfBeacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    cfBeacon.setAttribute('data-cf-beacon', '{"token": "4bf7b3812e52441981becae529ef1f18"}');
    document.head.appendChild(cfBeacon);
  } catch {}
}

// ── DPDP helper: SHA-256 hash ────────────────────────────────────────────
/**
 * Returns a lowercase hex SHA-256 digest of the input string.
 * Used to pseudonymise user IDs before they reach any analytics sink.
 * Falls back to a simple FNV-1a hash if Crypto is unavailable.
 */
export async function hashId(raw: string): Promise<string> {
  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      raw,
      { encoding: Crypto.CryptoEncoding.HEX },
    );
  } catch {
    // Fallback: deterministic but NOT cryptographically strong — only used
    // if expo-crypto fails (e.g. extreme OEM restriction).
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}

// ── GA4 helper (web only) ─────────────────────────────────────────────────
function ga4(eventName: string, params?: Record<string, unknown>): void {
  if (Platform.OS !== 'web') return;
  try {
    const gtag = (globalThis as any).gtag;
    if (typeof gtag === 'function') {
      gtag('event', eventName, params ?? {});
    }
  } catch {}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fire a named event to PostHog (all platforms) + GA4 (web only).
 * Properties must NEVER contain raw PII. Pass lengths, booleans, and codes.
 *
 * P0 containment (T08): fail CLOSED. Only an explicitly resolved `true`
 * consent unblocks any sink — `null` (not yet loaded/decided) and `false`
 * (declined/withdrawn) both silence every sink. Previously only `false`
 * blocked, so every event before consent was ever loaded (the entire
 * pre-login window, and any gap before loadAnalyticsConsent() resolves)
 * fired optimistically — exactly the "transmit before consent is resolved
 * and granted" defect this batch was opened to contain.
 */
export function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  if (_analyticsConsent !== true) return;
  // PostHog
  try {
    ph()?.capture(eventName, properties);
  } catch {}
  // GA4 web
  ga4(eventName, properties);
}

/**
 * Associate the current device with a pseudonymous user ID.
 * The raw userId is SHA-256 hashed before it leaves the device.
 *
 * P0 containment (T08): gated the same as trackEvent() — identify() itself
 * transmits the hashed ID to PostHog/GA4, so it must not fire before
 * consent is explicitly `true` either.
 */
export async function identifyUser(
  userId: string,
  traits?: Record<string, unknown>,
): Promise<void> {
  if (_analyticsConsent !== true) return;
  const hashedId = await hashId(userId);
  try {
    ph()?.identify(hashedId, traits);
  } catch {}
  // GA4: set hashed user_id
  if (Platform.OS === 'web') {
    try {
      const gtag = (globalThis as any).gtag;
      if (typeof gtag === 'function') {
        gtag('set', { user_id: hashedId });
      }
    } catch {}
  }
}

/**
 * Reset analytics identity on logout.
 * Clears the PostHog distinct ID so future events are anonymous again.
 */
export function resetAnalyticsIdentity(): void {
  try {
    ph()?.reset();
  } catch {}
  // GA4: clear user_id
  if (Platform.OS === 'web') {
    try {
      const gtag = (globalThis as any).gtag;
      if (typeof gtag === 'function') {
        gtag('set', { user_id: undefined });
      }
    } catch {}
  }
}
