/**
 * Crash reporting — stack traces only, never what the user typed.
 *
 * WHY THE CONFIG BELOW IS NOT THE DEFAULT ONE
 *
 * People use DHARA to write "my husband hit me", to store evidence, to enter
 * a locker PIN. Sentry's defaults would carry much of that off the device:
 * breadcrumbs record console output and navigation with its parameters, HTTP
 * breadcrumbs can carry request bodies, session replay and screenshots record
 * the screen itself, and sendDefaultPii attaches IP and user identity.
 *
 * Every one of those is turned off here, and anything that still slips into a
 * message or a URL is scrubbed in beforeSend. What leaves the device is the
 * error type, the stack, the app version, the OS version and the device model
 * — enough to fix a crash, and nothing about the person who hit it.
 *
 * INERT UNLESS TURNED ON. No DSN, or EXPO_PUBLIC_SENTRY_ENABLED not exactly
 * "true", and init() returns without doing anything. The DSN belongs in the
 * deployment Secrets, never in this repo.
 *
 * NOT A REPLACEMENT for the in-app issue reporter: that catches "this looks
 * wrong", which no crash reporter can see.
 *
 * BEFORE THIS IS SWITCHED ON IN PRODUCTION it needs the privacy policy and
 * the consent notice to name the processor. That is a legal decision, not an
 * engineering one, which is why the flag ships OFF everywhere.
 */
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
const ENABLED = process.env.EXPO_PUBLIC_SENTRY_ENABLED === 'true' && DSN.length > 0;

/** Anything that looks like a person: free text, ids, contact details. */
const SCRUBBED = '[scrubbed]';

/** Query strings and path segments can carry a draft, a name or a case id. */
function scrubUrl(url: string): string {
  try {
    const q = url.indexOf('?');
    return q === -1 ? url : `${url.slice(0, q)}?${SCRUBBED}`;
  } catch {
    return SCRUBBED;
  }
}

/**
 * Exported for the tests, and so the rules are readable in one place rather
 * than buried in an options object.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // No identity. An install-scoped id would still be a tracking handle, so
  // there is none at all.
  delete event.user;
  delete event.server_name;

  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
  }

  // A thrown Error can carry user text in its message ("failed to save draft:
  // <what they wrote>"). The type and the stack are what fix a crash.
  if (event.exception?.values) {
    for (const value of event.exception.values) {
      if (value.value) value.value = SCRUBBED;
    }
  }
  if (event.message) event.message = SCRUBBED;

  // Breadcrumbs are off, but belt and braces if a future option re-enables one.
  event.breadcrumbs = [];

  return event;
}

export function initCrashReporting(): void {
  if (!ENABLED) return;

  Sentry.init({
    dsn: DSN,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? 'unknown',

    // ── nothing about the person ──
    sendDefaultPii: false,

    // ── nothing about the screen ──
    attachScreenshot: false,
    attachViewHierarchy: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // ── nothing about what was typed or where they went ──
    maxBreadcrumbs: 0,
    enableCaptureFailedRequests: false,
    enableAutoPerformanceTracing: false,
    tracesSampleRate: 0,

    // crashes only, not a usage feed
    enableAutoSessionTracking: false,

    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
  });
}
