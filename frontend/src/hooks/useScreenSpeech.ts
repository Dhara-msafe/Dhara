import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { setAudioModeAsync } from 'expo-audio';
import { useAuth } from '../auth';
import { API_BASE } from '../apiBase';
import { speakNative, stopNativeTTS } from '../voice/native-tts';
import { ChunkedSpeaker } from '../voice/tts';
import { screenPlayer } from '../media/screenPlayer';
import { canSpeakNow, noteSpeakIntent } from '../voice/speechGate';
import { isMicHeldByEvidenceLocker, TTS_BLOCKED_BY_LOCKER_MESSAGE } from '../voice/micArbiterGuard';

/** Uses the existing voice pipeline. Never speaks until the user taps Listen. */
export function useScreenSpeech() {
  const { token, language, ttsVolume } = useAuth();
  const [speaking, setSpeaking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const speaker = useRef<ChunkedSpeaker | null>(null);
  const active = useRef(false);
  const browserAudio = useRef<HTMLAudioElement | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    active.current = false;
    speaker.current?.stop(); speaker.current = null;
    stopNativeTTS(); setSpeaking(false); setBlocked(false);
  }, []);
  useFocusEffect(useCallback(() => () => stop(), [stop, language.code]));
  const listen = useCallback(async (text: string) => {
    if (speaker.current?.playbackBlocked) { speaker.current.retryPlayback(); return; }
    if (active.current) { stop(); return; }
    stop(); setError('');
    if (!text.trim()) return;
    // Talk to DHARA speech gate (inert when voice-companion flag is OFF).
    noteSpeakIntent();
    if (!canSpeakNow()) return;
    const id = generation.current;
    active.current = true; setSpeaking(true);
    try {
      // The existing web helper waits indefinitely for voiceschanged if the
      // browser has no voices at all. Skip that wait; cloud is safe here.
      const canTryDevice = Platform.OS !== 'web' || (typeof window !== 'undefined' && (window.speechSynthesis?.getVoices().length || 0) > 0);
      let resolved = false;
      let completed = false;
      const usedNative = canTryDevice && await speakNative(text, language.code, 'female', () => {
        completed = true;
        if (resolved && generation.current === id) { active.current = false; setSpeaking(false); }
      });
      if (generation.current !== id) { if (usedNative) stopNativeTTS(); return; }
      resolved = true;
      if (usedNative) { if (completed) { active.current = false; setSpeaking(false); } return; }
      if (!token) throw new Error('Device voice is unavailable. Sign in and connect to the internet for cloud audio, or read the text.');
      // P0-A: fail closed — never touch the shared audio session while the
      // Evidence Locker is recording; skip speaking instead of risking its clip.
      if (Platform.OS !== 'web' && isMicHeldByEvidenceLocker()) {
        throw new Error(TTS_BLOCKED_BY_LOCKER_MESSAGE);
      }
      if (Platform.OS !== 'web') await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false });
      if (generation.current !== id) return;
      const group = `screen-${Date.now()}-${id}`;
      const cloud = new ChunkedSpeaker({
        apiBase: API_BASE, token, language: language.code, group,
        writeAudio: async (buffer, index) => {
          if (Platform.OS === 'web') {
            const uri = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
            return { uri, cleanup: () => URL.revokeObjectURL(uri) };
          }
          const file = new File(Paths.cache, `${group}-${index}.mp3`);
          file.create(); file.write(new Uint8Array(buffer));
          return { uri: file.uri, cleanup: () => { if (file.exists) file.delete(); } };
        },
        createPlayer: uri => {
          if (Platform.OS === 'web' && !browserAudio.current) browserAudio.current = new Audio();
          return screenPlayer(uri, ttsVolume, browserAudio.current || undefined);
        },
        onSpeakingChange: value => { if (id === generation.current) { active.current = value; setSpeaking(value); if (value) setBlocked(false); } },
        onPlaybackBlocked: () => { if (id === generation.current) { setBlocked(true); setSpeaking(false); } },
        onError: message => { if (id === generation.current) { active.current = false; setSpeaking(false); setBlocked(false); setError(`${message}. Check your connection and try again, or read the text.`); } },
      });
      speaker.current = cloud; cloud.end(text.slice(0, 3800));
    } catch (e: any) {
      if (generation.current === id) { active.current = false; setSpeaking(false); setError(e.message || 'Audio unavailable. Please try again or read the text.'); }
    }
  }, [language.code, stop, token, ttsVolume]);
  return { listen, stop, speaking, blocked, error };
}