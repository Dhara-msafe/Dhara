/**
 * Pure text/answer helpers for the chat screen. No React state, no side
 * effects — extracted so they can be read (and reasoned about) without opening
 * the 3,900-line screen.
 */
import type React from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Strip raw markdown markers from streaming text so asterisks/hashes never
 *  flash in the UI while the LLM is still mid-sentence. Called only on the
 *  accumulated delta text; the sanitized `final` frame is displayed as-is. */
export function stripStreamMarkdown(text: string): string {
  return text
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1') // **bold** / *italic*
    .replace(/^#{1,6}\s+/gm, '')                 // ## headings
    .replace(/^---+$/gm, '')                     // horizontal rules
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1');      // `code`
}

/**
 * Contextual next step derived from the verified citations on an answer. Keeps
 * the user moving from "what the law says" to "the thing to actually send/do",
 * which is where a legal-information app either helps or dead-ends.
 */
export function nextStepFor(citations?: { short_label: string }[]):
  | { label: string; route: string; icon: IconName }
  | null {
  if (!citations || citations.length === 0) return null;
  const labels = citations.map((c) => c.short_label || '');
  const has = (fn: (l: string) => boolean) => labels.some(fn);
  if (has((l) => l.startsWith('NI '))) {
    return { label: 'Get a ready cheque-bounce notice', route: '/drafts/cheque_bounce', icon: 'document-text-outline' };
  }
  if (has((l) => /IT 6|IT 43|Cyber report|RBI zero/.test(l))) {
    return { label: 'Open the golden-hour fraud checklist', route: '/fraud-checklist', icon: 'shield-half-outline' };
  }
  if (has((l) => /Wage Code|IR Code|SS Code|SAMADHAN/.test(l))) {
    return { label: 'Get a ready unpaid-salary notice', route: '/drafts/unpaid_salary', icon: 'briefcase-outline' };
  }
  if (has((l) => /Rent|Tenancy/.test(l))) {
    return { label: 'Get a ready deposit-refund notice', route: '/drafts/deposit_refund', icon: 'home-outline' };
  }
  return null;
}

/**
 * Detects FIR/police-complaint drafting intent directly from the citizen's
 * own message text — independent of whatever the RAG backend returns (which
 * may have zero verified sources for a request like "draft FIR for me", as
 * that isn't a legal-information lookup at all). This is what routes a
 * citizen to the actual Voice FIR Drafting Assistant instead of leaving them
 * with a generic "no verified source" dead-end.
 */
export function detectFirIntent(text: string): boolean {
  const low = text.toLowerCase();
  return /\b(draft|file|register|write|lodge)\b.{0,20}\b(fir|f\.i\.r|complaint|police report)\b/.test(low)
    || /\breport\s+(an?\s+)?(incident|crime|theft|assault|harassment)\b/.test(low)
    || /\bhelp me (draft|file|write)\b.{0,15}\bfir\b/.test(low)
    || /\bwant to (file|report|draft)\b.{0,20}\b(fir|complaint|incident|crime)\b/.test(low);
}

/**
 * Summary-first UX: surface a short "Verdict" (first ~2 sentences of the
 * answer) up top, and tuck the longer reasoning + statutory sections behind a
 * "View Legal Details" toggle. Keeps the first glance skimmable while the full
 * grounded law text stays one tap away.
 */
export function splitVerdict(text: string): { verdict: string; rest: string } {
  const trimmed = (text || '').trim();
  if (!trimmed) return { verdict: '', rest: '' };
  // Include ।  (Devanagari danda) as a sentence terminator for Hindi/Marathi
  const sentences = trimmed.match(/[^.!?।]+[.!?।]+(?:\s|$)/g);
  if (!sentences || sentences.length <= 2) return { verdict: trimmed, rest: '' };
  // Bug-fix: verdictRaw.length ≠ the true split point when there is a heading or
  // preamble before the first matched sentence (e.g. "UPI Fraud Help\nYou can…").
  // Use indexOf(sentences[0]) to find the real start offset so that 'rest' never
  // begins mid-sentence.
  const firstStart = trimmed.indexOf(sentences[0]);
  const twoSentLen = sentences.slice(0, 2).join('').length;
  const splitAt = firstStart < 0 ? twoSentLen : firstStart + twoSentLen;
  return {
    verdict: trimmed.slice(0, splitAt).trim(),
    rest: trimmed.slice(splitAt).trim(),
  };
}

/**
 * Generate a RFC-4122 v4 UUID for new conversation sessions.
 * Used on the frontend so "New Chat" owns its session ID immediately,
 * preventing race conditions where an in-flight SSE stream from the
 * previous conversation could overwrite the new session ID.
 */
export const generateId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

// DHARA-B019: every citation card referencing an old IPC section must show
// a visible migration notice on render (not only when expanded) — IPC was
// renumbered/replaced by BNS 2023, effective 1 July 2024.
export const isIpcCitation = (c: { act?: string; citation?: string } | null | undefined) =>
  !!c && (/\bIPC\b|Indian Penal Code/i.test(c.act || '') || /\bIPC\b/i.test(c.citation || ''));

// T1: broad client-side danger/distress heuristic. A quota-exhausted guest is
// normally blocked from sending, but a message that looks like present danger
// (or a bare distress call) must still reach the backend, which makes the final
// decision: danger → 112 safety reply (no quota consumed), ordinary → paywall.
// Intentionally broad — a false positive just reaches the backend and gets the
// normal limit response, while a miss would suppress a real safety reply.
const _GUEST_DANGER_RE =
  /(help\s*me|save\s*me|in\s*danger|not\s*safe|unsafe|kill|hurt|attack|beat|hitting|weapon|knife|gun|threat|abus|violen|chasing|following\s*me|stalk|rape|bachao|bachaao|maar|jaan\s*se|वाचवा|बचाओ|मार|खतरा|खतरे|धमकी|हमला|धोक्यात|आपत्|காப்பாற்|ஆபத்து|అపాయం|కాపాడ)/i;

export function looksLikeDanger(text: string): boolean {
  return _GUEST_DANGER_RE.test(text || '');
}
