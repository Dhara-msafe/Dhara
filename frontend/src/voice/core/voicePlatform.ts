/**
 * Talk to DHARA — platform rules for Android, iPhone and web (C15 v3).
 *
 * Pure TypeScript. The caller passes `Platform.OS` from react-native; this
 * file never imports it, so it stays testable under `node --test`.
 *
 * Same journey on all three: tap to talk, editable transcript, selective
 * confirmation, released answer, draft saved not submitted. What differs is
 * listed here so screens never guess.
 */

import { maySpeak, retentionFor, type RetentionDecision, type RetentionInput, type SpeakContext, type SpeakDecision } from './voicePolicy';

export type VoicePlatform = 'android' | 'ios' | 'web';

export type VoiceCapabilities = {
  /** In-app tap-to-talk. True on all three (web needs HTTPS + permission). */
  tapToTalk: boolean;
  /** Which recorder the existing code uses on this platform. */
  recorder: 'expo-audio' | 'MediaRecorder';
  /** Browser autoplay rules: first spoken reply must follow a user tap. */
  ttsNeedsUserGesture: boolean;
  /** Can the app tell whether the device has a screen lock?
   * Android/iOS: only after adding expo-local-authentication (approval needed). */
  screenLockDetectable: 'needs_expo_local_authentication' | 'never';
  /** Release the mic when the app/tab goes to the background. Always true. */
  releaseMicInBackground: true;
  /** System entry point, later phase only. */
  systemEntryLater: 'android_launcher_shortcut' | 'ios_app_intents_shortcuts' | 'none';
  /** Never in the pilot on any platform. */
  wakeWord: false;
  backgroundListening: false;
  /** Evidence Locker capture available on this platform. Web must not
   * present itself as native evidence capture. */
  evidenceLocker: 'native' | 'limited_web';
};

const CAPS: Record<VoicePlatform, VoiceCapabilities> = {
  android: {
    tapToTalk: true,
    recorder: 'expo-audio',
    ttsNeedsUserGesture: false,
    screenLockDetectable: 'needs_expo_local_authentication',
    releaseMicInBackground: true,
    systemEntryLater: 'android_launcher_shortcut',
    wakeWord: false,
    backgroundListening: false,
    evidenceLocker: 'native',
  },
  ios: {
    tapToTalk: true,
    recorder: 'expo-audio',
    ttsNeedsUserGesture: false,
    screenLockDetectable: 'needs_expo_local_authentication',
    releaseMicInBackground: true,
    systemEntryLater: 'ios_app_intents_shortcuts',
    wakeWord: false,
    backgroundListening: false,
    evidenceLocker: 'native',
  },
  web: {
    tapToTalk: true,
    recorder: 'MediaRecorder',
    ttsNeedsUserGesture: true,
    screenLockDetectable: 'never',
    releaseMicInBackground: true,
    systemEntryLater: 'none',
    wakeWord: false,
    backgroundListening: false,
    evidenceLocker: 'limited_web',
  },
};

export function toVoicePlatform(os: string): VoicePlatform {
  if (os === 'ios') return 'ios';
  if (os === 'web') return 'web';
  return 'android';
}

export function capabilitiesFor(p: VoicePlatform): VoiceCapabilities {
  return CAPS[p];
}

/**
 * Speech gate with the platform rule added: on web, nothing is spoken until
 * the user has tapped something on this page load (browser autoplay rules,
 * and no surprise audio on a shared computer).
 */
export function maySpeakOn(
  p: VoicePlatform,
  ctx: SpeakContext & { userGestureThisPageLoad: boolean },
): SpeakDecision {
  if (CAPS[p].ttsNeedsUserGesture && !ctx.userGestureThisPageLoad) {
    return { speak: false, reason: 'web_needs_user_gesture' };
  }
  return maySpeak(ctx);
}

/**
 * Retention with the platform rule added: web can never prove the device is
 * locked or personal (cyber cafes, shared family computers), so it never
 * keeps a matter between sessions.
 */
export function retentionOn(p: VoicePlatform, i: RetentionInput): RetentionDecision {
  if (CAPS[p].screenLockDetectable === 'never') return 'session_only';
  return retentionFor(i);
}

/** Release the mic whenever the app or tab leaves the foreground. */
export function mustReleaseMic(appState: 'active' | 'background' | 'inactive' | 'hidden'): boolean {
  return appState !== 'active';
}
