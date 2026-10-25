/**
 * STT Strategy — cloud Whisper transcription.
 *
 * All voice input now routes through /api/voice/transcribe (OpenAI Whisper,
 * Emergent-managed). On-device recognition (expo-speech-recognition) has
 * been removed: it only ran when EXPO_PUBLIC_STT_PROVIDER=native, which was
 * never actually set in this project (.env has always shipped with
 * 'whisper'), so this file is otherwise unchanged behaviour — purely a
 * dead-code removal to keep the install guard happy.
 */

import { Platform } from 'react-native';

export type STTResult = {
  text: string;
  provider: 'whisper';
  is_final: boolean;
};

export interface STTProvider {
  readonly id: 'whisper';
  readonly requiresInternet: boolean;
  readonly costPerMinuteUSD: number;
  readonly displayName: string;

  /** Whether the provider is available in the current runtime (device / OS / build). */
  isAvailable(): Promise<boolean>;

  /**
   * Start listening. `onPartial` fires with interim results (native only), `onFinal` fires once at the end.
   * Returns an async stop() function that ends the recognition and resolves with the final text.
   */
  start(opts: {
    languageTag: string; // BCP-47 like "hi-IN", "en-IN"
    onPartial?: (r: STTResult) => void;
    onError?: (msg: string) => void;
  }): Promise<{ stop: () => Promise<STTResult> }>;
}

/* ---------- Cloud Whisper provider (records audio, POSTs to backend) ---------- */

let expoAudioMod: any = null;
async function loadExpoAudio() {
  if (expoAudioMod) return expoAudioMod;
  try {
    expoAudioMod = await import('expo-audio');
  } catch {}
  return expoAudioMod;
}

class WhisperCloudSTT implements STTProvider {
  readonly id = 'whisper' as const;
  readonly requiresInternet = true;
  readonly costPerMinuteUSD = 0.006;
  readonly displayName = 'Whisper (cloud)';

  private apiBase: string;
  private token: string | null;

  constructor(apiBase: string, token: string | null) {
    this.apiBase = apiBase;
    this.token = token;
  }

  async isAvailable() {
    return true; // always available given a token + network
  }

  async start({ onError }: {
    languageTag?: string;
    onPartial?: (r: STTResult) => void;
    onError?: (m: string) => void;
  }): Promise<{ stop: () => Promise<STTResult> }> {
    const mod = await loadExpoAudio();
    if (!mod) throw new Error('expo-audio not available');
    const perm = await mod.AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      onError?.('Microphone permission denied');
      throw new Error('Microphone permission denied');
    }
    await mod.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    // We can't use hooks here — caller must own the recorder. Use imperative API.
    // Fallback: use RecordingPresets + create a recording via AudioModule.
    // NOTE: This provider's caller (useSTT hook below) uses the higher-level `useAudioRecorder`.
    throw new Error('WhisperCloudSTT.start is orchestrated by useSTT hook — do not call directly.');
  }
}

/* ---------- Factory ---------- */

export type STTProviderId = 'whisper';

/** Always returns the cloud Whisper provider — see file header for why the
 * on-device option was removed. Kept as an async factory (rather than a
 * plain constant) so call sites don't need to change. */
export async function getConfiguredSTT(
  apiBase: string,
  token: string | null
): Promise<{ provider: STTProvider; providerId: STTProviderId; fellBack: boolean }> {
  return { provider: new WhisperCloudSTT(apiBase, token), providerId: 'whisper', fellBack: false };
}

/* ---------- Convenience utils ---------- */

/**
 * Send a recorded audio file to the cloud Whisper endpoint. Used by the audio-recorder
 * fallback when native STT is unavailable (e.g. web preview or Expo Go).
 *
 * `languageHint` — optional ISO 639-1 code (e.g. "hi", "ta") to bias Whisper's
 * recognition toward the user's selected language. Massively improves accuracy
 * for Indian languages compared to auto-detect.
 *
 * Returns the transcript plus the backend's script-mismatch check (e.g. Telugu
 * selected but the transcript came back in Kannada script) so the caller can
 * warn the user before they send a silently-wrong-language query.
 */
export type WhisperTranscribeResult = {
  text: string;
  scriptMismatch: boolean;
  detectedScript: string | null;
};

export async function whisperTranscribeFile(
  apiBase: string,
  token: string,
  uri: string,
  languageHint?: string
): Promise<WhisperTranscribeResult> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', blob, `audio.${extension}`);
  } else {
    // On native, use expo/fetch to read the file:// URI into a real Blob.
    // The old { uri, name, type } shorthand throws
    // "Unsupported FormDataPart implementation" on real Android devices that
    // use expo's native fetch implementation.
    const { fetch: expoFetch } = await import('expo/fetch');
    const fileBlob = await (await expoFetch(uri)).blob();
    // @ts-ignore — RN FormData accepts (Blob, filename)
    form.append('audio', fileBlob, 'audio.m4a');
  }
  if (languageHint) form.append('language', languageHint);

  // Network errors (no connection, DNS failure, timeout) must surface as a
  // recognisable sentinel — not a raw TypeError — so callers can show the
  // right UI message instead of the cryptic "Network request failed" string.
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new Error('__network_error__');
  }

  if (res.status === 401) {
    throw new Error('__session_expired__');
  }
  if (!res.ok) {
    // Fix A: never let a non-JSON error body (e.g. a raw HTML 429 page from
    // an upstream rate limiter/proxy) leak into the thrown message — classify
    // by status code ONLY, before ever attempting to parse the body.
    const err: any = new Error('__transcribe_failed__');
    err.status = res.status;
    throw err;
  }
  let data: any = {};
  try { data = await res.json(); } catch { data = {}; }
  return {
    text: data.text || '',
    scriptMismatch: !!data.script_mismatch,
    detectedScript: data.detected_script ?? null,
  };
}

/**
 * Translate a thrown STT / transcription error into a user-facing string.
 * Use this in every catch block that handles whisperTranscribeFile() or
 * getConfiguredSTT() failures to avoid silent drops and raw JS errors.
 *
 * Example:
 *   } catch (err) {
 *     Alert.alert('Voice error', sttErrorToMessage(err));
 *   }
 */
export function sttErrorToMessage(err: unknown): string {
  const status = (err as any)?.status;
  const msg = String((err as any)?.message ?? err ?? '');
  if (msg.includes('__session_expired__'))
    return 'Session expired — please sign in again.';
  if (msg.includes('__network_error__'))
    return 'No network connection. Please check your internet and try again.';
  // Fix A: one short, fixed message per status — never the raw response body
  // (some upstream rate-limit responses are plain HTML, not JSON).
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied'))
    return 'Microphone permission denied. Please allow microphone access in Settings.';
  if (msg === '__transcribe_failed__') return 'Could not transcribe. Please try again or type your question.';
  return msg || 'Voice recognition failed. Please try again.';
}
