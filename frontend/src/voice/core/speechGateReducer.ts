/**
 * Talk to DHARA — speech-gate state reducer (C15 v3), pure TypeScript.
 *
 * Computes the Quiet / interruption / Women's-Shield flags that feed the
 * already-tested maySpeak()/maySpeakOn() decision in voicePolicy/voicePlatform.
 * No React / Expo imports, so it runs under `node --test`.
 *
 * Key rule (shared phones, calls, headphones, tab switches):
 *   An interruption sets `interruptedNotResumed = true` and NOTHING clears it
 *   automatically — only an explicit user "resume" (tapping speak again) does.
 *   Returning to the foreground alone must NEVER auto-resume speech.
 */

export type GateFlags = {
  quiet: boolean;
  interruptedNotResumed: boolean;
  inWomensShield: boolean;
};

export type GateEvent =
  | { type: 'app_state'; state: 'active' | 'background' | 'inactive' | 'hidden' }
  | { type: 'audio_interruption' }   // incoming call / headphone unplug / iOS interruption
  | { type: 'web_tab_hidden' }       // browser visibilitychange -> hidden
  | { type: 'resume_requested' }     // user explicitly asked to speak again
  | { type: 'enter_womens_shield' }  // entering the Shield: no speech while there
  | { type: 'leave_womens_shield' }; // leaving restores the previous voice state

export const INITIAL_GATE: GateFlags = {
  quiet: false,
  interruptedNotResumed: false,
  inWomensShield: false,
};

export function reduceGate(s: GateFlags, e: GateEvent): GateFlags {
  switch (e.type) {
    case 'app_state':
      // Leaving the foreground interrupts; returning to 'active' does NOT clear it.
      return e.state === 'active' ? s : { ...s, interruptedNotResumed: true };
    case 'audio_interruption':
    case 'web_tab_hidden':
      return { ...s, interruptedNotResumed: true };
    case 'resume_requested':
      return { ...s, interruptedNotResumed: false };
    case 'enter_womens_shield':
      // 22 Nov (owner GO): the Shield blocks speech only WHILE the user is in
      // it (maySpeak checks inWomensShield). It no longer touches Quiet —
      // the old 'force Quiet on, persisted' left voice off forever after one
      // visit, with no way back.
      return { ...s, inWomensShield: true };
    case 'leave_womens_shield':
      return { ...s, inWomensShield: false };
    default:
      return s;
  }
}
