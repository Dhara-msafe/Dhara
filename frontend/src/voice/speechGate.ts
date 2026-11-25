/**
 * Talk to DHARA — speech gate (RN glue around the pure voice core).
 *
 * The single place every DHARA-speech (TTS) call checks before playing. When
 * the flag EXPO_PUBLIC_VOICE_COMPANION_ENABLED is OFF this is inert:
 * canSpeakNow() returns true, so the app speaks exactly as it does today.
 *
 * When ON it enforces, via the already-tested maySpeakOn():
 *   - no spoken welcome until the user has chosen whether DHARA may speak;
 *   - Quiet (persisted, survives restart) — set ONLY by the user, through the
 *     Settings switch "Voice: read answers aloud";
 *   - no speech WHILE on Women's Shield screens (hub + /women/*); leaving
 *     restores the previous voice state, nothing is saved;
 *   - after a Quick exit, no speech until the next explicit tap (session only);
 *   - no auto-resume after a call, headphone unplug, app background or web tab
 *     switch — only an explicit user tap resumes;
 *   - on web, silence until the first tap on this page load.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { maySpeakOn, toVoicePlatform } from './core/voicePlatform';
import { reduceGate, INITIAL_GATE, type GateFlags } from './core/speechGateReducer';

export const VOICE_COMPANION_ENABLED = process.env.EXPO_PUBLIC_VOICE_COMPANION_ENABLED === 'true';

/** Shown when a tapped Listen is refused: names the real control. */
export const VOICE_OFF_HINT = 'Showing the answer as text. To hear answers, turn on "Voice: read answers aloud" in Settings.';

const K_QUIET = 'dhara_voice_quiet';
const K_PREF_KNOWN = 'dhara_voice_pref_known';
// Who set Quiet. 'user' = the Settings switch. Anything else (including a
// missing value) means the old Women's Shield code wrote it.
const K_QUIET_SOURCE = 'dhara_voice_quiet_source';

let flags: GateFlags = { ...INITIAL_GATE };
let speakingPreferenceKnown = false;
// Native apps don't need the browser first-tap rule; web starts silent.
let userGestureThisPageLoad = Platform.OS !== 'web';
let initialised = false;
// Women's Shield scope is reference-counted, so moving between the hub and a
// /women/* screen (blur of one, focus of the next, in either order) never
// flickers the gate open in between.
let shieldScopes = 0;
// Session-only: after a Quick exit nothing speaks until the next explicit tap.
let quietAfterQuickExit = false;

function platform() {
  return toVoicePlatform(Platform.OS);
}

/** Load persisted Quiet / preference and attach lifecycle listeners. Idempotent. */
export async function initSpeechGate(): Promise<void> {
  if (initialised) return;
  initialised = true;
  try {
    const [q, p, src] = await Promise.all([
      AsyncStorage.getItem(K_QUIET),
      AsyncStorage.getItem(K_PREF_KNOWN),
      AsyncStorage.getItem(K_QUIET_SOURCE),
    ]);
    if (q === 'true' && src !== 'user') {
      // Migration (22 Nov): a stale Quiet written by the old Women's Shield
      // code, not by the user (no UI could set Quiet before the Settings
      // switch existed). Clear it so voice comes back.
      AsyncStorage.removeItem(K_QUIET).catch(() => {});
    } else if (q === 'true') {
      flags = { ...flags, quiet: true };
    }
    speakingPreferenceKnown = p === 'true';
  } catch {
    // Non-fatal: default to not-quiet / preference-unknown.
  }

  AppState.addEventListener('change', (s: AppStateStatus) => {
    flags = reduceGate(flags, { type: 'app_state', state: s as any });
  });

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        flags = reduceGate(flags, { type: 'web_tab_hidden' });
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    const onFirstTap = () => {
      userGestureThisPageLoad = true;
      document.removeEventListener('pointerdown', onFirstTap);
      document.removeEventListener('keydown', onFirstTap);
    };
    document.addEventListener('pointerdown', onFirstTap, { once: true } as any);
    document.addEventListener('keydown', onFirstTap, { once: true } as any);
  }
}

/** Report a hardware/OS audio interruption (incoming call, headphone unplug). */
export function noteAudioInterruption(): void {
  flags = reduceGate(flags, { type: 'audio_interruption' });
}

