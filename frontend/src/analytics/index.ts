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
// null  = not yet loaded (optimistically allow to avoid blocking the first event)
// true  = user has accepted analytics
// false = user has declined analytics (all sinks silenced)
let _analyticsConsent: boolean | null = null;

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
}

/**
 * Synchronously update the in-memory consent cache (call after consent dialog resolves).
 */
export function updateConsentCache(analyticsAllowed: boolean): void {
  _analyticsConsent = analyticsAllowed;
}

export function setPostHogInstance(instance: PostHogType): void {
  _posthog = instance;
}

function ph(): PostHogType | null {
  return _posthog;
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
 * DPDP compliance: silenced when analytics consent is explicitly false.
 * If consent has not been loaded yet (_analyticsConsent is null) the event
 * fires optimistically — call loadAnalyticsConsent() at login to resolve.
 */
export function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  // Consent gate — explicit false blocks all sinks
  if (_analyticsConsent === false) return;
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
 */
export async function identifyUser(
  userId: string,
  traits?: Record<string, unknown>,
): Promise<void> {
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
