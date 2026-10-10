/**
 * Visitor Mode — Speak For Me.
 *
 * Plays a phrase to an official in the visitor's STATE language (Marathi in
 * Maharashtra, Tamil in Tamil Nadu, Hindi elsewhere) instead of always Hindi.
 * The Hindi source text is translated via /api/visitor/translate (same as the
 * Two-Way Interpreter) and spoken via /api/voice/tts. Native playback uses
 * expo-audio — the old window.Audio path only worked in a browser, so the
 * button never spoke on the Android app.
 */
import { Platform } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { API_BASE } from '@/src/auth';
import { getStateLocalLang, type LocalLang } from '@/src/visitor/session';

const cache = new Map<string, string>();

export function speakLangFor(stateCode?: string): LocalLang {
  return getStateLocalLang(stateCode);
}

async function translate(text: string, src: string, tgt: string, token: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/visitor/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, source_lang: src, target_lang: tgt }),
  });
  if (!res.ok) throw new Error('Translation failed');
  const data = await res.json();
  return (data.translated_text || '').trim();
}

/**
 * Returns the phrase in `lang`. Goes Hindi -> English -> target: translating
 * Hindi straight into Marathi/Konkani (same script) kept leaving Hindi words
 * like "मुझे" in the output. Results are cached per session.
 */
export async function phraseIn(textHi: string, lang: LocalLang, token: string): Promise<string> {
  if (lang.code === 'hi') return textHi;
  const key = `${lang.code}|${textHi}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const enKey = `en|${textHi}`;
  let en = cache.get(enKey);
  if (!en) {
    en = await translate(textHi, 'hi', 'en', token);
    if (en) cache.set(enKey, en);
  }
  const out = (await translate(en || textHi, en ? 'en' : 'hi', lang.code, token)) || textHi;
  cache.set(key, out);
  return out;
}

/** Speaks `text` in `langCode`; resolves when playback ends. */
export async function playPhrase(text: string, langCode: string, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, language: langCode, voice: 'alloy' }),
  });
  if (!res.ok) throw new Error('TTS failed');

  if (Platform.OS === 'web') {
    const blob = await res.blob();
    return new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new (window as any).Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Audio playback failed')); };
      audio.play().catch(reject);
    });
  }

  // Native: write the mp3 to a cache file, then play with expo-audio.
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = (globalThis as any).btoa(binary);
  const file = new File(Paths.cache, `dhara-speak-for-me-${Date.now()}.mp3`);
  try { if (file.exists) file.delete(); } catch {}
  file.create();
  file.write(base64, { encoding: 'base64' } as any);

  return new Promise<void>((resolve) => {
    let settled = false;
    const player = createAudioPlayer({ uri: file.uri });
    const finish = () => {
      if (settled) return;
      settled = true;
      try { player.remove(); } catch {}
      try { file.delete(); } catch {}
      resolve();
    };
    const sub = player.addListener('playbackStatusUpdate', (status: any) => {
      if (status?.didJustFinish) { try { sub.remove(); } catch {} finish(); }
    });
    setTimeout(finish, 30000);
    try { player.play(); } catch { finish(); }
  });
}
