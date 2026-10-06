/**
 * Native device TTS — free Indian accent voices (web only).
 *
 * Uses the device's built-in speech engine so there is NO cloud round-trip
 * and no API credits are consumed.
 *
 *  • Web    : window.speechSynthesis — checks that the browser has a voice
 *             for the requested locale (e.g. mr-IN) before speaking. Returns
 *             false (cloud-TTS fallback) when no matching voice is installed.
 *  • Native : no on-device engine is wired here (previously expo-speech,
 *             removed — low-quality fixed system voices with no model/style
 *             control; the app's cloud TTS via /api/voice/tts is the
 *             supported path). speakNative() on native always returns
 *             `false` so every caller's existing cloud-TTS fallback engages.
 *
 * Gender is simulated by adjusting pitch only (device voices are mono-gender
 * per locale on most Android / iOS installs; we pick the best available and
 * nudge the pitch so the user can tell female from male).
 */
import { Platform } from 'react-native';

export type VoiceGender = 'female' | 'male';

/** BCP-47 map: our short codes → Indian locale tags. */
const LOCALE_MAP: Record<string, string> = {
  en: 'en-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
  ta: 'ta-IN',
  ml: 'ml-IN',
  bn: 'bn-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  or: 'or-IN',
  as: 'as-IN',
};

function toBCP47(langCode: string): string {
  return LOCALE_MAP[langCode] ?? `${langCode}-IN`;
}

// ─── Web ─────────────────────────────────────────────────────────────────────

/**
 * Attempt to speak using window.speechSynthesis.
 *
 * Returns `true` when a voice matching `bcp47` was found and speech was
 * started.  Returns `false` when no matching voice exists so the caller can
 * fall through to cloud TTS.  `onDone` is NOT called on a `false` return —
 * the cloud-TTS path will own that callback.
 */
async function speakWeb(
  text: string,
  bcp47: string,
  gender: VoiceGender,
  onDone?: () => void,
): Promise<boolean> {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return false;
  }

  // Resolve voice list — Chrome/Edge populate it asynchronously.
  const getVoicesAsync = (): Promise<SpeechSynthesisVoice[]> => {
    const v = window.speechSynthesis.getVoices();
    if (v.length > 0) return Promise.resolve(v);
    return new Promise((resolve) => {
      window.speechSynthesis.addEventListener(
        'voiceschanged',
        () => resolve(window.speechSynthesis.getVoices()),
        { once: true },
      );
    });
  };

  const voices = await getVoicesAsync();

  // 1st choice: exact locale match (e.g. mr-IN)
  // 2nd choice: same language + any Indian region (e.g. hi-IN)
  // 3rd choice: same base language (e.g. hi-*)
  const langBase = bcp47.split('-')[0];
  const best =
    voices.find((v) => v.lang === bcp47) ??
    voices.find((v) => v.lang.startsWith(langBase + '-IN')) ??
    voices.find((v) => v.lang.startsWith(langBase));

  // No matching voice installed → signal caller to use cloud TTS instead
  if (!best) return false;

  window.speechSynthesis.cancel();

  const utter       = new SpeechSynthesisUtterance(text);
  utter.lang        = bcp47;
  utter.rate        = 0.88;
  utter.pitch       = gender === 'female' ? 1.18 : 0.82;
  utter.voice       = best;
  utter.onend       = () => onDone?.();
  utter.onerror     = () => onDone?.();
  window.speechSynthesis.speak(utter);
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Speak `text` using the device's native TTS engine.
 *
 * Returns `true` when native (web) TTS was used, `false` when unavailable
 * (no matching voice on web, or always on native) — the caller should fall
 * back to cloud TTS in that case, which every call site already does.
 *
 * @param text    The text to speak.
 * @param lang    Short language code from the app's language store (e.g. 'en', 'mr').
 * @param gender  'female' (default) or 'male' — adjusts pitch.
 * @param onDone  Called once speech finishes, errors, or isn't used.
 */
export async function speakNative(
  text: string,
  lang = 'en',
  gender: VoiceGender = 'female',
  onDone?: () => void,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const bcp47 = toBCP47(lang);
    const used = await speakWeb(text, bcp47, gender, onDone);
    // No matching voice → call onDone so callers that don't check the return
    // value aren't left hanging, then return false for cloud-TTS fallback.
    if (!used) onDone?.();
    return used;
  }

  // Native mobile has no on-device engine wired up — always defer to the
  // caller's cloud TTS fallback (every call site already handles `false`).
  onDone?.();
  return false;
}

/** Stop any in-progress native TTS immediately. */
export function stopNativeTTS(): void {
  if (Platform.OS === 'web') {
    try { window.speechSynthesis?.cancel(); } catch {}
  }
}
