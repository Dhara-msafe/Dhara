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

import type { Platform as PlatformType } from 'react-native';

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

/**
 * Default blob reader used in production.
 * On web: browser fetch reads the object-URL into a Blob.
 * On native: expo/fetch reads the file:// URI into a Blob — the only form
 * that works with the native FormData multipart serialiser (expo SDK 52+).
 *
 * Exported separately so tests can inject a mock without touching the
 * main function signature or altering any production call site.
 */
export async function defaultBlobReader(uri: string): Promise<Blob> {
  // Lazy Platform import so stt.ts is importable in Node test environments
  // (where react-native cannot be parsed). Tests inject _blobReader directly
  // so this function is never called during local test runs.
  const { Platform } = await import('react-native');
  if (Platform.OS === 'web') {
    return (await fetch(uri)).blob();
  }
  const { fetch: expoFetch } = await import('expo/fetch');
  return (await expoFetch(uri)).blob();
}

export async function whisperTranscribeFile(
  apiBase: string,
  token: string,
  uri: string,
  languageHint?: string,
  /** Injectable for tests — production callers omit this. */
  _blobReader: (uri: string) => Promise<Blob> = defaultBlobReader,
): Promise<WhisperTranscribeResult> {
  // Mic diagnosis fix: distinct sentinel for "nothing was captured" — this is
  // NOT a transcription failure, it never reaches the network, and it needs
  // its own message (the generic one was misleading users into thinking the
  // server rejected a real recording).
  if (!uri) throw new Error('__no_recording__');

  const fileBlob = await _blobReader(uri);
  const form = new FormData();
  // @ts-ignore — RN FormData accepts (Blob, filename)
  form.append('audio', fileBlob, 'audio.m4a');
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
    // Mic diagnosis fix: we may now surface the SERVER's own message, but
    // only when it is safe to show — a short, plain `detail` string, and
    // only for 4xx (client-error) responses that our own backend crafts on
    // purpose (e.g. "Recording was too short…"). 5xx bodies can embed raw
    // exception text (provider/model names) and a non-JSON body (e.g. an
    // HTML page from an upstream proxy) must never leak through either.
    let serverMessage: string | undefined;
    if (res.status >= 400 && res.status < 500) {
      try {
        const body = await res.json();
        if (
          typeof body?.detail === 'string' &&
          body.detail.length > 0 &&
          body.detail.length < 200 &&
          !body.detail.includes('<')
        ) {
          serverMessage = body.detail;
        }
      } catch {}
    }
    const err: any = new Error('__transcribe_failed__');
    err.status = res.status;
    if (serverMessage) err.serverMessage = serverMessage;
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
  const serverMessage = (err as any)?.serverMessage;
  const msg = String((err as any)?.message ?? err ?? '');
  // Nothing was captured — permission denial, an instant tap/release, or a
  // hard-kill mid-recording. Never reached the network.
  if (msg.includes('__no_recording__'))
    return 'No sound was recorded. Please allow the microphone and try again.';
  if (msg.includes('__session_expired__'))
    return 'Session expired — please sign in again.';
  if (msg.includes('__network_error__'))
    return 'Could not reach DHARA. Check your internet and try again.';
  // Fix A (kept): one short, fixed message per status — never the raw
  // response body (some upstream rate-limit responses are plain HTML, not
  // JSON) — UNLESS it was already vetted as a safe, short, plain-text
  // `detail` string above (4xx only).
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied'))
    return 'Microphone permission denied. Please allow microphone access in Settings.';
  if (msg === '__transcribe_failed__') {
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
    return 'DHARA could not transcribe that. Please try again or type your question.';
  }
  return msg || 'Voice recognition failed. Please try again.';
}
