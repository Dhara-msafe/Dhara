/**
 * Visitor Mode — Two-Way Interpreter
 * Tourist ↔ state's local language (default Hindi) live translation via Whisper STT + Claude Haiku TTS.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, AudioModule, createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { theme } from '@/src/theme';
import { loadVisitorSession, VisitorSession, getStateLocalLang, HINDI_LANG, STATE_LOCAL_LANG, type LocalLang } from '@/src/visitor/session';
import { API_BASE, useAuth } from '@/src/auth';
import { whisperTranscribeFile, sttErrorToMessage } from '@/src/voice/stt';

const C = theme.colors;

type Mode = 'tourist' | 'official';
type Turn = { speaker: Mode; original: string; translated: string };
type Phase = 'idle' | 'recording' | 'transcribing' | 'translating' | 'speaking';

// Whisper language hint — map tourist ISO 639-1 to BCP-47 for recording hint
const ISO_TO_BCP47: Record<string, string> = {
  en: 'en', fr: 'fr', de: 'de', es: 'es', pt: 'pt', it: 'it',
  ja: 'ja', ko: 'ko', zh: 'zh', ar: 'ar', ru: 'ru', hi: 'hi',
  ta: 'ta', kn: 'kn', ml: 'ml', te: 'te', bn: 'bn', gu: 'gu', mr: 'mr', pa: 'pa', as: 'as', or: 'or',
};

// DHARA-B021: the interpreter used to hard-code Hindi as the "official"
// language everywhere, even when the visitor had selected a state (e.g.
// Tamil Nadu) with a different dominant local language. Default the local
// language to the state's language (shared map in src/visitor/session.ts,
// also used by the intent/menu screen so both stay in sync), but always let
// the visitor override it explicitly — never silently assume.
const LOCAL_LANG_OPTIONS = [HINDI_LANG, ...Object.values(STATE_LOCAL_LANG).filter(l => l.code !== 'hi')]
  .filter((l, i, arr) => arr.findIndex(x => x.code === l.code) === i);

export default function InterpreterScreen() {
  const { token } = useAuth();
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [mode, setMode] = useState<Mode>('tourist');
  const [localLang, setLocalLang] = useState<LocalLang>(HINDI_LANG);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [currentTranslation, setCurrentTranslation] = useState('');
  const [statusText, setStatusText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // Native: expo-audio recorder. Web: browser MediaRecorder (expo-audio can't record on web).
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const webRecorderRef = useRef<any>(null);
  const webStreamRef = useRef<any>(null);
  const webChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    loadVisitorSession().then(s => {
      setSession(s);
      if (s) setLocalLang(getStateLocalLang(s.indianState));
    });
  }, []);

  const touristLang = session?.touristLang.code || 'en';
  const touristLangName = session?.touristLang.label || 'English';

  // Determine source / target lang for each mode
  const srcLang = mode === 'tourist' ? touristLang : localLang.code;
  const tgtLang = mode === 'tourist' ? localLang.code : touristLang;
  const srcLabel = mode === 'tourist' ? touristLangName : localLang.label;
  const tgtLabel = mode === 'tourist' ? localLang.label : touristLangName;

  // ── Translate via backend ─────────────────────────────────────────────────
  const translateText = useCallback(async (text: string, src: string, tgt: string): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/visitor/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, source_lang: src, target_lang: tgt }),
    });
    if (!res.ok) throw new Error('Translation failed');
    const data = await res.json();
    return data.translated_text || '';
  }, [token]);

  // ── TTS playback ──────────────────────────────────────────────────────────
  // Cloud TTS (/api/voice/tts, Emergent-managed OpenAI TTS) for both
  // platforms — native plays the returned audio via expo-audio (writes to a
  // cache file first, since createAudioPlayer needs a URI, not raw bytes);
  // web plays it directly through HTMLAudioElement.
  const playTTS = useCallback(async (text: string, lang: string) => {
    const res = await fetch(`${API_BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, language: lang, voice: 'alloy' }),
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

    // Native: write the mp3 bytes to a cache file, then play with expo-audio.
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const base64 = (globalThis as any).btoa ? (globalThis as any).btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
    const file = new File(Paths.cache, `dhara-interpreter-tts-${Date.now()}.mp3`);
    try { if (file.exists) file.delete(); } catch {}
    file.create();
    file.write(base64, { encoding: 'base64' } as any);

    return new Promise<void>((resolve) => {
      let settled = false;
      const player = createAudioPlayer({ uri: file.uri });
      const cleanup = () => { try { player.remove(); } catch {} try { file.delete(); } catch {} };
      const finish = () => { if (settled) return; settled = true; cleanup(); resolve(); };
      const sub = player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish) { try { sub.remove(); } catch {} finish(); }
      });
      // Safety net in case the finish event never fires on some devices.
      setTimeout(finish, 30000);
      try { player.play(); } catch { finish(); }
    });
  }, [token]);

  // ── Main recording + translation flow ────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!token) { Alert.alert('Sign in required', 'Sign in to DHARA to use Interpreter.'); return; }
    try {
      if (Platform.OS === 'web') {
        const nav = (globalThis as any).navigator;
        if (!nav?.mediaDevices?.getUserMedia) {
          Alert.alert('Not available', 'This browser does not support audio recording.');
          return;
        }
        const stream = await nav.mediaDevices.getUserMedia({ audio: true });
        const WMR = (globalThis as any).MediaRecorder;
        const mimeType = WMR?.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
          : WMR?.isTypeSupported?.('audio/mp4') ? 'audio/mp4' : '';
        const mr = mimeType ? new WMR(stream, { mimeType }) : new WMR(stream);
        webChunksRef.current = [];
        mr.ondataavailable = (e: any) => { if (e.data?.size > 0) webChunksRef.current.push(e.data); };
        mr.start();
        webStreamRef.current = stream;
        webRecorderRef.current = mr;
      } else {
        // P0-A: Check current status first — skip the dialog when already granted.
        let perm = await AudioModule.getRecordingPermissionsAsync();
        if (!perm.granted) {
          perm = await AudioModule.requestRecordingPermissionsAsync();
        }
        if (!perm.granted) { Alert.alert('Microphone permission denied'); return; }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      }
      setPhase('recording');
      setStatusText(`Recording ${srcLabel}… (tap stop when done)`);
      setCurrentTranscript('');
      setCurrentTranslation('');
    } catch (e: any) {
      Alert.alert('Recording error', e?.message || String(e));
    }
  }, [token, srcLabel, recorder]);

  // Stops whichever recorder is running; returns a URI whisperTranscribeFile can read ('' if nothing captured).
  const finishRecording = useCallback(async (): Promise<string> => {
    if (Platform.OS === 'web') {
      const mr = webRecorderRef.current;
      if (!mr) return '';
      const blob: Blob = await new Promise((resolve) => {
        mr.onstop = () => resolve(new Blob(webChunksRef.current, { type: mr.mimeType || 'audio/webm' }));
        mr.stop();
      });
      try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
      webRecorderRef.current = null;
      webStreamRef.current = null;
      webChunksRef.current = [];
      return blob.size ? URL.createObjectURL(blob) : '';
    }
    try { await recorder.stop(); } catch {}
    try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); } catch {}
    return recorder.uri || '';
  }, [recorder]);

  const stopAndProcess = useCallback(async () => {
    setPhase('transcribing');
    setStatusText('Transcribing…');
    try {
      const uri = await finishRecording();

      if (!uri) throw new Error('No recording URI');
      const langHint = ISO_TO_BCP47[srcLang] || 'en';
      let text: string;
      try {
        ({ text } = await whisperTranscribeFile(API_BASE, token!, uri, langHint));
      } finally {
        if (Platform.OS === 'web') URL.revokeObjectURL(uri);
      }
      if (!text.trim()) throw new Error('Could not hear anything. Please speak a little longer and try again.');
      setCurrentTranscript(text);

      setPhase('translating');
      setStatusText('Translating…');
      const translated = await translateText(text, srcLang, tgtLang);
      setCurrentTranslation(translated);

      setPhase('speaking');
      setStatusText(`Playing ${tgtLabel}…`);
      await playTTS(translated, tgtLang);

      const turn: Turn = { speaker: mode, original: text, translated };
      setTurns(prev => [...prev, turn]);
      setPhase('idle');
      setStatusText('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      setPhase('idle');
      setStatusText('');
      Alert.alert('Voice error', sttErrorToMessage(e));
    }
  }, [mode, srcLang, tgtLang, tgtLabel, token, translateText, playTTS, finishRecording]);

  const cancelRecording = useCallback(async () => {
    const uri = await finishRecording();
    if (uri && Platform.OS === 'web') URL.revokeObjectURL(uri);
    setPhase('idle');
    setStatusText('');
  }, [finishRecording]);

  if (!session) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={C.primary} />
      </SafeAreaView>
    );
  }

  const isRecording = phase === 'recording';
  const isBusy = phase !== 'idle' && phase !== 'recording';

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.langBadge}>
          <Text style={s.langBadgeText}>{touristLangName}</Text>
          <Ionicons name="swap-horizontal" size={16} color={C.gold} />
          <Text style={s.langBadgeText}>{localLang.label}</Text>
        </View>
        <Text style={s.headerSub}>Tap mic → speak → plays translation</Text>
        <Pressable
          style={s.langSwitch}
          onPress={() => { if (phase === 'idle') setShowLangPicker(v => !v); }}
          disabled={phase !== 'idle'}
        >
          <Ionicons name="language-outline" size={14} color={C.primary} />
          <Text style={s.langSwitchTxt}>Official&apos;s language: {localLang.label}</Text>
          <Ionicons name={showLangPicker ? 'chevron-up' : 'chevron-down'} size={14} color={C.primary} />
        </Pressable>
        {showLangPicker && (
          <View style={s.langOptions}>
            {LOCAL_LANG_OPTIONS.map(opt => (
              <Pressable
                key={opt.code}
                style={[s.langOption, localLang.code === opt.code && s.langOptionActive]}
                onPress={() => { setLocalLang(opt); setShowLangPicker(false); }}
              >
                <Text style={[s.langOptionTxt, localLang.code === opt.code && s.langOptionTxtActive]}>{opt.label} · {opt.native}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Mode toggle */}
      <View style={s.modeRow}>
        {(['tourist', 'official'] as Mode[]).map(m => (
          <Pressable
            key={m}
            style={[s.modeBtn, mode === m && s.modeBtnActive]}
            onPress={() => { if (phase === 'idle') setMode(m); }}
            disabled={phase !== 'idle'}
          >
            <Ionicons
              name={m === 'tourist' ? 'person-outline' : 'shield-checkmark-outline'}
              size={16}
              color={mode === m ? '#fff' : C.onSurfaceTertiary}
            />
            <Text style={[s.modeBtnText, mode === m && s.modeBtnTextActive]}>
              {m === 'tourist' ? `I speak (${touristLangName})` : `Official speaks (${localLang.label})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Conversation history */}
      <ScrollView ref={scrollRef} style={s.history} contentContainerStyle={s.historyContent}>
        {turns.length === 0 && (
          <View style={s.emptyHint}>
            <Ionicons name="language-outline" size={40} color={C.border} />
            <Text style={s.emptyText}>Conversation will appear here</Text>
          </View>
        )}
        {turns.map((turn, i) => (
          <View key={i} style={[s.bubble, turn.speaker === 'tourist' ? s.bubbleTourist : s.bubbleOfficial]}>
            <Text style={s.bubbleLabel}>
              {turn.speaker === 'tourist' ? `${touristLangName} → ${localLang.label}` : `${localLang.label} → ${touristLangName}`}
            </Text>
            <Text style={s.bubbleOriginal}>{turn.original}</Text>
            <View style={s.bubbleDivider} />
            <Text style={s.bubbleTranslated}>{turn.translated}</Text>
          </View>
        ))}

        {/* Live status */}
        {(currentTranscript || currentTranslation || statusText) && (
          <View style={s.liveCard}>
            {statusText ? <Text style={s.liveStatus}>{statusText}</Text> : null}
            {currentTranscript ? <Text style={s.liveTranscript}>{currentTranscript}</Text> : null}
            {currentTranslation ? (
              <Text style={s.liveTranslation}>{currentTranslation}</Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Mic button */}
      <View style={s.micRow}>
        {isRecording ? (
          <>
            <Pressable style={s.cancelBtn} onPress={cancelRecording}>
              <Ionicons name="close" size={22} color={C.error} />
            </Pressable>
            <Pressable style={[s.micBtn, s.micBtnRecording]} onPress={stopAndProcess}>
              <Ionicons name="stop" size={36} color="#fff" />
            </Pressable>
          </>
        ) : (
          <Pressable
            style={[s.micBtn, isBusy && s.micBtnDisabled]}
            onPress={startRecording}
            disabled={isBusy}
          >
            {isBusy
              ? <ActivityIndicator size="large" color="#fff" />
              : <Ionicons name="mic" size={36} color="#fff" />}
          </Pressable>
        )}
      </View>
      <Text style={s.micHint}>
        {isRecording
          ? `Speaking in ${srcLabel} → tap ■ to stop`
          : isBusy ? statusText
          : `Tap mic · ${srcLabel} → ${tgtLabel}`}
      </Text>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  header: { padding: 16, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.divider },
  langBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  langBadgeText: { fontSize: 16, fontWeight: '800', color: C.primary },
  headerSub:     { fontSize: 12, color: C.onSurfaceTertiary },
  langSwitch:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.navySoft },
  langSwitchTxt: { fontSize: 12, fontWeight: '700', color: C.primary },
  langOptions:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'center' },
  langOption:    { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  langOptionActive: { backgroundColor: C.primary, borderColor: C.primary },
  langOptionTxt: { fontSize: 12, fontWeight: '600', color: C.onSurface },
  langOptionTxtActive: { color: '#fff' },

  modeRow:          { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 8 },
  modeBtn:          {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  modeBtnActive:    { backgroundColor: C.primary, borderColor: C.primary },
  modeBtnText:      { fontSize: 12, fontWeight: '600', color: C.onSurfaceTertiary },
  modeBtnTextActive:{ color: '#fff' },

  history:        { flex: 1 },
  historyContent: { padding: 12, paddingBottom: 8 },

  emptyHint: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 13, color: C.border },

  bubble:          { borderRadius: 14, padding: 14, marginBottom: 10, maxWidth: '90%' },
  bubbleTourist:   { backgroundColor: C.navySoft, alignSelf: 'flex-end' },
  bubbleOfficial:  { backgroundColor: '#F0FFF4', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#A7F3D0' },
  bubbleLabel:     { fontSize: 10, fontWeight: '700', color: C.onSurfaceTertiary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  bubbleOriginal:  { fontSize: 14, color: C.onSurface, lineHeight: 20 },
  bubbleDivider:   { height: 1, backgroundColor: C.divider, marginVertical: 6 },
  bubbleTranslated:{ fontSize: 14, color: C.primary, fontWeight: '600', lineHeight: 20 },

  liveCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 8, gap: 6,
  },
  liveStatus:     { fontSize: 12, color: C.onSurfaceTertiary, fontStyle: 'italic' },
  liveTranscript: { fontSize: 14, color: C.onSurface },
  liveTranslation:{ fontSize: 14, color: '#059669', fontWeight: '700' },

  micRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 20 },
  micBtn:          {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  micBtnRecording: { backgroundColor: C.error },
  micBtnDisabled:  { backgroundColor: C.border },
  cancelBtn:       {
    width: 48, height: 48, borderRadius: 24, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.error,
  },
  micHint: { fontSize: 12, color: C.onSurfaceTertiary, textAlign: 'center', paddingBottom: 16 },
});
