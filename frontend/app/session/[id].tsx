import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { canSpeakNow, noteSpeakIntent } from '@/src/voice/speechGate';

type Msg = { id: string; role: string; content: string };
type Session = { id: string; title: string; language: string };

export default function SessionView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, language } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Holds whatever is currently playing (native expo-audio player + its
  // temp file, or a web HTMLAudioElement) so a second tap can stop it.
  const stopCurrentRef = useRef<(() => void) | null>(null);

  const stopSpeaking = useCallback(() => {
    try { stopCurrentRef.current?.(); } catch {}
    stopCurrentRef.current = null;
    setSpeakingId(null);
  }, []);

  useEffect(() => {
    (async () => {
      if (!token || !id) return;
      try {
        const r = await fetch(`${API_BASE}/api/chat/sessions/${id}/messages`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await r.json();
        setSession(data.session);
        setMessages(data.messages);
      } catch {}
      finally { setLoading(false); }
    })();
    return () => { stopSpeaking(); };
  }, [id, token, stopSpeaking]);

  // Cloud TTS (/api/voice/tts, Emergent-managed OpenAI TTS) — plays via
  // expo-audio on native (writes the returned mp3 to a cache file first)
  // and HTMLAudioElement on web. Tapping the same message's speaker icon
  // again stops playback.
  const speak = useCallback(async (mid: string, text: string) => {
    if (speakingId === mid) { stopSpeaking(); return; }
    stopSpeaking();
    // Talk to DHARA speech gate (inert when voice-companion flag is OFF).
    noteSpeakIntent();
    if (!canSpeakNow()) return;
    setSpeakingId(mid);
    try {
      const res = await fetch(`${API_BASE}/api/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, language: language?.code || 'en', voice: 'alloy' }),
      });
      if (!res.ok) throw new Error('TTS failed');

      if (Platform.OS === 'web') {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new (window as any).Audio(url);
        const finish = () => { URL.revokeObjectURL(url); setSpeakingId((cur) => (cur === mid ? null : cur)); };
        audio.onended = finish;
        audio.onerror = finish;
        stopCurrentRef.current = () => { try { audio.pause(); } catch {} finish(); };
        await audio.play();
        return;
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
      const file = new File(Paths.cache, `dhara-session-tts-${Date.now()}.mp3`);
      try { if (file.exists) file.delete(); } catch {}
      file.create();
      file.write(base64, { encoding: 'base64' } as any);

      const player = createAudioPlayer({ uri: file.uri });
      const finish = () => { try { player.remove(); } catch {} try { file.delete(); } catch {} setSpeakingId((cur) => (cur === mid ? null : cur)); };
      const sub = player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish) { try { sub.remove(); } catch {} finish(); }
      });
      stopCurrentRef.current = () => { try { sub.remove(); } catch {} try { player.pause(); } catch {} finish(); };
      player.play();
    } catch {
      setSpeakingId((cur) => (cur === mid ? null : cur));
    }
  }, [speakingId, language, token, stopSpeaking]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="session-view">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="back-btn" hitSlop={10}>
          <Ionicons name="arrow-back" size={26} color={theme.colors.brand} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{session?.title || 'Conversation'}</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {messages.map(m => (
            <View key={m.id} style={[styles.msg, m.role === 'user' ? styles.userMsg : styles.aiMsg]}>
              <View style={styles.msgHeader}>
                <Text style={[styles.msgRole, m.role === 'user' ? styles.userRole : styles.aiRole]}>
                  {m.role === 'user' ? 'You' : 'Dhara'}
                </Text>
                {m.role === 'assistant' && (
                  <Pressable onPress={() => speak(m.id, m.content)} hitSlop={10} testID={`speak-${m.id}`}>
                    <Ionicons name={speakingId === m.id ? 'stop-circle' : 'volume-high-outline'} size={22} color={theme.colors.brand} />
                  </Pressable>
                )}
              </View>
              <Text style={[styles.msgText, m.role === 'user' ? styles.userText : styles.aiText]}>{m.content}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.fonts.display, fontSize: 17, color: theme.colors.brand, fontWeight: '700', marginHorizontal: theme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  msg: { marginBottom: theme.spacing.lg, borderRadius: theme.radius.lg, padding: theme.spacing.lg },
  userMsg: { backgroundColor: theme.colors.brand, alignSelf: 'flex-end', maxWidth: '90%', borderBottomRightRadius: 4 },
  aiMsg: { backgroundColor: theme.colors.surfaceSecondary, alignSelf: 'flex-start', maxWidth: '100%', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: theme.colors.border },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.xs, alignItems: 'center' },
  msgRole: { fontSize: 12, fontWeight: '700' },
  userRole: { color: theme.colors.brandSecondary },
  aiRole: { color: theme.colors.brand },
  msgText: { fontSize: 15, lineHeight: 22 },
  userText: { color: theme.colors.onBrandPrimary },
  aiText: { color: theme.colors.onSurface },
});