/**
 * Call at the start of a USER-INITIATED speak (a tap): it marks the browser
 * gesture and clears any prior interruption so a fresh tap can speak — but it
 * never auto-resumes on its own — and marks the speaking preference as known
 * (the first explicit tap IS the user's consent to hear voice).
 */
export function noteSpeakIntent(): void {
  userGestureThisPageLoad = true;
  quietAfterQuickExit = false;
  flags = reduceGate(flags, { type: 'resume_requested' });
  speakingPreferenceKnown = true;
  AsyncStorage.setItem(K_PREF_KNOWN, 'true').catch(() => {});
}

/**
 * Ask DHARA auto-read (25 Nov): answers are read aloud by default, and the
 * Ask header's mute button is the user's control. Call this when the user
 * sends a question while auto-read is on (not muted):
 *   - the first-run "no speaking choice yet" block lifts — auto-read being
 *     on by default IS the starting choice now, and mute turns it off;
 *   - an OLDER interruption (app was backgrounded, the mic-permission dialog,
 *     a call that has ended) no longer blocks reading the NEW reply.
 * Still honoured, unchanged: the Settings "Voice: read answers aloud" switch
 * (Quiet), Women's Shield screens, Quick exit, and any interruption that
 * happens AFTER this call while the reply is loading. A reply that was cut
 * off is never restarted.
 */
export function noteAutoReadQuestion(): void {
  flags = reduceGate(flags, { type: 'resume_requested' });
  if (!speakingPreferenceKnown) {
    speakingPreferenceKnown = true;
    AsyncStorage.setItem(K_PREF_KNOWN, 'true').catch(() => {});
  }
}

/** Persisted Quiet toggle — the USER's choice (Settings switch). */
export async function setQuiet(v: boolean): Promise<void> {
  flags = { ...flags, quiet: v };
  try {
    await AsyncStorage.setItem(K_QUIET, v ? 'true' : 'false');
    await AsyncStorage.setItem(K_QUIET_SOURCE, 'user');
  } catch {}
}

/**
 * Settings "Voice: read answers aloud". ON = DHARA may speak (also records the
 * speaking choice, so the first-run block lifts); OFF = never speak, answers
 * show as text. Same gate canSpeakNow() reads.
 */
export async function setVoiceReadAloud(on: boolean): Promise<void> {
  await setQuiet(!on);
  if (on) await setSpeakingPreferenceKnown(true);
}

/** Current value for the Settings switch. */
export function isVoiceReadAloudOn(): boolean {
  return !flags.quiet && speakingPreferenceKnown;
}

export function isQuiet(): boolean {
  return flags.quiet;
}

/** Record that the user has made a speaking choice (removes the first-run block). */
export async function setSpeakingPreferenceKnown(v: boolean): Promise<void> {
  speakingPreferenceKnown = v;
  try { await AsyncStorage.setItem(K_PREF_KNOWN, v ? 'true' : 'false'); } catch {}
}

/**
 * Entering a Women's Shield screen: no speech WHILE there. In memory only —
 * never saved, never changes Quiet. Pair every call with leaveWomensShield().
 */
export async function enterWomensShield(): Promise<void> {
  shieldScopes += 1;
  flags = reduceGate(flags, { type: 'enter_womens_shield' });
}

/** Leaving a Women's Shield screen. When no Shield screen remains, the
 * previous voice state is back exactly as it was. */
export function leaveWomensShield(): void {
  shieldScopes = Math.max(0, shieldScopes - 1);
  if (shieldScopes === 0) flags = reduceGate(flags, { type: 'leave_womens_shield' });
}

/** Women's Shield screens for the voice gate: the hub and every /women/* screen. */
export function isWomensShieldRoute(pathname: string | null | undefined): boolean {
  return pathname === '/women-shield' || !!pathname?.startsWith('/women/');
}

/** Quick exit from a sensitive screen: no speech until the next explicit tap.
 * Session only — never saved. */
export function noteQuickExit(): void {
  quietAfterQuickExit = true;
}

/**
 * The one gate every DHARA-speech call passes. Returns true when the flag is
 * OFF (today's behaviour) or when every rule allows speaking.
 */
export function canSpeakNow(): boolean {
  if (!VOICE_COMPANION_ENABLED) return true;
  if (quietAfterQuickExit) return false;
  return maySpeakOn(platform(), {
    quiet: flags.quiet,
    speakingPreferenceKnown,
    inWomensShield: flags.inWomensShield,
    interruptedNotResumed: flags.interruptedNotResumed,
    userGestureThisPageLoad,
  }).speak;
}
