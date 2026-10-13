/**
 * Talk to DHARA — Step 5 helper: classify a voice transcript into the
 * FactKind shape voicePolicy.needsConfirmation() expects.
 *
 * Pure TypeScript, no React / Expo imports, so it is unit-testable under
 * `node --test`. Heuristic only — false negatives just mean "treat as
 * free_text", which is always the SAFE default (never forces an extra tap).
 */
import type { FactKind } from './core/voicePolicy';

const INDIAN_STATES = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh',
  'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka',
  'kerala', 'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya',
  'mizoram', 'nagaland', 'odisha', 'punjab', 'rajasthan', 'sikkim',
  'tamil nadu', 'telangana', 'tripura', 'uttar pradesh', 'uttarakhand',
  'west bengal', 'delhi', 'jammu and kashmir', 'ladakh', 'puducherry',
  'chandigarh',
];

const DATE_RE = /\b(\d{1,2}[\/\-.\s](?:\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\/\-.\s]\d{2,4}|today|yesterday|last (?:night|week|month))\b/i;
const AMOUNT_RE = /(₹|rs\.?|rupees?)\s?[\d,]+|\b\d{3,}\s?(rupees|rs)\b/i;
const SECTION_RE = /\bsection\s?\d+[a-z]*\b|\b(?:ipc|bns|crpc|bnss|bsa)\s?\d+\b/i;

/** Best-effort guess at which v3 FactKind a spoken transcript represents. */
export function classifyFact(text: string): FactKind {
  const t = (text || '').trim().toLowerCase();
  if (!t) return 'free_text';
  if (SECTION_RE.test(t)) return 'section_number';
  if (AMOUNT_RE.test(t)) return 'amount';
  if (DATE_RE.test(t)) return 'date';
  if (INDIAN_STATES.some((s) => t.includes(s))) return 'state';
  return 'free_text';
}
