/**
 * Chunked, pipelined cloud TTS.
 *
 * WHY THIS EXISTS
 * ---------------
 * `POST /api/voice/tts` synthesises whatever text you give it and streams back one
 * `audio/mpeg` body. The old call site handed it the WHOLE answer and waited for the
 * last byte before creating a player, so nothing was audible until synthesis of the
 * entire answer had finished. Measured against production on 2026-08-26:
 *
 *     chars   time-to-first-byte   total
 *        28                 1.3s    1.6s
 *        58                 2.6s    2.9s
 *       102                 2.7s    4.2s
 *       990                 3.6s   13.1s   (1.04 MB)
 *
 * Cost grows with the length of the text in one request, so the fix is to stop asking
 * for the whole answer at once:
 *
 *   1. Split on sentence boundaries and request each piece separately.
 *   2. Keep the FIRST piece deliberately short — that alone takes first audio from
 *      ~13s to ~1.5-3s, because latency tracks the length of the request.
 *   3. Start synthesising as soon as a sentence has STREAMED IN, not when the whole
 *      answer is complete, so synthesis overlaps the text stream instead of following
 *      it. This is what actually closes the gap the user complained about.
 *   4. Play each piece as it arrives while later pieces synthesise behind it.
 *
 * Later pieces are safe to make longer: a piece always takes less time to synthesise
 * than the previous piece takes to play (a 102-char piece is 4.2s of work for 6.5s of
 * audio), so the queue never runs dry mid-answer. Verified end to end against
 * production: 6 sentences, zero gaps after the first.
 */

/** Text sent in the first request. Small on purpose — this is the latency the user feels. */
const FIRST_CHUNK_MAX_CHARS = 90;
/** Later requests batch up to this, to spend fewer round trips once audio is flowing. */
const LATER_CHUNK_TARGET_CHARS = 220;
/**
 * How many clips to synthesise at once. Must be > 1: the endpoint is noisy — measured
 * 2.4s, 2.4s, 8.2s, 2.6s for four same-sized chunks — and with a single request in
 * flight one slow clip starves playback and produces an audible mid-answer gap.
 * Keeping a clip in reserve absorbs that. Kept low so we don't stampede the backend.
 */
const MAX_IN_FLIGHT = 2;

/**
 * Sentence terminators. `।` (Devanagari danda) and `॥` matter as much as `.` here —
 * Hindi, Marathi and other Indic scripts in this app do not use a full stop, and
 * splitting on `.` alone would treat a whole Hindi answer as one unsplittable chunk,
 * i.e. exactly the bug we are fixing.
 */
const SENTENCE_END = /[.!?।॥]/;

export type WrittenAudio = { uri: string; cleanup: () => void };

export type ChunkedSpeakerOptions = {
  /**
   * Backend origin. Allowed to be undefined because the app derives it from
   * process.env.EXPO_PUBLIC_BACKEND_URL, which TS types as possibly undefined;
   * interpolating it is exactly what the previous call site did.
   */
  apiBase: string | undefined;
  token: string;
  /** BCP-47-ish tag or short code, forwarded to the backend unchanged. */
  language: string;
  /**
   * Stable id for the answer being spoken (the assistant message id). Every chunk
   * carries it so the backend meters the whole answer as ONE question instead of
   * one per chunk — without this, chunking multiplies what a free user is charged.
   *
   * B-94/B-79: this alone isn't enough. Up to MAX_IN_FLIGHT (2) chunks are
   * sent concurrently, and the backend used to decide "is this the first
   * chunk of this group?" via a racy upsert with no unique index backing
   * it — two concurrent first requests could both win that race and both
   * get charged, which is exactly why a single officer-card "listen" (or
   * any answer with ≥2 chunks) could cost 2 instead of 1. Each request now
   * also carries its own chunk_index (below), so the backend can decide
   * "charge only chunk 0" from data the client already knows for certain,
   * with no server-side race at all.
   */
  group?: string;
  /** Playback rate; the UI exposes 1x / 1.5x / 2x. */
  rate?: number;
  /**
   * B-94/B-79: marks this entire utterance as free — fixed, canned,
   * non-LLM safety content (officer card, panic lesson, action plan) or a
   * replay of an answer that was already paid for once. The backend only
   * honours a small explicit allow-list of values; anything else is
   * ignored and the call is metered as normal.
   */
  freeReason?: 'fixed_screen' | 'replay';
  /**
   * Persist one synthesised clip and hand back a URI the player can open, plus a
   * cleanup callback. Injected rather than imported so this module stays independent
   * of whichever expo-file-system API version the app is on.
   */
  writeAudio: (bytes: ArrayBuffer, index: number) => Promise<WrittenAudio>;
  /** Create the underlying player. Injected to keep this module testable. */
  createPlayer: (uri: string) => TtsPlayer;
  onSpeakingChange?: (speaking: boolean) => void;
  /** Fires once, when the first clip actually starts. Useful for timing in logs. */
  onFirstAudio?: (msSinceStart: number) => void;
  onError?: (message: string) => void;
  /** Browser policy blocked playback. Keep the prepared clip for a user tap. */
  onPlaybackBlocked?: () => void;
};

