/**
 * B-119 fix: bot messages throughout fir_engine.py (and corpus.py-driven
 * chat replies) use **double-asterisk** markdown to emphasize key words
 * (e.g. "I calculated the incident happened on **15 November 2026**."),
 * but the FIR chat screen's message bubble was a plain React Native
 * <Text>{text}</Text> with no markdown rendering at all -- so the person
 * saw the literal asterisks on screen ("**15 November 2026**"), and the
 * same raw asterisks were read aloud character-by-character by
 * text-to-speech.
 *
 * These two small, dependency-free helpers fix both: splitBold() turns a
 * string into plain/bold segments a <Text> tree can render natively (no
 * markdown library needed for this one, narrow case), and stripBold()
 * removes the markers entirely for TTS, where "bold" has no spoken form.
 */

export type BoldSegment = { text: string; bold: boolean };

const BOLD_RE = /\*\*([^*]+)\*\*/g;

/** Split `text` into an ordered list of plain/bold segments. */
export function splitBold(text: string): BoldSegment[] {
  if (!text || !text.includes('**')) return [{ text, bold: false }];
  const segments: BoldSegment[] = [];
  let lastIndex = 0;
  BOLD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOLD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = BOLD_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false });
  }
  return segments.length ? segments : [{ text, bold: false }];
}

/** Remove **bold** markers entirely, keeping the enclosed text -- for TTS. */
export function stripBold(text: string): string {
  if (!text) return text;
  return text.replace(BOLD_RE, '$1');
}
