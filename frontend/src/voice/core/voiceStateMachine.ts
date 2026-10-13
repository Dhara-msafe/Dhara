/**
 * Talk to DHARA — C15 v3 voice session state machine.
 *
 * Pure TypeScript, no React / Expo imports, so it runs in the app, on web and
 * under `node --test`. This file is the single source of truth for voice
 * states. UI labels may be simpler, but must map onto these states.
 *
 * Quiet is a SETTING, not a state (see voicePolicy.ts).
 */

export type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'TRANSCRIBING'
  | 'CONFIRMING'
  | 'CLARIFYING'
  | 'CHECKING'
  | 'RESPONDING'
  | 'ACTION_PREVIEW'
  | 'DRAFT_SAVED'
  | 'SUSPENDED_BY_SAFETY'
  | 'TIMED_OUT'
  | 'ERROR';

export const VOICE_STATES: readonly VoiceState[] = [
  'IDLE', 'LISTENING', 'TRANSCRIBING', 'CONFIRMING', 'CLARIFYING', 'CHECKING',
  'RESPONDING', 'ACTION_PREVIEW', 'DRAFT_SAVED', 'SUSPENDED_BY_SAFETY',
  'TIMED_OUT', 'ERROR',
];

/** Forward moves, exactly as in the v3 "States" table. */
const FORWARD: Record<VoiceState, readonly VoiceState[]> = {
  IDLE: ['LISTENING'],
  LISTENING: ['TRANSCRIBING'],
  TRANSCRIBING: ['CONFIRMING', 'CLARIFYING'],
  CONFIRMING: ['CLARIFYING', 'CHECKING', 'LISTENING'],
  CLARIFYING: ['LISTENING'],
  CHECKING: ['RESPONDING'],
  RESPONDING: ['LISTENING', 'ACTION_PREVIEW'],
  ACTION_PREVIEW: ['DRAFT_SAVED'],
  DRAFT_SAVED: [],
  SUSPENDED_BY_SAFETY: [],
  TIMED_OUT: [],
  ERROR: [],
};

/**
 * Exits allowed from every state except IDLE: the user stops or cancels
 * (-> IDLE), anything fails (-> ERROR), inactivity (-> TIMED_OUT), or the
 * Evidence Locker / Women's Shield needs the microphone or silence
 * (-> SUSPENDED_BY_SAFETY). Terminal states may only return to IDLE.
 */
const GLOBAL_EXITS: readonly VoiceState[] = ['IDLE', 'ERROR', 'TIMED_OUT', 'SUSPENDED_BY_SAFETY'];
const TERMINAL: readonly VoiceState[] = ['DRAFT_SAVED', 'SUSPENDED_BY_SAFETY', 'TIMED_OUT', 'ERROR'];

/** Only these states may hold the microphone. */
export const MIC_STATES: readonly VoiceState[] = ['LISTENING'];

export function canTransition(from: VoiceState, to: VoiceState): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return to === 'IDLE';
  if (from === 'IDLE') return FORWARD.IDLE.includes(to);
  return FORWARD[from].includes(to) || GLOBAL_EXITS.includes(to);
}

export class InvalidVoiceTransition extends Error {
  readonly from: VoiceState;
  readonly to: VoiceState;
  constructor(from: VoiceState, to: VoiceState) {
    super(`Invalid voice transition ${from} -> ${to}`);
    this.from = from;
    this.to = to;
  }
}

export type TransitionListener = (from: VoiceState, to: VoiceState) => void;

/**
 * Small controller around the table. Rejects invalid moves instead of
 * silently ignoring them, so bugs surface in tests.
 */
export class VoiceStateMachine {
  private current: VoiceState = 'IDLE';
  private listeners: TransitionListener[] = [];

  get state(): VoiceState {
    return this.current;
  }

  /** True only while the session is allowed to hold the microphone. */
  get mayHoldMic(): boolean {
    return MIC_STATES.includes(this.current);
  }

  onTransition(fn: TransitionListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  to(next: VoiceState): void {
    const from = this.current;
    if (!canTransition(from, next)) throw new InvalidVoiceTransition(from, next);
    this.current = next;
    for (const l of this.listeners) l(from, next);
  }

  /** Like `to`, but returns false instead of throwing. */
  tryTo(next: VoiceState): boolean {
    if (!canTransition(this.current, next)) return false;
    this.to(next);
    return true;
  }
}