/** Minimal slice of expo-audio's AudioPlayer that this module needs. */
export type TtsPlayer = {
  play: () => void | Promise<void>;
  remove: () => void;
  setPlaybackRate?: (rate: number) => void;
  /** Must invoke the callback once when the clip finishes. */
  onFinish: (cb: () => void) => void;
};

/**
 * Splits `text` into speakable chunks, ignoring anything before `from`.
 * Only returns a trailing partial chunk when `isFinal` is true, so we never
 * synthesise half a sentence that the stream is still writing.
 */
export function takeChunks(
  text: string,
  from: number,
  isFinal: boolean,
  isFirst: boolean,
): { chunks: string[]; consumed: number } {
  // 1. Locate every complete-sentence boundary after `from`.
  const bounds: number[] = [];
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    i += 1;
    if (!SENTENCE_END.test(ch)) continue;
    // Absorb closing quotes/brackets/whitespace belonging to this sentence.
    while (i < text.length && /["'’”)\]\s]/.test(text[i])) i += 1;
    bounds.push(i);
  }

  const chunks: string[] = [];
  let emitted = from;
  let budget = isFirst ? FIRST_CHUNK_MAX_CHARS : LATER_CHUNK_TARGET_CHARS;

  const emit = (to: number) => {
    const piece = text.slice(emitted, to).trim();
    if (!piece) return;
    if (chunks.length === 0 && isFirst && piece.length > budget) {
      // One very long opening sentence would reintroduce the latency we are fixing,
      // so fall back to a clause break. Only ever done for the first request.
      const cut = clauseCut(piece, budget);
      if (cut > 0) {
        chunks.push(piece.slice(0, cut).trim());
        chunks.push(piece.slice(cut).trim());
        emitted = to;
        budget = LATER_CHUNK_TARGET_CHARS;
        return;
      }
    }
    chunks.push(piece);
    emitted = to;
    budget = LATER_CHUNK_TARGET_CHARS; // only the first request is kept short
  };

  // 2. Group whole sentences greedily, flushing before we exceed the budget.
  let candidate = -1; // furthest boundary that still fits
  for (const b of bounds) {
    if (text.slice(emitted, b).trim().length <= budget) {
      candidate = b;
      continue;
    }
    // Adding this sentence overflows. Flush what fitted, then reconsider it.
    if (candidate > emitted) {
      emit(candidate);
      candidate = text.slice(emitted, b).trim().length <= budget ? b : -1;
      if (candidate === -1) emit(b);
    } else {
      emit(b); // a single sentence bigger than the budget; nothing to split on
      candidate = -1;
    }
  }

  if (isFinal) {
    emit(text.length);
    return { chunks, consumed: text.length };
  }

  // Stream still running: hand out complete sentences, keep the partial tail buffered
  // so we never synthesise half a sentence that is still being written.
  if (candidate > emitted) emit(candidate);
  return { chunks, consumed: emitted };
}

/**
 * Index to break a too-long opening sentence at, preferring the last clause
 * separator that fits inside `budget`. Returns 0 when there is nothing sensible.
 */
function clauseCut(piece: string, budget: number): number {
  const window = piece.slice(0, budget + 1);
  const m = window.match(/.*[,;:—–](\s+)/);
  if (m) return m[0].length;
  const sp = window.lastIndexOf(' ');
  return sp > budget * 0.5 ? sp + 1 : 0;
}

export class ChunkedSpeaker {
  private opts: ChunkedSpeakerOptions;
  private consumed = 0;
  private queue: string[] = [];
  /** Synthesised clips keyed by chunk index — playback consumes them strictly in order. */
  private ready = new Map<number, WrittenAudio>();
  private nextSynthIndex = 0;
  private nextPlayIndex = 0;
  private inFlight = 0;
  private player: TtsPlayer | null = null;
  private currentAudio: WrittenAudio | null = null;
  private blocked = false;
  private ended = false;
  private stopped = false;
  private startedAt = Date.now();
  private sawFirstAudio = false;

  constructor(opts: ChunkedSpeakerOptions) {
    this.opts = opts;
  }

  get speaking() {
    return (
      !this.stopped &&
      (this.player !== null || this.ready.size > 0 || this.queue.length > 0 || this.inFlight > 0)
    );
  }

  get playbackBlocked() { return this.blocked; }

  /** Must be called directly from a press handler (no fetch/timer before play). */
  retryPlayback() {
    if (!this.stopped && this.blocked && this.player) this.playCurrent();
  }

  /** Call with the full answer text received so far; safe to call on every stream tick. */
  push(fullTextSoFar: string) {
    if (this.stopped || this.ended) return;
    const { chunks, consumed } = takeChunks(
      fullTextSoFar,
      this.consumed,
      false,
      this.nextSynthIndex === 0,
    );
    if (consumed > this.consumed) this.consumed = consumed;
    if (chunks.length) {
      this.queue.push(...chunks);
      this.pumpSynthesis();
    }
  }

  /** The text stream has finished; flush whatever is left. */
  end(fullText?: string) {
    if (this.stopped || this.ended) return;
    this.ended = true;
    if (fullText !== undefined) {
      const { chunks } = takeChunks(fullText, this.consumed, true, this.nextSynthIndex === 0);
      this.consumed = fullText.length;
      if (chunks.length) this.queue.push(...chunks);
    }
    this.pumpSynthesis();
    this.pumpPlayback();
  }

  /** Stop at once and release everything. Call this when the mic opens. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.blocked = false;
    this.queue = [];
    this.teardownPlayer();
    for (const audio of this.ready.values()) {
      try {
        audio.cleanup();
      } catch {}
    }
    this.ready.clear();
    this.opts.onSpeakingChange?.(false);
  }

  private teardownPlayer() {
    const p = this.player;
    this.player = null;
    if (p) {
      try {
        p.remove();
      } catch {}
    }
    try { this.currentAudio?.cleanup(); } catch {}
    this.currentAudio = null;
  }

  private pumpSynthesis() {
    while (!this.stopped && this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      const text = this.queue.shift() as string;
      const index = this.nextSynthIndex++;
      this.inFlight += 1;
      void this.synthesiseInto(text, index);
    }
  }

  private async synthesiseInto(text: string, index: number) {
    try {
      const bytes = await this.synthesise(text, index);
      if (this.stopped) return;
      const audio = await this.opts.writeAudio(bytes, index);
      if (this.stopped) {
        try {
          audio.cleanup();
        } catch {}
        return;
      }
      this.ready.set(index, audio);
      this.pumpPlayback();
    } catch (e: any) {
      if (this.stopped) return;
      this.stop();
      this.opts.onError?.(e?.message || 'Could not play part of the answer.');
    } finally {
      this.inFlight -= 1;
      if (!this.stopped) this.pumpSynthesis();
    }
  }

  private async synthesise(text: string, index: number): Promise<ArrayBuffer> {
    const res = await fetch(`${this.opts.apiBase}/api/voice/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        language: this.opts.language,
        ...(this.opts.group ? { group: this.opts.group, chunk_index: index } : {}),
        ...(this.opts.freeReason ? { free_reason: this.opts.freeReason } : {}),
      }),
    });
    if (!res.ok) throw new Error(`TTS failed (${res.status})`);
    return await res.arrayBuffer();
  }

  private pumpPlayback() {
    if (this.stopped || this.player) return;

    const audio = this.ready.get(this.nextPlayIndex);
    if (!audio) {
      // Nothing queued in order. If everything is done, we have finished speaking.
      if (this.ended && !this.queue.length && this.inFlight === 0 && this.ready.size === 0) {
        this.opts.onSpeakingChange?.(false);
      }
      return;
    }
    this.ready.delete(this.nextPlayIndex);
    this.nextPlayIndex += 1;

    if (!audio.uri) {
      this.pumpPlayback(); // this chunk failed to synthesise — skip it
      return;
    }

    this.currentAudio = audio;
    let player: TtsPlayer;
    try {
      player = this.opts.createPlayer(audio.uri);
    } catch (error: any) {
      this.stop();
      this.opts.onError?.(error?.message || 'Playback failed.');
      return;
    }
    this.player = player;

    if (this.opts.rate && this.opts.rate !== 1) {
      try {
        player.setPlaybackRate?.(this.opts.rate);
      } catch {}
    }

    player.onFinish(() => {
      if (this.player !== player) return;
      this.teardownPlayer();
      this.pumpPlayback();
    });

    this.playCurrent();
  }

  private playCurrent() {
    const player = this.player;
    if (!player || this.stopped) return;
    this.blocked = false;
    const started = () => {
      if (this.stopped || this.player !== player) return;
      this.blocked = false;
      this.opts.onSpeakingChange?.(true);
      if (!this.sawFirstAudio) {
        this.sawFirstAudio = true;
        this.opts.onFirstAudio?.(Date.now() - this.startedAt);
      }
    };
    const failed = (error: any) => {
      // Navigation/stop may reject an in-flight play promise: already cleaned up.
      if (this.stopped || this.player !== player) return;
      if (error?.name === 'NotAllowedError' && this.opts.onPlaybackBlocked) {
        this.blocked = true;
        this.opts.onPlaybackBlocked();
        return;
      }
      this.stop();
      this.opts.onError?.(error?.message || 'Playback failed.');
    };

    try {
      const result = player.play();
      if (result && typeof result.then === 'function') {
        void result.then(started).catch(failed);
      } else {
        started();
      }
    } catch (e: any) {
      failed(e);
    }
  }
}
