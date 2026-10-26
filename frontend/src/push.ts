/**
 * Emergent-managed push notifications (SuprSend relay) — client side.
 *
 * Registration is USER-INITIATED ONLY (Settings -> "Push notifications"
 * toggle). We never request the OS permission on cold start - see
 * <handle_permissions_contract>: ask contextually, after clear intent, and
 * never dead-end the user if they decline.
 *
 * Uses the NATIVE device push token (getDevicePushTokenAsync), not Expo's
 * own push-token abstraction - the SuprSend relay talks to FCM/APNs
 * directly, which is exactly why an Android build needs a real
 * google-services.json before this can work on a device.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { API_BASE } from '@/src/auth';

export type PushPermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

// ── Notification-payload redaction ────────────────────────────────────────────
//
// DHARA must never reveal sensitive context on the lock screen.  We apply a
// two-layer redaction strategy:
//
//  LAYER 1 — Foreground interception (this file, all platforms):
//    When the app is open, we intercept every incoming notification, suppress
//    the original, and immediately re-schedule it with a generic title/body.
//    The original data payload is preserved so deep-links still work.
//
//  LAYER 2 — Server-side (required for lock-screen in background/killed state):
//    The SuprSend/FCM/APNs payload sent by the backend MUST use the generic
//    title "New message" and body "Tap to open."  The actual action_url lives
//    in the data payload (never in the visible title/body).
//    → Update the notification template in the SuprSend dashboard.
//    → Backend /api/notify calls should always pass:
//        title: "New message"
//        body:  "Tap to open."
//        data:  { action_url: "<real destination>" }
//
// LAYER 3 — App-switcher protection (expo-screen-capture, in _layout.tsx):
//    Prevents the OS from capturing a screenshot of sensitive screen content
//    when the user presses the home button or switches apps.

const REDACTED_TITLE = 'New message';
const REDACTED_BODY  = 'Tap to open.';

// Foreground behaviour: intercept, suppress original, re-schedule as generic.
// We set shouldShowBanner: false on the handler so the RAW notification is
// never displayed; then we fire our own generic scheduled notification below.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false, // suppress raw notification — we re-schedule below
    shouldShowList:   false,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
  }),
});

// Listener that fires the redacted replacement.
// The subscription is set up once at module load (same lifecycle as the handler).
Notifications.addNotificationReceivedListener((notification) => {
  // Preserve the original data payload so action_url tap-listeners still work.
  const originalData = notification.request.content.data ?? {};
  Notifications.scheduleNotificationAsync({
    content: {
      title: REDACTED_TITLE,
      body:  REDACTED_BODY,
      data:  originalData,
      sound: true,
    },
    trigger: null, // fire immediately
  }).catch(() => {
    // Scheduling failure must never crash the app.
  });
});

export async function getPushPermissionState(): Promise<PushPermissionState> {
  if (Platform.OS === 'web') return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  return status as PushPermissionState;
}

/**
 * Call this ONLY from a direct user action (e.g. tapping the Settings
 * toggle). Requests the OS permission if needed, then registers the native
 * device token with our backend for this user. Returns the resulting
 * permission info so the caller can render every state correctly
 * (granted / denied-but-askable / permanently-blocked).
 */
export async function enablePushNotifications(
  token: string,
  userId: string,
): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (Platform.OS === 'web') return { granted: false, canAskAgain: false };

  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') {
    if (perm.status === 'denied' && !perm.canAskAgain) {
      return { granted: false, canAskAgain: false };
    }
    perm = await Notifications.requestPermissionsAsync();
  }
  if (perm.status !== 'granted') {
    return { granted: false, canAskAgain: !!perm.canAskAgain };
  }

  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    await fetch(`${API_BASE}/api/register-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        user_id: userId,
        platform: Platform.OS,
        device_token: devicePushToken.data,
      }),
    });
  } catch {
    // Registration hiccup shouldn't block the rest of the app - the OS
    // permission is still granted; the user can just try the toggle again.
  }
  return { granted: true, canAskAgain: true };
}

/** Fires when the user taps a notification (foreground, background, or cold
 * start via getLastNotificationResponseAsync - call sites handle that). */
export function addNotificationTapListener(onTap: (actionUrl: string | null) => void) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const url = (response.notification.request.content.data as any)?.action_url ?? null;
    onTap(url);
  });
}
