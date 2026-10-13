/**
 * Talk to DHARA — speech gate (RN glue around the pure voice core).
 *
 * The single place every DHARA-speech (TTS) call checks before playing. When
 * the flag EXPO_PUBLIC_VOICE_COMPANION_ENABLED is OFF this is inert:
 * canSpeakNow() returns true, so the app speaks exactly as it does today.
 *
 * When ON it enforces, via the already-tested maySpeakOn():
 *   - no spoken welcome until the user has chosen whether DHARA may speak;
 *   - Quiet (persisted, survives restart);
 *   - Women's Shield forces Quiet on;
 *   - no auto-resume after a call, headphone unplug, app background or web tab
 *     switch — only an explicit user tap resumes;
 *   - on web, silence until the first tap on this page load.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { maySpeakOn, toVoicePlatform } from './core/voicePlatform';
import { reduceGate, INITIAL_GATE, type GateFlags } from './core/speechGateReducer';

export const VOICE_COMPANION_ENABLED = process.env.EXPO_PUBLIC_VOICE_COMPANION_ENABLED === 'true';

const K_QUIET = 'dhara_voice_quiet';
const K_PREF_KNOWN = 'dhara_voice_pref_known';

let flags: GateFlags = { ...INITIAL_GATE };
let speakingPreferenceKnown = false;
// Native apps don't need the browser first-tap rule; web starts silent.
let userGestureThisPageLoad = Platform.OS !== 'web';
let initialised = false;

function platform() {
  return toVoicePlatform(Platform.OS);
}

/** Load persisted Quiet / preference and attach lifecycle listeners. Idempotent. */
export async function initSpeechGate(): Promise<void> {
  if (initialised) return;
  initialised = true;
  try {
    const [q, p] = await Promise.all([
      AsyncStorage.getItem(K_QUIET),
      AsyncStorage.getItem(K_PREF_KNOWN),
    ]);
    if (q === 'true') flags = { ...flags, quiet: true };
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
 * never auto-resumes on its own.
 */
export function noteSpeakIntent(): void {
  userGestureThisPageLoad = true;
  flags = reduceGate(flags, { type: 'resume_requested' });
}

/** Persisted Quiet toggle. */
export async function setQuiet(v: boolean): Promise<void> {
  flags = { ...flags, quiet: v };
  try { await AsyncStorage.setItem(K_QUIET, v ? 'true' : 'false'); } catch {}
}

export function isQuiet(): boolean {
  return flags.quiet;
}

/** Record that the user has made a speaking choice (removes the first-run block). */
export async function setSpeakingPreferenceKnown(v: boolean): Promise<void> {
  speakingPreferenceKnown = v;
  try { await AsyncStorage.setItem(K_PREF_KNOWN, v ? 'true' : 'false'); } catch {}
}

/** Entering Women's Shield forces Quiet on (persisted); never turns it off. */
export async function enterWomensShield(): Promise<void> {
  flags = reduceGate(flags, { type: 'enter_womens_shield' });
  try { await AsyncStorage.setItem(K_QUIET, 'true'); } catch {}
}

/** Leaving the Shield clears only the in-session flag; Quiet stays as chosen. */
export function leaveWomensShield(): void {
  flags = { ...flags, inWomensShield: false };
}

/**
 * The one gate every DHARA-speech call passes. Returns true when the flag is
 * OFF (today's behaviour) or when every rule allows speaking.
 */
export function canSpeakNow(): boolean {
  if (!VOICE_COMPANION_ENABLED) return true;
  return maySpeakOn(platform(), {
    quiet: flags.quiet,
    speakingPreferenceKnown,
    inWomensShield: flags.inWomensShield,
    interruptedNotResumed: flags.interruptedNotResumed,
    userGestureThisPageLoad,
  }).speak;
}
