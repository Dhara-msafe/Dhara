/**
 * Silent-capture guard for voice input.
 *
 * Why this exists: on the SDK 55 Android build the Ask mic produced a valid
 * .m4a file with no speech in it. The backend accepted the file (it is a real
 * audio container), Whisper returned its usual no-speech filler ("you"), and
 * the "We heard" card showed that same word for every recording. Nothing in
 * the app noticed, because the recording animation is decorative and no code
 * looked at the actual microphone level.
 *
 * This module is pure (no react-native import) so it runs under node:test.
 * The Ask screen samples recorder.getStatus().metering while recording and
 * asks classifyCapture() before uploading.
 */

/** expo-audio reports -160 dB when the recorder's max amplitude is exactly 0. */
export const SILENCE_FLOOR_DB = -160;

/**
 * A capture whose LOUDEST sample never rose above this is treated as silent.
 * Deliberately conservative: quiet-room background noise on a working phone
 * mic peaks around -50 dB and speech around -25 to -5 dB, so -60 only trips
 * when the mic is delivering (near) digital silence. It must never block a
 * real, quietly spoken question.
 */
export const SILENT_PEAK_DB = -60;

/** Need at least this many level samples before trusting a "silent" verdict. */
export const MIN_SAMPLES_FOR_SILENCE = 3;

/** Shorter than this cannot contain a usable question. */
export const MIN_CAPTURE_MS = 700;

export type CaptureStats = {
  /** Wall-clock ms between recorder.record() and the stop request. */
  elapsedMs: number;
  /** Loudest metering value seen (dB), or null when metering never reported. */
  peakDb: number | null;
  /** How many metering samples were read. */
  samples: number;
};

export type CaptureVerdict = 'ok' | 'too_short' | 'silent';

export function classifyCapture(stats: CaptureStats): CaptureVerdict {
  if (!(stats.elapsedMs >= MIN_CAPTURE_MS)) return 'too_short';
  // No metering data (older build, web, or the native call failed): we cannot
  // judge, so never block — the server-side guard is the backstop.
  if (stats.peakDb === null || !Number.isFinite(stats.peakDb)) return 'ok';
  if (stats.samples < MIN_SAMPLES_FOR_SILENCE) return 'ok';
  return stats.peakDb <= SILENT_PEAK_DB ? 'silent' : 'ok';
}

/** Running peak tracker — call add() with each metering reading. */
export function createPeakTracker() {
  let peakDb: number | null = null;
  let samples = 0;
  return {
    add(db: unknown) {
      if (typeof db !== 'number' || !Number.isFinite(db)) return;
      samples += 1;
      if (peakDb === null || db > peakDb) peakDb = db;
    },
    read(): { peakDb: number | null; samples: number } {
      return { peakDb, samples };
    },
  };
}

export const CAPTURE_TOO_SHORT_MESSAGE =
  'That was too short. Please hold the mic and speak for at least a second.';
export const CAPTURE_SILENT_MESSAGE =
  "We couldn't hear anything. Check that nothing is covering the microphone, then try again or type your question.";
