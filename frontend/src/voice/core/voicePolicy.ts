/**
 * Talk to DHARA — voice policy rules (C15 v3).
 *
 * Pure functions for: when DHARA may speak (Quiet mode), which facts need
 * confirmation, what may be kept after a session, the spoken answer shape,
 * banned words, and the draft-save idempotency key.
 * No React / Expo imports.
 */

/* ---------------------------------------------------------------- Quiet */

export type SpeakContext = {
  /** User has chosen Quiet. Persisted; survives restart. */
  quiet: boolean;
  /** Has the user told us whether DHARA may speak? (first run = false) */
  speakingPreferenceKnown: boolean;
  /** Women's Shield is open, or the session started from it. */
  inWomensShield: boolean;
  /** Playback was interrupted (call, headphones unplugged, app background)
   * and the user has not explicitly asked to resume. */
  interruptedNotResumed: boolean;
};

export type SpeakDecision = { speak: true } | { speak: false; reason: string };

/** The only gate every TTS call must pass. */
export function maySpeak(ctx: SpeakContext): SpeakDecision {
  if (!ctx.speakingPreferenceKnown) return { speak: false, reason: 'preference_unknown' };
  if (ctx.quiet) return { speak: false, reason: 'quiet' };
  if (ctx.inWomensShield) return { speak: false, reason: 'womens_shield' };
  if (ctx.interruptedNotResumed) return { speak: false, reason: 'interrupted' };
  return { speak: true };
}

/** Entering Women's Shield forces Quiet on; it never turns Quiet off. */
export function quietAfterEnteringWomensShield(_currentQuiet: boolean): boolean {
  return true;
}

/* -------------------------------------------------------- Confirmation */

/** Facts that change the legal answer and must be confirmed when heard. */
export type FactKind =
  | 'state'
  | 'date'
  | 'amount'
  | 'section_number'
  | 'party_relationship'
  | 'free_text';

const ANSWER_CHANGING: readonly FactKind[] = ['state', 'date', 'amount', 'section_number'];

/**
 * Confirm only answer-changing facts, or anything the recogniser was unsure of.
 * `confidence` is 0..1 when the provider gives one; undefined = unknown.
 */
export function needsConfirmation(kind: FactKind, confidence?: number, threshold = 0.85): boolean {
  if (ANSWER_CHANGING.includes(kind)) return true;
  if (confidence !== undefined && confidence < threshold) return true;
  return false;
}

/**
 * DHARA never asks the user to choose a statute or abbreviation. If the
 * engine cannot tell BNS from BNSS (etc.), ask about the facts instead.
 */
export const ABBREVIATION_FALLBACK_PROMPT_KEY = 'voice.ask_what_happened_instead';

export function isForbiddenAbbreviationQuestion(question: string): boolean {
  const q = question.toUpperCase();
  const acts = ['BNS', 'BNSS', 'BSA', 'IPC', 'CRPC'];
  const mentioned = acts.filter((a) => new RegExp(`\\b${a}\\b`).test(q));
  return mentioned.length >= 2 && /\b(OR|WHICH|या|किंवा)\b/i.test(question);
}

/* ------------------------------------------------------------ Retention */

export type RetentionInput = {
  signedIn: boolean;
  /** Phone has a PIN, pattern, password or biometric lock. Unknown = false. */
  deviceSecure: boolean;
  /** User agreed to keep this matter. */
  consentedToKeep: boolean;
};

export type RetentionDecision = 'keep_matter' | 'session_only';

/** Shared-phone rule: keep confirmed facts only when all three are true. */
export function retentionFor(i: RetentionInput): RetentionDecision {
  return i.signedIn && i.deviceSecure && i.consentedToKeep ? 'keep_matter' : 'session_only';
}

/* -------------------------------------------------------- Answer shape */

export type SpokenAnswerParts = {
  understood: string;
  meaning: string;
  nextStep: string;
  cannotConfirm?: string;
};

/**
 * Joins the four parts in the v3 order. Text must already be the RELEASED
 * answer from the 7-layer engine; this function only orders and trims.
 */
export function composeSpokenAnswer(p: SpokenAnswerParts): string {
  const parts = [p.understood, p.meaning, p.nextStep, p.cannotConfirm]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return parts.join(' ');
}

/* --------------------------------------------------------- Banned words */

/** Words that may not appear in user-facing voice text or log labels. */
export const BANNED_WORDS: readonly string[] = [
  'verified', 'certified', 'approved', 'court-ready', 'guaranteed', 'verdict',
];
// "submitted", "filed" and "sent" are not banned as words — the required
// message is "Draft saved, not submitted". False claims of submission are
// prevented by the action registry and the DRAFT_SAVED state, not by a word list.

export function findBannedWords(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_WORDS.filter((w) => new RegExp(`(^|[^a-z])${w.replace('-', '\\-')}([^a-z]|$)`).test(lower));
}

/** The only completion message the pilot may show or speak after saving. */
export const DRAFT_SAVED_MESSAGE_KEY = 'voice.draft_saved_not_submitted';

/* ---------------------------------------------------------- Idempotency */

/**
 * Same matter + same confirmed fields => same key, so a repeated "yes"
 * saves the draft once. Field order does not matter.
 */
export function draftSaveKey(matterId: string, fields: Record<string, string>): string {
  const canon = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('&');
  let h = 2166136261; // FNV-1a 32-bit, enough for a client-side dedupe key
  const s = `${matterId}|${canon}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `draft_${matterId}_${(h >>> 0).toString(16)}`;
}
