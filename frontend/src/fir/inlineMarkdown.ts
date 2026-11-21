/**
 * B-75 (21 Nov web retest): FIR bot messages carry **bold** markers (date
 * confirmation, place prompts) that rendered as raw asterisks. Pure helpers,
 * no React, so they can be unit-tested directly.
 */
export interface InlineSegment { text: string; bold: boolean }

/** Split text into plain/bold segments. **x** → bold 'x'; any unpaired '**'
 * left over is dropped rather than shown. */
export function splitInlineBold(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  for (const part of text.split(/(\*\*[^*\n]+?\*\*)/g)) {
    if (!part) continue;
    const m = /^\*\*([^*\n]+?)\*\*$/.exec(part);
    if (m) out.push({ text: m[1], bold: true });
    else {
      const plain = part.replace(/\*\*/g, '');
      if (plain) out.push({ text: plain, bold: false });
    }
  }
  return out;
}

/** Same markers removed for read-aloud, so TTS never says 'asterisk'. */
export function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*/g, '');
}
