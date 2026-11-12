import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Platform, ActivityIndicator, Modal, Animated, PanResponder, AppState, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { crossAlert } from '@/src/utils/crossAlert';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  createAudioPlayer,
  type AudioPlayer,
} from 'expo-audio';
import { speakNative, stopNativeTTS } from '@/src/voice/native-tts';
import { ChunkedSpeaker } from '@/src/voice/tts';
import { createBrowserTtsPlayer } from '@/src/voice/browserPlayer';
import { VoiceNotice } from '@/src/components/VoiceNotice';
import { File, Paths } from 'expo-file-system';
import { useAuth, API_BASE, logClientError } from '@/src/auth';
import { useUserProfile } from '@/src/userProfile';
import { theme } from '@/src/theme';
import { trackEvent } from '@/src/analytics';
import { getConfiguredSTT, whisperTranscribeFile, sttErrorToMessage, MAX_AUDIO_BYTES, AUDIO_TOO_LARGE_MESSAGE } from '@/src/voice/stt';
import { claimMic, MIC_BUSY_MESSAGE, withMicLease, isMicHeldByEvidenceLocker, TTS_BLOCKED_BY_LOCKER_MESSAGE, type MicLease } from '@/src/voice/micArbiterGuard';
import { canSpeakNow, noteAudioInterruption, noteSpeakIntent, VOICE_COMPANION_ENABLED } from '@/src/voice/speechGate';
import { VoiceStateMachine } from '@/src/voice/core/voiceStateMachine';
import { needsConfirmation } from '@/src/voice/core/voicePolicy';
import { classifyFact } from '@/src/voice/factClassifier';
import { addBookmark } from '@/src/bookmarks';
import { t } from '@/src/i18n';
import { MarqueeBanner } from '@/src/components/MarqueeBanner';
import { verifiedLabel, isStale, STALE_WARNING_TEXT } from '@/src/citationStaleness';
// ── Phase 1 + D1-V: Code-phrase and discreet-screen intercepts ───────────────
import { getStoredPhrase, getHidePhrase } from '@/src/women/codePhraseStore';
import { isCodePhraseMatch } from '@/src/women/codePhraseMatcher';
import { triggerSafetySequence } from '@/src/women/safetyTriggerCoordinator';
import { useEvidenceRecorder } from '@/src/women/EvidenceRecorderProvider';
import { activateCover } from '@/src/women/coverState';

import { SosEmergencyBanner, EmergencyCallShortcut } from '@/src/chat/EmergencyBanners';
import { getBasicSuggestions, getProSuggestions, TOPIC_SUGGESTIONS } from '@/src/chat/suggestions';
import {
  stripStreamMarkdown, nextStepFor, detectFirIntent, splitVerdict, generateId,
  isIpcCitation, looksLikeDanger,
} from '@/src/chat/messageUtils';
import type { Citation, Msg } from '@/src/chat/types';
import { styles } from '@/src/chat/chatStyles';

const CANCEL_THRESHOLD = -80; // px the user must drag left to cancel
const LOCK_THRESHOLD = -55; // px the user must drag up to lock hands-free recording



// Batch FREE-V1-001: Pro upgrade / Stripe / Razorpay payment UI gated off for v1.
const PRO_UPGRADE_ENABLED = process.env.EXPO_PUBLIC_PRO_UPGRADE_ENABLED === 'true';

export default function ChatScreen() {
  const { token, user, language, autoSpeak, ttsVolume, ttsVoiceMode, refreshUser, forceLogout } = useAuth();
  const { primaryInterest } = useUserProfile();
  // Phase 1: shared evidence recorder from provider (needed for safety trigger)
  const { startTriggerRecording } = useEvidenceRecorder();
  const router = useRouter();
  const entryParams = useLocalSearchParams<{ draft?: string; entry?: string; voiceHint?: string; autostartMic?: string; topicId?: string }>();
  const focused = useIsFocused();
  const lastMicEntry = useRef<string | undefined>(undefined);
  const micStartingRef = useRef(false);
  const lastEntry = useRef<string | undefined>(undefined);

  const [messages, setMessages] = useState<Msg[]>([]);
  // Per-message toggle for the "View Legal Details" summary-first disclosure.
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [proMode, setProMode] = useState(false);
  const [paywall, setPaywall] = useState<null | {
    samples_used: number;
    samples_limit: number;
    pro_price_label: string;
    pro_price_usd_label: string;
    message: string;
  }>(null);
  const [samplesRemaining, setSamplesRemaining] = useState<number | null>(null);
  // Guest Mode: 5-question quota banner/limit state, driven by SSE "session"
  // and "guest_limit_reached" frames from /api/chat/stream.
  // DHARA-B015: the old initializer always hardcoded warning/limitReached to
  // false regardless of the already-exhausted count/limit from `user` — so
  // reopening a capped Guest chat showed a writable input again until a
  // doomed-to-fail submit came back with a generic "No response received"
  // error. Compute the real state up front, and re-sync if `user` changes.
  const computeGuestQuota = (u: typeof user) => {
    const count = u?.guest_question_count ?? 0;
    const limit = u?.guest_question_limit ?? 5;
    const limitReached = count >= limit;
    return {
      count, limit,
      warning: !limitReached && count >= limit - 1,
      limitReached,
      limitMessage: limitReached ? "You've reached the guest limit. Create a free account to continue." : null,
    };
  };
  const [guestQuota, setGuestQuota] = useState<{
    count: number; limit: number; warning: boolean; limitReached: boolean; limitMessage: string | null;
  }>(() => computeGuestQuota(user));
  useEffect(() => {
    if (user?.is_guest) setGuestQuota(computeGuestQuota(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.is_guest, user?.guest_question_count, user?.guest_question_limit]);
  const [, setSttProviderLabel] = useState<string>('');
  // WhatsApp-style voice UX state
  const [transcriptPreview, setTranscriptPreview] = useState<string>('');
  const [showTranscriptModal, setShowTranscriptModal] = useState<boolean>(false);
  // Set when the backend detects the transcript's script doesn't match the
  // selected language (e.g. Telugu selected but Whisper mis-heard it as
  // Kannada — the two scripts are visually similar to the model). Never
  // blocks sending — just makes the mismatch impossible to miss in the
  // "We heard" modal before the user taps send.
  const [transcriptMismatch, setTranscriptMismatch] = useState<{ detected: string | null } | null>(null);
  const [holdElapsed, setHoldElapsed] = useState<number>(0);
  const [slideCancelled, setSlideCancelled] = useState<boolean>(false);
  // TTS playback speed — cycles 1x → 1.5x → 2x → back
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  // Loading state for TTS fetch (network request in-flight) — separate from speakingId
  // so the UI can show a spinner before audio is ready, and stop is always reliable.
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  // AbortController to cancel an in-flight TTS fetch when the user taps stop
  const ttsAbortRef = useRef<AbortController | null>(null);
  const holdTimerRef = useRef<any>(null);
  // Animated values for WhatsApp-style mic gesture
  const slideX = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(0)).current;
  const micPulse = useRef(new Animated.Value(1)).current;
  const slideCancelledRef = useRef(false);
  /**
   * Web only. `Alert.alert` is a complete no-op on react-native-web — it
   * never renders anything — so every mic/permission error on the web build
   * used to vanish silently (the button just looked broken). This banner is
   * the web fallback UI; native platforms keep using the real OS alert via
   * `notify()` below.
   */
  const [voiceBanner, setVoiceBanner] = useState<{ title: string; message: string } | null>(null);
  // SOS emergency banner: shown after a bare-distress reply (c1_sos SSE flag)
  const [hasSosBanner, setHasSosBanner] = useState(false);
  const voiceBannerTimerRef = useRef<any>(null);
  const notify = useCallback((title: string, message: string) => {
    if (Platform.OS === 'web') {
      if (voiceBannerTimerRef.current) clearTimeout(voiceBannerTimerRef.current);
      setVoiceBanner({ title, message });
      voiceBannerTimerRef.current = setTimeout(() => setVoiceBanner(null), 7000);
    } else {
      crossAlert(title, message);
    }
  }, []);
  // Hands-free "locked" recording — set by dragging the mic straight up,
  // exactly like WhatsApp. Once locked, releasing the finger no longer stops
  // the recording; the user must tap the explicit stop/cancel buttons.
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  // Five bars driven by plain Animated loops (not native audio metering — that
  // API is flaky across Android OEMs / web in Expo's own bug tracker) so the
  // "listening" waveform looks and behaves identically on every phone.
  const waveBars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.3))).current;
  const scrollRef = useRef<ScrollView>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const nativeSTTHandleRef = useRef<{ stop: () => Promise<any> } | null>(null);
  // Web MediaRecorder refs — used for browser-based audio recording
  const webRecorderRef = useRef<any>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const webStreamRef = useRef<any>(null);
  // Talk to DHARA — shared single-owner mic lease (noop when arbiter flag OFF).
  const micLeaseRef = useRef<MicLease | null>(null);
  const releaseMicLease = useCallback(() => { micLeaseRef.current?.release(); micLeaseRef.current = null; }, []);
  // Talk to DHARA — Step 5 voice flow. Inert when VOICE_COMPANION_ENABLED is
  // OFF: tryTo() is simply never called, so this never affects behaviour.
  const voiceSMRef = useRef<VoiceStateMachine | null>(null);
  if (VOICE_COMPANION_ENABLED && !voiceSMRef.current) voiceSMRef.current = new VoiceStateMachine();
  // True when the heard transcript is an answer-changing fact (date, amount,
  // section number, state) per needsConfirmation() — shows an extra "check
  // this carefully" hint in the "We heard" modal. Free-text speech (the
  // normal case on this screen) never sets this.
  const [transcriptNeedsExtraCare, setTranscriptNeedsExtraCare] = useState(false);
  // Race-condition guard: onPressIn is synchronous, startRecording is async.
  // If the user releases the mic BEFORE the async permission/init finishes,
  // the onPressOut closure captures a stale `recording === false` and misses
  // stopping the recording, which then runs silently forever ("loop" bug).
  // This ref is set synchronously on press-in/out and consulted throughout
  // the async flow so we always know the user's current intent.
  const isMicHeldRef = useRef<boolean>(false);
  // P0-A: Set true while the native permission dialog is showing, so the
  // AppState 'background' event triggered by Android's dialog does not
  // cancel the mic flow before it even begins.
  const permissionPhaseRef = useRef<boolean>(false);
  // Cloud TTS player + cleanup — we lazily create an AudioPlayer per playback
  // and keep the ref so we can stop it (user taps stop / speaks another
  // message / navigates away).
  const ttsPlayerRef = useRef<AudioPlayer | null>(null);
  const ttsPlayerReleaseTimerRef = useRef<any>(null);
  /** Active chunked speaker, so stopCloudTTS() can tear the whole queue down. */
  const speakerRef = useRef<ChunkedSpeaker | null>(null);
  const browserAudioRef = useRef<HTMLAudioElement | null>(null);
  const [blockedVoiceId, setBlockedVoiceId] = useState<string | null>(null);
  /**
   * Conversation generation counter. Incremented each time the user starts a
   * new conversation so that a racing SSE session-frame from the *previous*
   * request cannot overwrite the freshly-assigned session ID.
   */
  const convKeyRef = useRef<number>(0);
  /**
   * Web only. `HTMLMediaElement.play()` returns a promise that the browser
   * REJECTS with an AbortError ("The play() request was interrupted by a call
   * to pause()") if pause() runs before that promise settles. expo-audio's web
   * player (AudioModule.web.js: `play() { this.media.play(); ... }`) never
   * captures that promise, so the rejection is unhandled and lands in the
   * console as an uncaught error. It fires whenever WE intentionally cut
   * playback short — mic pressed mid-speech, speaker tapped again mid-clip, or
   * navigating away while a clip is still starting — which is expected browser
   * behaviour, not a real failure. `createPlayer().remove()` below sets this to
   * a near-future timestamp right before calling pause()/remove(); the listener
   * only silences the AbortError while "now" is inside that window, so a
   * genuine playback failure anywhere else in the app is never hidden.
   */
  const suppressAudioAbortUntilRef = useRef<number>(0);
  // Mirror `speakingId` in a ref so async cleanup callbacks can see the
  // latest value without stale-closure issues.
  const speakingIdRef = useRef<string | null>(null);
  useEffect(() => {
    speakingIdRef.current = speakingId;
  }, [speakingId]);
  // Forward-declared ref to `speak` so auto-speak logic inside `send` can call it
  // without a circular dependency (speak is defined AFTER send in this file).
  const speakRef = useRef<((msgId: string, text: string, userInitiated?: boolean) => void) | null>(null);

  // Home hands the question over without sending it before the user confirms.
  useEffect(() => {
    if (!entryParams.entry || lastEntry.current === entryParams.entry) return;
    lastEntry.current = entryParams.entry;
    setInput(entryParams.draft || '');
    if (entryParams.voiceHint === '1') notify('Ask by voice', 'Hold the gold microphone below to speak. Release to review your question.');
  }, [entryParams.entry, entryParams.draft, entryParams.voiceHint, notify]);

  // Global unmount cleanup — critical for preventing app crashes when the user
  // navigates away while the mic is still recording. Without this, the STT
  // module keeps a live audio input stream that the OS eventually kills with
  // a native exception (which manifests as "Something went wrong with Msafe
  // DHARA" on some Android ROMs).
  useEffect(() => {
    return () => {
      // Stop any active STT handle
      if (nativeSTTHandleRef.current) {
        try {
          nativeSTTHandleRef.current.stop();
        } catch {}
        nativeSTTHandleRef.current = null;
      }
      // Stop any web MediaRecorder
      try { webRecorderRef.current?.stop(); } catch {}
      try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
      webRecorderRef.current = null;
      webStreamRef.current = null;
      // Kill the hold-to-talk elapsed-time interval
      if (holdTimerRef.current) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      // Stop any ongoing cloud TTS playback. The ChunkedSpeaker instance owns
      // the actual player (see `speak` below) — without this, navigating away
      // mid-answer left the clip playing in the background forever, since
      // nothing here previously reached the real player at all.
      try { speakerRef.current?.stop(); } catch {}
      speakerRef.current = null;
      try {
        const p = ttsPlayerRef.current;
        if (p) {
          try { p.pause(); } catch {}
          try { p.remove(); } catch {}
        }
      } catch {}
      ttsPlayerRef.current = null;
      if (ttsPlayerReleaseTimerRef.current) {
        clearTimeout(ttsPlayerReleaseTimerRef.current);
        ttsPlayerReleaseTimerRef.current = null;
      }
    };
  }, []);

  // Web only: silence the specific, expected AbortError described above the
  // `suppressAudioAbortUntilRef` declaration — and ONLY that error, and ONLY
  // inside the brief window our own teardown code flags. Every other
  // unhandled rejection in the app is left completely untouched.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onUnhandledRejection = (event: any) => {
      const reason = event?.reason;
      const isPlayPauseAbort =
        !!reason &&
        (reason.name === 'AbortError' ||
          String(reason?.message || '')
            .toLowerCase()
            .includes('interrupted by a call to pause'));
      if (isPlayPauseAbort && Date.now() <= suppressAudioAbortUntilRef.current) {
        event.preventDefault?.();
      }
    };
    (globalThis as any).addEventListener?.('unhandledrejection', onUnhandledRejection);
    return () => {
      (globalThis as any).removeEventListener?.('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  const isPro = !!user?.is_pro;
  // `remaining` tracks pro-mode samples left — used by the backend 402 paywall flow.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const remaining =
    samplesRemaining !== null
      ? samplesRemaining
      : (user?.pro_samples_remaining ?? user?.pro_samples_limit ?? 5);

  // Auto-enable pro mode once we know the user is a Pro subscriber.
  // This replaces the removed manual toggle — pro users always get pro-quality
  // answers and pro suggestion chips; non-pro users stay in basic mode.
  useEffect(() => {
    if (isPro) setProMode(true);
  }, [isPro]);

  // Keep the usage meter fresh the moment the chat screen opens, not just
  // after the first message is sent.
  useEffect(() => {
    refreshUser().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P0 fix: the elapsed-time overlay timer now starts only once `recording`
  // genuinely becomes true (after the recorder/web MediaRecorder actually
  // started), and stops/resets the instant `recording` goes false for ANY
  // reason — success, cancel, or a failed start. Previously the timer was
  // kicked off synchronously in onMicPressIn, before any of the async
  // permission/prepare/record work below even began, so a slow permission
  // dialog or a failed start could show a running (or frozen) clock while
  // nothing was actually being captured.
  useEffect(() => {
    if (recording) {
      setHoldElapsed(0);
      holdTimerRef.current = setInterval(() => {
        setHoldElapsed((prev) => prev + 1);
      }, 1000);
    } else if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    return () => {
      if (holdTimerRef.current) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, [recording]);

  // Live waveform while recording — purely visual, driven by looping Animated
  // timings (no dependency on native audio-level metering, which is known to
  // be unreliable on several Android OEMs and always-undefined on web).
  useEffect(() => {
    const loops: Animated.CompositeAnimation[] = [];
    if (recording) {
      waveBars.forEach((bar, i) => {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(bar, { toValue: 0.35 + Math.random() * 0.65, duration: 260 + i * 35, useNativeDriver: false }),
            Animated.timing(bar, { toValue: 0.15 + Math.random() * 0.25, duration: 260 + i * 35, useNativeDriver: false }),
          ]),
        );
        loop.start();
        loops.push(loop);
      });
    } else {
      waveBars.forEach((bar) => {
        bar.stopAnimation();
        bar.setValue(0.3);
      });
    }
    return () => { loops.forEach((l) => l.stop()); };
  }, [recording, waveBars]);

  /** Live waveform bars — rendered next to the recording timer and inside the
   * locked hands-free bar. Purely decorative "is listening" feedback. */
  const Waveform = () => (
    <View style={styles.waveformRow} testID="voice-waveform">
      {waveBars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            { height: bar.interpolate({ inputRange: [0, 1], outputRange: [4, 22] }) },
          ]}
        />
      ))}
    </View>
  );


  // Configure audio mode for playback
  useEffect(() => {
    (async () => {
      try {
        // P0-A: skip entirely if the Evidence Locker is already recording
        // when this screen mounts — this call is global and would
        // reconfigure its session away from allowsRecording.
        if (Platform.OS !== 'web' && !isMicHeldByEvidenceLocker()) {
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        }
      } catch {}
    })();
    return () => {
      // Cloud TTS cleanup handled by the earlier unmount effect above.
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || streaming || !token) return;
      // T1: a guest at the quota limit is normally blocked, BUT a present-danger
      // / distress message must still reach the backend (it replies with 112 and
      // consumes no quota). Ordinary messages at the limit stay blocked.
      if (user?.is_guest && guestQuota.limitReached && !looksLikeDanger(q)) { setInput(''); return; }

      // ── Phase 1: Code-phrase safety intercept ────────────────────────────
      // SOS phrase is evaluated FIRST (amendment 1) so an SOS phrase cannot be
      // accidentally consumed by the D1-V hide-phrase check.
      // This MUST run before trackEvent / setMessages so the phrase is never
      // sent to analytics, the backend, or rendered in the chat history.
      if (process.env.EXPO_PUBLIC_SAFE_WORD_V1 !== 'false') {
        try {
          const stored = await getStoredPhrase();
          if (stored && isCodePhraseMatch(q, stored)) {
            // Phrase matched — trigger safety sequence, swallow the message.
            const scope = user?.id || 'device';
            await triggerSafetySequence({
              scope,
              startEvidenceRecording: startTriggerRecording,
              navigateToSilentAlert: () => router.push('/women/silent-alert'),
            });
            setInput('');
            return; // DO NOT send to LLM, analytics, or chat history
          }
        } catch {
          // Any error in the intercept must not block normal chat.
        }
      }

      // ── D1-V: Discreet-screen phrase check (runs after SOS — amendment 1) ──
      // Foreground voice-phrase => screen-privacy activation. Reads the hide
      // phrase from codePhraseStore (SecureStore for auth users, in-memory
      // for guests). Uses the same normalizePhrase() as the Safety phrases
      // screen's conflict gate so matching is always consistent.
      if (process.env.EXPO_PUBLIC_SAFE_WORD_V1 !== 'false') {
        try {
          const storedHide = await getHidePhrase();
          if (storedHide && isCodePhraseMatch(q, storedHide)) {
            const d1Scope = user?.id || 'device';
            // activateCover() sets the in-memory flag IMMEDIATELY (synchronous
            // _active = true + listener emit) then persists to AsyncStorage
            // as a best-effort background write.  The cover UI reacts to the
            // listener emit — no AppState round-trip required.
            // GATE NOTE: PrivacyCoverGate in _layout.tsx only renders when
            // EXPO_PUBLIC_PRIVACY_COVER_V1 === 'true'.  This call is always
            // correct; if the flag is off the cover simply won't be visible.
            await activateCover(d1Scope);
            setInput('');
            return; // DO NOT send to LLM, analytics, or chat history
          }
        } catch {
          // Any error in the D1-V intercept must not block normal chat.
        }
      }
      // ── End code-phrase intercept ─────────────────────────────────────────

      const userId = Math.random().toString(36).slice(2);
      const assistantId = Math.random().toString(36).slice(2);
      const modeToSend: 'basic' | 'pro' = proMode ? 'pro' : 'basic';
      // DPDP: send only length + language code, never the query text itself
      trackEvent('ask_ai_submit', { input_length: q.length, language: language.code, mode: modeToSend });
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: q },
        { id: assistantId, role: 'assistant', content: '', mode: modeToSend, firIntent: detectFirIntent(q) },
      ]);
      setInput('');
      setStreaming(true);

      const isNative = Platform.OS !== 'web';

      // Builds the request fresh each time — needed both for the initial
      // attempt and for the one allowed retry (a failed/consumed response
      // body can't be re-read; only a brand-new fetch can be retried).
      const doFetch = () =>
        fetch(`${API_BASE}/api/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            message: q,
            session_id: sessionId,
            language: language.code,
            language_name: language.name,
            language_native: language.native,
            mode: modeToSend,
          }),
        });

      try {
        // Native-only: a chunked SSE response can occasionally fail with a
        // network-level error (connection reset, timeout, incomplete body)
        // on a real Android device even though the server answered fine —
        // confirmed by testing the same request directly against the
        // deployed backend. Retry ONCE, only for that class of failure —
        // never for a completed HTTP response (4xx/5xx), which is a real
        // answer from the server and must never be silently retried.
        let res: Response;
        try {
          res = await doFetch();
        } catch (networkErr) {
          logClientError(token, 'chat_stream_fetch', networkErr, { retried: isNative });
          if (!isNative) throw networkErr;
          await new Promise((r) => setTimeout(r, 700));
          res = await doFetch(); // second and final attempt — no further retry
        }

        // Session expired mid-use (token invalid/expired) — log the user out
        // and let the auth guard route to /login with the right message,
        // instead of showing a generic chat error in the answer bubble.
        if (res.status === 401) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userId));
          await forceLogout();
          return;
        }

        // Paywall (HTTP 402) — pro-mode sample quota exhausted
        // Daily LLM spend cap (HTTP 429) — show the plain-language message in
        // the answer bubble instead of a technical error.
        if (res.status === 429) {
          const body = await res.json().catch(() => null);
          const msg =
            body?.detail?.message ||
            'You have reached your daily question limit. Please try again tomorrow.';
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: msg } : m)),
          );
          return;
        }

        if (res.status === 402) {
          const body = await res.json();
          const pw = body?.detail || body;
          setPaywall({
            samples_used: pw.samples_used,
            samples_limit: pw.samples_limit,
            pro_price_label: pw.pro_price_label,
            pro_price_usd_label: pw.pro_price_usd_label,
            message: pw.message,
          });
          setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userId));
          return;
        }

        if (!res.ok) {
          // Never render raw response bodies. Show a sanitized human message.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: 'Something went wrong. Please try again.' }
                : m
            )
          );
          return;
        }

        /**
         * Parse SSE frames. Handles: session (control), citation (verified source),
         * delta (streaming text), final (sanitized full text — overwrites), error.
         * Only text-bearing frames update the UI. Metadata frames are handled internally.
         */
        // Jurisdiction metadata frames — mutated in place by the parser below.
        // Capture the conversation key at request-start so we can guard the
        // SSE session-frame update against a stale in-flight response.
        const capturedConvKey = convKeyRef.current;
        const stateMeta: { prompt: string | null; note: string | null } = { prompt: null, note: null };
        const sosMeta: { triggered: boolean } = { triggered: false };
        const guestMeta: {
          count: number | null; limit: number | null; warning: boolean;
          limitReached: boolean; limitMessage: string | null;
        } = { count: null, limit: null, warning: false, limitReached: false, limitMessage: null };
        const parseSseBuffer = (
          buf: string,
          prevAcc: string,
          prevFinal: string | null,
          prevCitations: Citation[],
        ): {
          acc: string;
          final: string | null;
          citations: Citation[];
          rest: string;
          hadError: boolean;
        } => {
          let acc = prevAcc;
          let finalText = prevFinal;
          let citations = [...prevCitations];
          let hadError = false;
          const parts = buf.split('\n\n');
          const rest = parts.pop() || '';
          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;
            let payload: any;
            try {
              payload = JSON.parse(jsonStr);
            } catch {
              continue;
            }
            if (!payload || typeof payload !== 'object' || !('type' in payload)) continue;
            switch (payload.type) {
              case 'session':
                // Only update if we are still in the same conversation
                // generation (i.e. startNewChat wasn't pressed mid-stream).
                if (payload.session_id && capturedConvKey === convKeyRef.current) {
                  setSessionId(payload.session_id);
                }
                if (typeof payload.samples_remaining_after === 'number') {
                  setSamplesRemaining(payload.samples_remaining_after);
                }
                if (payload.guest === true) {
                  if (typeof payload.guest_question_count === 'number') guestMeta.count = payload.guest_question_count;
                  if (typeof payload.guest_question_limit === 'number') guestMeta.limit = payload.guest_question_limit;
                  if (payload.guest_warning === true) guestMeta.warning = true;
                }
                break;
              case 'guest_limit_reached':
                guestMeta.limitReached = true;
                if (typeof payload.message === 'string') guestMeta.limitMessage = payload.message;
                break;
              case 'citation':
                if (payload.citation && typeof payload.citation === 'object') {
                  citations.push(payload.citation as Citation);
                }
                break;
              case 'delta':
                if (typeof payload.content === 'string') acc += payload.content;
                if (payload.c1_sos === true) sosMeta.triggered = true;
                break;
              case 'final':
                // Sanitized full text — overwrites any accumulated delta output.
                if (typeof payload.content === 'string') finalText = payload.content;
                break;
              case 'state_prompt':
                if (typeof payload.message === 'string') stateMeta.prompt = payload.message;
                break;
              case 'state_note':
                if (typeof payload.message === 'string') stateMeta.note = payload.message;
                break;
              case 'error':
                hadError = true;
                break;
              default:
                break;
            }
          }
          return { acc, final: finalText, citations, rest, hadError };
        };

        // Native React Native fetch returns res.body === null (no streaming).
        // Web fetch returns a ReadableStream. Handle both.
        const canStream = !!(res.body && typeof (res.body as any).getReader === 'function');

        let acc = '';
        let finalText: string | null = null;
        let citations: Citation[] = [];
        let hadError = false;

        try {
          if (canStream) {
            const reader = (res.body as any).getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const parsed = parseSseBuffer(buffer, acc, finalText, citations);
              acc = parsed.acc;
              finalText = parsed.final;
              citations = parsed.citations;
              buffer = parsed.rest;
              if (parsed.hadError) hadError = true;
              const displayText = finalText !== null ? finalText : stripStreamMarkdown(acc);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: displayText, citations } : m,
                ),
              );
              scrollRef.current?.scrollToEnd({ animated: true });
            }
            if (buffer.trim()) {
              const parsed = parseSseBuffer(buffer + '\n\n', acc, finalText, citations);
              acc = parsed.acc;
              finalText = parsed.final;
              citations = parsed.citations;
              if (parsed.hadError) hadError = true;
            }
          } else {
            // React Native path: read the full response and parse all frames
            // at once. Retry ONCE if the read itself throws (connection
            // reset) OR the body came back truncated (no "done" frame — the
            // server was still mid-stream when the connection dropped) —
            // both are network-level failures, not a real answer from the
            // server, so they're safe to retry (unlike a completed 4xx/5xx,
            // already handled above and never reaches this branch).
            let fullText: string;
            try {
              fullText = await res.text();
              if (!/"type":\s*"done"/.test(fullText)) throw new Error('incomplete_sse_body');
            } catch (readErr) {
              logClientError(token, 'chat_stream_native_read', readErr, { retried: true });
              await new Promise((r) => setTimeout(r, 700));
              const retryRes = await doFetch();
              if (retryRes.status === 401) {
                setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userId));
                await forceLogout();
                return;
              }
              if (!retryRes.ok) {
                hadError = true;
                fullText = '';
              } else {
                fullText = await retryRes.text(); // if this also throws, propagate — no third attempt
              }
            }
            if (fullText) {
              const parsed = parseSseBuffer(fullText + '\n\n', '', null, []);
              acc = parsed.acc;
              finalText = parsed.final;
              citations = parsed.citations;
              hadError = hadError || parsed.hadError;
            }
          }
        } catch (readOrParseErr) {
          logClientError(token, 'chat_stream_native_read', readOrParseErr);
          hadError = true;
        }

        const displayText = finalText !== null ? finalText : stripStreamMarkdown(acc);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: displayText.trim().length
                    ? displayText
                    : (hadError
                        ? 'Something went wrong. Please try again.'
                        : 'No response received. Please try again.'),
                  citations,
                  statePrompt: stateMeta.prompt || undefined,
                  stateNote: stateMeta.note || undefined,
                }
              : m,
          ),
        );

        // -------- Guest Mode: quota banner state + analytics --------
        if (user?.is_guest) {
          trackEvent('guest_question_asked', { count: guestMeta.count ?? undefined });
          setGuestQuota((prev) => ({
            count: guestMeta.count ?? prev.count,
            limit: guestMeta.limit ?? prev.limit,
            warning: guestMeta.warning,
            limitReached: guestMeta.limitReached || prev.limitReached,
            limitMessage: guestMeta.limitMessage ?? prev.limitMessage,
          }));
          if (guestMeta.warning) trackEvent('guest_limit_warning');
          if (guestMeta.limitReached) trackEvent('guest_limit_reached');
        }

        // SOS emergency banner: show when the backend flagged c1_sos
        if (sosMeta.triggered) {
          setHasSosBanner(true);
        }

        // Auto-speak the reply if the user has that setting on and we got real text
        if (autoSpeak && displayText.trim().length && !hadError) {
          // slight delay so the message renders before speech starts
          setTimeout(() => {
            speakRef.current?.(assistantId, displayText, false);
          }, 250);
        }

        // Fetch follow-up question chips in the background (fire-and-forget).
        // Never blocks the main answer — if it fails, chips simply don't appear.
        if (!hadError && displayText.trim().length > 20 && token) {
          (async () => {
            try {
              const fqRes = await fetch(`${API_BASE}/api/chat/followup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  message: q,
                  answer: displayText.slice(0, 500),
                  language: language.code,
                  language_name: language.name,
                }),
              });
              if (fqRes.ok) {
                const fqData = await fqRes.json();
                const questions: string[] = Array.isArray(fqData.questions)
                  ? fqData.questions.filter((x: any) => typeof x === 'string' && x.trim().length > 0).slice(0, 3)
                  : [];
                if (questions.length > 0) {
                  setMessages((prev) =>
                    prev.map((m) => m.id === assistantId ? { ...m, followUpQuestions: questions } : m),
                  );
                }
              }
            } catch {}
          })();
        }

        try {
          await refreshUser();
        } catch {}
      } catch (outerErr) {
        // Never render raw errors, stream contents, or JSON to the user —
        // but capture the real exception so a repeat gives a real diagnosis.
        logClientError(token, 'chat_stream_outer', outerErr);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: 'Network error. Please check your connection and try again.' }
              : m
          )
        );
      } finally {
        setStreaming(false);
      }
    },
    [streaming, token, sessionId, language, proMode, refreshUser, autoSpeak, forceLogout, user, guestQuota.limitReached, startTriggerRecording, router]
  );

  /**
   * Cloud TTS via /api/voice/tts. Records audio bytes returned by the backend
   * (which uses OpenAI TTS through the Emergent LLM Key) into a temp cache
   * file, then plays it back with expo-audio. Works on ALL devices — no OS
   * voice pack required. This is the "WhatsApp-style" fix for the fact that
   * on-device expo-speech silently no-ops on many Android OEMs (Samsung,
   * Xiaomi, etc.) that ship non-Google TTS engines by default.
   */
  const stopCloudTTS = useCallback(() => {
    setBlockedVoiceId(null);
    // Kill the whole chunk queue first — otherwise the next clip starts playing
    // after the user has asked for silence (or opened the mic).
    try {
      speakerRef.current?.stop();
    } catch {}
    speakerRef.current = null;
    // Cancel any in-flight TTS network request so it can't sneak through
    // after the user has tapped stop.
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    setTtsLoadingId(null);
    // Debounce / cleanup helper for the AudioPlayer ref.
    try {
      const p = ttsPlayerRef.current;
      if (p) {
        try { p.pause(); } catch {}
        try { p.remove(); } catch {}
      }
    } catch {}
    ttsPlayerRef.current = null;
    if (ttsPlayerReleaseTimerRef.current) {
      clearTimeout(ttsPlayerReleaseTimerRef.current);
      ttsPlayerReleaseTimerRef.current = null;
    }
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    async (msgId: string, text: string, userInitiated: boolean = true) => {
      if (blockedVoiceId === msgId && speakerRef.current?.playbackBlocked) {
        speakerRef.current.retryPlayback();
        return;
      }
      // Toggle: tapping speaker while loading OR playing immediately stops
      if (speakingId === msgId || ttsLoadingId === msgId) {
        stopCloudTTS();
        stopNativeTTS();
        return;
      }
      // Any other playback -> stop it first
      stopCloudTTS();
      stopNativeTTS();

      if (!text || !text.trim() || !token) return;

      // Talk to DHARA speech gate (inert when voice-companion flag is OFF).
      if (userInitiated) noteSpeakIntent();
      if (!canSpeakNow()) {
        if (userInitiated) notify('Voice is off', 'Showing the answer as text. Turn voice back on to hear it.');
        return;
      }

      // ── Native device TTS (free Indian accent voices) ────────────────────
      if (ttsVoiceMode === 'device-female' || ttsVoiceMode === 'device-male') {
        setSpeakingId(msgId);
        speakingIdRef.current = msgId;
        const gender = ttsVoiceMode === 'device-female' ? 'female' : 'male';
        const usedNative = await speakNative(text, language?.code ?? 'en', gender, () => {
          if (speakingIdRef.current === msgId) {
            setSpeakingId(null);
            speakingIdRef.current = null;
          }
        });
        if (usedNative) return;
        // Voice not available on device (e.g. mr-IN missing) — clear the
        // speaking indicator and fall through to cloud TTS below.
        setSpeakingId(null);
        speakingIdRef.current = null;
      }

      // ── Cloud TTS (streamed, highest quality) ────────────────────────────

      // P0-A: fail closed — never touch the shared audio session while the
      // Evidence Locker is recording; skip speaking instead of risking its clip.
      if (Platform.OS !== 'web' && isMicHeldByEvidenceLocker()) {
        notify('Voice paused', TTS_BLOCKED_BY_LOCKER_MESSAGE);
        return;
      }

      // Force iOS silent-switch playback and disable recording-mode conflicts
      try {
        if (Platform.OS !== 'web') {
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: false,
            shouldPlayInBackground: false,
          });
        }
      } catch {}

      // Show loading indicator BEFORE the first request so the tap feels registered.
      setTtsLoadingId(msgId);

      // The answer is split into sentences and requested piece by piece: the first
      // piece is short so speech starts in ~2s instead of after the whole answer has
      // been synthesised (measured 7.3s for a 494-char reply, 13.1s for 990 chars).
      // Every request carries group=msgId so the backend still charges the answer as
      // ONE question rather than one per piece.
      const speaker = new ChunkedSpeaker({
        apiBase: API_BASE,
        token,
        language: language?.code || 'en',
        group: msgId,
        rate: speechRate,

        // Persist one clip. Same base64 route as before: avoids pulling in a Blob
        // polyfill, and RN's global.btoa is inconsistent across versions.
        writeAudio: async (buf, index) => {
          // Web: expo-file-system's File/Paths API is native-only and throws in
          // a browser (file.create/file.write), which silently killed TTS on the
          // web build. Persist the clip as an in-memory Blob URL instead — the
          // web player (expo-audio → HTMLAudioElement) plays blob: URLs directly.
          // Native path below is deliberately left exactly as-is.
          if (Platform.OS === 'web') {
            const blob = new Blob([buf], { type: 'audio/mpeg' });
            const url = (globalThis as any).URL.createObjectURL(blob);
            return {
              uri: url,
              cleanup: () => { try { (globalThis as any).URL.revokeObjectURL(url); } catch {} },
            };
          }
          const arr = new Uint8Array(buf);
          let bin = '';
          const CHUNK = 0x8000;
          for (let i = 0; i < arr.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + CHUNK)) as any);
          }
          const g: any = globalThis;
          const b64 = g.btoa ? g.btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
          const file = new File(Paths.cache, `dhara-tts-${msgId}-${index}.mp3`);
          try { file.delete(); } catch {}
          file.create();
          file.write(b64, { encoding: 'base64' });
          return {
            uri: file.uri,
            cleanup: () => { try { file.delete(); } catch {} },
          };
        },

        // One clip -> one player, preserving the decode-race handling that was here
        // before: play() straight after createAudioPlayer() silently no-ops on some
        // Android OEMs because the native player has not finished decoding
        // (github.com/expo/expo/discussions/18869), so wait for isLoaded with a hard
        // fallback timer, and never let a missing finish event stall the queue.
        createPlayer: (uri) => {
          if (Platform.OS === 'web') {
            if (!browserAudioRef.current) browserAudioRef.current = new Audio();
            browserAudioRef.current.volume = ttsVolume;
            return createBrowserTtsPlayer(browserAudioRef.current, uri);
          }
          const player = createAudioPlayer({ uri });
          try { player.setPlaybackRate(speechRate, 'high'); } catch {}
          try { player.volume = ttsVolume; } catch {}

          let started = false;
          let finished = false;
          let onDone: (() => void) | null = null;
          let finishedBeforeSubscribe = false;

          const fireFinish = () => {
            if (finished) return;
            finished = true;
            if (onDone) onDone();
            else finishedBeforeSubscribe = true; // resolved as soon as onFinish lands
          };
          const tryStart = () => {
            if (started) return;
            started = true;
            try {
              player.play();
            } catch {
              // Some Android OEMs throw on the very first play() after decode.
              setTimeout(() => { try { player.play(); } catch {} }, 150);
            }
          };

          try {
            (player as any).addListener?.('playbackStatusUpdate', (st: any) => {
              if (!started && st?.isLoaded) tryStart();
              if (st?.didJustFinish || (st?.duration > 0 && st?.currentTime >= st?.duration - 0.05)) {
                fireFinish();
              }
            });
          } catch {}

          // Some platforms flip isLoaded synchronously for small local files,
          // before the first status event ever fires.
          if ((player as any).isLoaded) tryStart();
          setTimeout(() => { if (!started) tryStart(); }, 2500);

          // Backstop: a clip that never reports completion must not wedge the queue.
          const guard = setTimeout(fireFinish, 90_000);

          return {
            play: () => tryStart(),
            remove: () => {
              clearTimeout(guard);
              // Flag the brief window described above `suppressAudioAbortUntilRef`:
              // if `player.play()` above hasn't actually started playback yet on
              // web, the pause() call two lines down aborts that pending
              // HTMLMediaElement.play() promise and the browser throws an
              // unhandled AbortError. That is expected here (we ARE the
              // intentional interruption), so silence only that specific,
              // scoped case — this branch never touches native.
              if (Platform.OS === 'web') suppressAudioAbortUntilRef.current = Date.now() + 1000;
              try { player.pause(); } catch {}
              try { player.remove(); } catch {}
            },
            onFinish: (cb) => {
              onDone = () => { clearTimeout(guard); cb(); };
              if (finishedBeforeSubscribe) onDone();
            },
          };
        },

        onSpeakingChange: (isSpeaking) => {
          if (isSpeaking) {
            setBlockedVoiceId(null);
            setTtsLoadingId(null);
            setSpeakingId(msgId);
            return;
          }
          // Only clear if we are still the active speaker; a newer speak() may own the UI.
          if (speakerRef.current === speaker) {
            setSpeakingId(null);
            setTtsLoadingId(null);
            speakerRef.current = null;
          }
        },

        onPlaybackBlocked: () => {
          if (speakerRef.current !== speaker) return;
          setTtsLoadingId(null);
          setSpeakingId(null);
          setBlockedVoiceId(msgId);
        },
        onError: (message) => {
          if (speakerRef.current && speakerRef.current !== speaker) return;
          setTtsLoadingId(null);
          setSpeakingId(null);
          speakerRef.current = null;
          if (message.includes('429')) {
            crossAlert(
              'Daily limit reached',
              "You have used all your free questions for today. Free help: NALSA 15100 (legal aid) - Consumer Helpline 1800-11-4000.",
            );
            return;
          }
          crossAlert(
            'Speaker unavailable',
            message.includes('Network')
              ? 'Could not reach the speech server. Please check your internet connection.'
              : 'Could not play audio right now. Please try again in a moment.',
          );
        },
      });

      speakerRef.current = speaker;
      // The whole answer is already on screen, so hand it over in one go: takeChunks
      // still keeps the FIRST request short, which is where the latency win comes from.
      speaker.end(text.slice(0, 3800));
    },
    [speakingId, ttsLoadingId, blockedVoiceId, language, speechRate, ttsVolume, ttsVoiceMode, token, stopCloudTTS],
  );
  speakRef.current = speak;

  /** Start listening — records audio and uploads to Whisper cloud STT.
   *  On native: uses expo-audio recorder.
   *  On web: uses browser MediaRecorder API (getUserMedia).
   *  Both paths produce audio that gets sent to the Whisper transcription endpoint. */
  const startRecording = useCallback(async () => {
    if (!token || micStartingRef.current) return;
    micStartingRef.current = true;
    let started = false;
    voiceSMRef.current?.tryTo('LISTENING');
    // Defensive: recording needs exclusive audio-session access. If TTS is
    // still speaking a previous answer, stop it first.
    stopCloudTTS();
    stopNativeTTS();
    // Talk to DHARA — if the Evidence Locker later claims the mic, stop here.
    const onPreempt = () => {
      try {
        if (Platform.OS === 'web') {
          webRecorderRef.current?.stop();
          webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop());
          webRecorderRef.current = null; webStreamRef.current = null; webChunksRef.current = [];
        } else { recorder.stop(); }
      } catch {}
      isMicHeldRef.current = false; lockedRef.current = false;
      setLocked(false); setRecording(false);
      micLeaseRef.current = null;
    };
    try {
      if (Platform.OS === 'web') {
        // --- Web: use browser MediaRecorder ---
        const nav = globalThis.navigator as any;
        if (!nav?.mediaDevices?.getUserMedia) {
          notify('Mic not available', 'Your browser does not support audio recording.');
          return;
        }
        // Check the current permission state where the browser supports it
        // (Chrome/Edge/Firefox; Safari does not expose 'microphone' via the
        // Permissions API and returns undefined here, which we treat as
        // "unknown" and just try getUserMedia directly below). A 'denied'
        // state means the browser will reject immediately without ever
        // showing its own prompt again — surfacing that clearly here, once,
        // is the contextual "ask again" the permission contract calls for;
        // repeating the same failed attempt after that would just repeat
        // the same silent failure.
        try {
          const status = await nav.permissions?.query?.({ name: 'microphone' as any });
          if (status?.state === 'denied') {
            notify(
              'Microphone blocked',
              'Your browser is blocking microphone access for this site. Click the lock/site-info icon next to the address bar, allow Microphone, then tap the mic again.',
            );
            return;
          }
        } catch {}
        let stream: MediaStream;
        try {
          stream = await nav.mediaDevices.getUserMedia({ audio: true });
        } catch (permErr: any) {
          if (permErr?.name === 'NotAllowedError' || permErr?.name === 'PermissionDeniedError') {
            notify(
              'Microphone blocked',
              'Microphone access was denied. Click the lock/site-info icon next to the address bar, allow Microphone, then tap the mic again.',
            );
          } else {
            notify('Mic unavailable', permErr?.message || 'Could not access the microphone.');
          }
          return;
        }
        if (!isMicHeldRef.current && !lockedRef.current) {
          stream.getTracks().forEach((t: any) => t.stop());
          return;
        }
        webStreamRef.current = stream;
        webChunksRef.current = [];
        const mimeType = ['audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mr.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) webChunksRef.current.push(e.data);
        };
        const lease = claimMic('chat_mic', onPreempt);
        if (!lease.ok) { try { stream.getTracks().forEach((t: any) => t.stop()); } catch {} webStreamRef.current = null; notify('Microphone busy', MIC_BUSY_MESSAGE); return; }
        micLeaseRef.current = lease;
        mr.start();
        webRecorderRef.current = mr;
        started = true;
        setRecording(true);
      } else {
        // --- Native: expo-audio recorder ---
        // P0 fix: permissionPhaseRef now stays true for the ENTIRE critical
        // section (getConfiguredSTT -> permission check -> prepareToRecordAsync
        // -> recorder.record()), not just around requestRecordingPermissionsAsync().
        // A background/AppState event anywhere in this window (not only during
        // the OS permission dialog) could previously slip through and cancel
        // the capture mid-start. Reset in `finally` so it is always cleared
        // regardless of which path below returns or throws.
        permissionPhaseRef.current = true;
        try {
          const { provider, fellBack } = await getConfiguredSTT(API_BASE, token);
          setSttProviderLabel(fellBack ? `${provider.displayName} (fallback)` : provider.displayName);
          // P0-A: Check current status first — if already granted, skip the
          // request dialog entirely.  This prevents the Android permission
          // dialog from briefly backgrounding the app, which triggers the
          // AppState listener and kills the mic flow on first use.
          let perm = await AudioModule.getRecordingPermissionsAsync();
          if (!perm.granted) {
            perm = await AudioModule.requestRecordingPermissionsAsync();
          }
          if (!perm.granted) {
            notify('Microphone permission', 'Please enable microphone to speak your question.');
            return;
          }
          if (!isMicHeldRef.current && !lockedRef.current) return;
          // BATCH A1: claim the mic lease BEFORE touching the shared audio
          // session — setAudioModeAsync is global and must never run ahead
          // of a lease check, or it can disrupt an active Evidence Locker
          // recording.
          const claimResult = await withMicLease('chat_mic', onPreempt, async () => {
            await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
            try { await recorder.stop(); } catch {}
            await recorder.prepareToRecordAsync();
          });
          if (!claimResult.ok) { notify('Microphone busy', MIC_BUSY_MESSAGE); return; }
          if (!isMicHeldRef.current && !lockedRef.current) {
            try { await recorder.stop(); } catch {}
            claimResult.lease.release();
            return;
          }
          micLeaseRef.current = claimResult.lease;
          recorder.record();
          started = true;
          setRecording(true);
        } finally {
          permissionPhaseRef.current = false;
        }
      }
    } catch (e: any) {
      // V1-C: never log arbitrary exception text (W-12 defect — FIXED).
      // Device-specific strings (e.g. "AVAudioSession error -50") may carry
      // implementation detail and must not appear in device logs.
      // Log only the exception CLASS name as a fixed diagnostic code;
      // no message text, no audio content, no transcripts, no phrases.
      // Diagnostic code: DHARA/W12 — mic setup failure.
      console.warn('DHARA/W12 MIC_SETUP_FAILED', e?.constructor?.name ?? 'UnknownError');
      notify('Recording failed', 'Microphone unavailable. Please check permissions and try again.');
    } finally {
      micStartingRef.current = false;
      if (!started) {
        isMicHeldRef.current = false; lockedRef.current = false;
        setLocked(false); setRecording(false);
        releaseMicLease();
        if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
        micPulse.stopAnimation(); micPulse.setValue(1); setHoldElapsed(0);
        try { webStreamRef.current?.getTracks()?.forEach((track: MediaStreamTrack) => track.stop()); } catch {}
        webStreamRef.current = null;
      }
    }
  }, [recorder, token, stopCloudTTS, notify, micPulse]);

  // Talk to DHARA — Step 5: CONFIRMING + needsConfirmation(). Inert (no-op
  // beyond the existing modal) when VOICE_COMPANION_ENABLED is OFF.
  const enterConfirming = useCallback((heardText: string) => {
    voiceSMRef.current?.tryTo('CONFIRMING');
    if (VOICE_COMPANION_ENABLED) {
      setTranscriptNeedsExtraCare(needsConfirmation(classifyFact(heardText)));
    }
  }, []);

  // Fix A: remembers the last recording that failed to transcribe so Retry
  // can resend it without asking the user to speak again.
  const lastAudioForRetryRef = useRef<{ platform: 'web'; blob: Blob } | { platform: 'native'; uri: string } | null>(null);
  // A2: deletes the cached retry audio (native file + ref) on success,
  // cancel, or unmount. Evidence Locker files are never touched here.
  const deleteRetryAudio = useCallback(() => {
    const source = lastAudioForRetryRef.current;
    lastAudioForRetryRef.current = null;
    if (source?.platform === 'native') {
      try { new File(source.uri).delete(); } catch {}
    }
  }, []);
  // A2: on unmount, clean up any still-cached retry audio.
  useEffect(() => () => { deleteRetryAudio(); }, [deleteRetryAudio]);
  // Fix A: one short, fixed message per status — never the raw response body
  // (a 429 from the upstream Whisper rate limiter can come back as plain HTML).
  // Mic diagnosis fix: this is the function the chat-mic user actually sees
  // on a real transcription failure — it now routes through the same
  // sttErrorToMessage() used everywhere else, so the distinct no-recording /
  // no-connection / safe-server-detail messages reach the user here too,
  // instead of the one hardcoded generic string.
  const showTranscriptionError = useCallback((err: unknown, retry: () => void) => {
    const message = sttErrorToMessage(err);
    crossAlert('Transcription failed', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => deleteRetryAudio() }, // A2: cancelling the retry alert deletes the cached audio
      { text: 'Retry', onPress: retry },
    ]);
  }, [deleteRetryAudio]);
  const retryTranscription = useCallback(async () => {
    const source = lastAudioForRetryRef.current;
    if (!source || !token) return;
    setTranscribing(true);
    try {
      if (source.platform === 'web') {
        const form = new FormData();
        form.append('audio', source.blob, source.blob.type.includes('mp4') ? 'audio.m4a' : 'audio.webm');
        if (language?.code) form.append('language', language.code);
        const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (res.status === 401) { setTranscribing(false); await forceLogout(); return; }
        if (!res.ok) { setTranscribing(false); showTranscriptionError({ message: '__transcribe_failed__', status: res.status }, retryTranscription); return; }
        let data: any = {};
        try { data = await res.json(); } catch { data = {}; }
        const heardText = (data.text || '').trim();
        setTranscribing(false);
        if (heardText) {
          deleteRetryAudio(); // A2: transcription succeeded — the audio is no longer needed
          setTranscriptMismatch(data.script_mismatch ? { detected: data.detected_script ?? null } : null);
          setTranscriptPreview(heardText);
          enterConfirming(heardText);
          setShowTranscriptModal(true);
        } else {
          notify('Could not transcribe', 'Please try again.');
        }
      } else {
        const result = await whisperTranscribeFile(API_BASE, token, source.uri, language?.code);
        setTranscribing(false);
        const heardText = (result.text || '').trim();
        if (heardText) {
          deleteRetryAudio(); // A2: transcription succeeded — the audio is no longer needed
          setTranscriptMismatch(result.scriptMismatch ? { detected: result.detectedScript } : null);
          setTranscriptPreview(heardText);
          enterConfirming(heardText);
          setShowTranscriptModal(true);
        } else {
          notify('Could not transcribe', 'Please try again.');
        }
      }
    } catch (e: any) {
      setTranscribing(false);
      if (e?.message === '__session_expired__') { forceLogout(); return; }
      showTranscriptionError(e, retryTranscription);
    }
  }, [token, language, forceLogout, notify, enterConfirming, showTranscriptionError, deleteRetryAudio]);

  const stopRecording = useCallback(async () => {
    voiceSMRef.current?.tryTo('TRANSCRIBING');
    // Stop the elapsed-time ticker
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldElapsed(0);

    // If native STT was running, finish it safely
    if (nativeSTTHandleRef.current) {
      try {
        setTranscribing(true);
        setRecording(false);
        await nativeSTTHandleRef.current.stop();
      } catch {}
      nativeSTTHandleRef.current = null;
      setTranscribing(false);
      return;
    }

    try {
      setRecording(false);
      setTranscribing(true);

      if (Platform.OS === 'web') {
        // --- Web: stop MediaRecorder, collect blob, upload ---
        const mr = webRecorderRef.current;
        if (!mr) { setTranscribing(false); return; }
        const audioBlob = await new Promise<Blob>((resolve) => {
          mr.onstop = () => {
            const blob = new Blob(webChunksRef.current, { type: mr.mimeType || 'audio/webm' });
            resolve(blob);
          };
          mr.stop();
        });
        // Stop the stream tracks
        try {
          webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop());
        } catch {}
        webRecorderRef.current = null;
        webStreamRef.current = null;
        webChunksRef.current = [];
        releaseMicLease();
        if (!audioBlob || audioBlob.size === 0) {
          setTranscribing(false);
          return;
        }
        if (!token) { setTranscribing(false); return; }
        if (audioBlob.size > MAX_AUDIO_BYTES) {
          setTranscribing(false);
          notify('Recording too long', AUDIO_TOO_LARGE_MESSAGE);
          return;
        }
        lastAudioForRetryRef.current = { platform: 'web', blob: audioBlob }; // Fix A: enable Retry with the same recording
        // Upload blob to Whisper endpoint
        const form = new FormData();
        form.append('audio', audioBlob, audioBlob.type.includes('mp4') ? 'audio.m4a' : 'audio.webm');
        if (language?.code) form.append('language', language.code);
        const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (res.status === 401) {
          setTranscribing(false);
          await forceLogout();
          return;
        }
        if (!res.ok) {
          // Fix A: never show the raw response body (e.g. a non-JSON 429 page)
          // — one short message per status, with a Retry that resends this blob.
          setTranscribing(false);
          showTranscriptionError({ message: '__transcribe_failed__', status: res.status }, retryTranscription);
          return;
        }
        let data: any = {};
        try { data = await res.json(); } catch { data = {}; }
        const heardText = (data.text || '').trim();
        setTranscribing(false);
        if (heardText) {
          deleteRetryAudio(); // A2: transcription succeeded — the audio is no longer needed
          setTranscriptMismatch(data.script_mismatch ? { detected: data.detected_script ?? null } : null);
          setTranscriptPreview(heardText);
          enterConfirming(heardText);
          setShowTranscriptModal(true);
        } else {
          notify('Could not transcribe', 'Please try again.');
        }
      } else {
        // --- Native: stop expo-audio recorder, upload file ---
        // recorder.stop() throws (double-stop / recorder never actually
        // started / native session already torn down) on some Android
        // builds — every other recorder.stop() call in this file is
        // guarded the same way; this one was the odd one out and could
        // leave the mic UI stuck or surface as an unhandled rejection.
        try { await recorder.stop(); } catch {}
        const uri = recorder.uri;
        // P0-C: never flip allowsRecording:false while the Evidence Locker
        // holds the shared session.
        if (!isMicHeldByEvidenceLocker()) {
          try {
            await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
          } catch {}
        }
        releaseMicLease();
        // Mic diagnosis fix: this used to return silently — no message at
        // all — leaving the user staring at a mic button that just reset
        // with zero feedback. Empty uri means nothing was ever captured
        // (e.g. permission denied mid-flow, or an instant tap/release).
        if (!uri) {
          setTranscribing(false);
          notify('Microphone', sttErrorToMessage(new Error('__no_recording__')));
          return;
        }
        if (!token) { setTranscribing(false); return; }
        lastAudioForRetryRef.current = { platform: 'native', uri }; // Fix A: enable Retry with the same recording
        const result = await whisperTranscribeFile(API_BASE, token, uri, language?.code);
        setTranscribing(false);
        const heardText = (result.text || '').trim();
        if (heardText) {
          deleteRetryAudio(); // A2: transcription succeeded — the audio is no longer needed
          setTranscriptMismatch(result.scriptMismatch ? { detected: result.detectedScript } : null);
          setTranscriptPreview(heardText);
          enterConfirming(heardText);
          setShowTranscriptModal(true);
        } else {
          notify('Could not transcribe', 'Please try again.');
        }
      }
    } catch (e: any) {
      setTranscribing(false);
      if (e?.message === '__session_expired__') {
        forceLogout();
        return;
      }
      // Fix A: never show the raw error/response text — one short message
      // per status, with a Retry that resends the same recording.
      showTranscriptionError(e, retryTranscription);
    }
  }, [recorder, token, language, notify, forceLogout, showTranscriptionError, retryTranscription, deleteRetryAudio]);

  // WhatsApp-style hold-to-talk handlers
  const onMicPressIn = useCallback(() => {
    if (micStartingRef.current || isMicHeldRef.current) return;
    // Synchronously mark the mic as held BEFORE any async work — this is the
    // signal that startRecording checks after each await to know whether the
    // user is still holding the button.
    isMicHeldRef.current = true;
    slideCancelledRef.current = false;
    setSlideCancelled(false);
    lockedRef.current = false;
    setLocked(false);
    slideX.setValue(0);
    slideY.setValue(0);
    // Start pulsing animation (the elapsed timer itself is now driven by the
    // `recording`-keyed useEffect above, not started here — see that effect
    // for why).
    Animated.loop(
      Animated.sequence([
        Animated.timing(micPulse, { toValue: 1.25, duration: 600, useNativeDriver: true }),
        Animated.timing(micPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
    // Guard: startRecording is async and touches native audio / speech modules.
    // On some Android ROMs a missing native module rejects here — an unhandled
    // rejection would crash the app, so swallow it and surface a message.
    try {
      startRecording()?.catch((err: any) => {
        setRecording(false);
        notify('Mic unavailable', err?.message || 'Could not start recording.');
      });
    } catch (err: any) {
      setRecording(false);
      notify('Mic unavailable', err?.message || 'Could not start recording.');
    }
  }, [startRecording, slideX, slideY, micPulse, notify]);

  const onMicPressOut = useCallback(() => {
    // Synchronously drop the held flag so any in-flight startRecording aborts.
    isMicHeldRef.current = false;

    // Locked (hands-free) recording — lifting the finger must NOT stop it.
    // The user now controls the recording only via the locked bar's explicit
    // trash / checkmark buttons (onLockedCancel / onLockedFinish below).
    if (lockedRef.current) {
      slideX.setValue(0);
      slideY.setValue(0);
      return;
    }

    // Stop pulsing
    micPulse.stopAnimation();
    micPulse.setValue(1);
    // Always clear the timer
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldElapsed(0);
    // Reset slide position
    slideX.setValue(0);
    slideY.setValue(0);

    // Check if the recording was cancelled by sliding
    if (slideCancelledRef.current) {
      setSlideCancelled(false);
      slideCancelledRef.current = false;
      // Cancel: stop recording without sending
      setRecording(false);
      if (Platform.OS === 'web') {
        // Web: stop MediaRecorder and discard
        try { webRecorderRef.current?.stop(); } catch {}
        try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
        webRecorderRef.current = null;
        webStreamRef.current = null;
        webChunksRef.current = [];
      } else {
        try { recorder.stop(); } catch {}
        if (!isMicHeldByEvidenceLocker()) {
          try { setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); } catch {}
        }
      }
      releaseMicLease();
      return;
    }

    // If any recording actually started, stop it. We check BOTH `recording`
    // state AND the STT handle/web recorder refs so we don't miss a recording
    // that just started but whose state flush hasn't landed yet.
    if (recording || nativeSTTHandleRef.current || webRecorderRef.current) {
      stopRecording();
    }
  }, [recording, stopRecording, recorder, slideX, slideY, micPulse, releaseMicLease]);

  /**
   * Web only. The mic button uses press-and-hold (PanResponder) on native,
   * mirroring WhatsApp — but on desktop/mobile web that gesture is awkward:
   * there is no reliable "hold" affordance with a mouse, and touch-and-hold
   * on mobile browsers can trigger the OS text-selection/context menu
   * instead of starting the recording. Web gets a simpler, standard
   * click-to-start / click-to-stop-and-send toggle instead. Reuses
   * onMicPressIn/onMicPressOut as-is (timer, pulse animation, and the
   * getUserMedia + permission handling above) — only the gesture that
   * triggers them changes.
   */
  const onWebMicPress = useCallback(() => {
    if (transcribing) return; // previous clip still uploading — ignore taps
    if (recording) {
      onMicPressOut();
    } else {
      onMicPressIn();
    }
  }, [recording, transcribing, onMicPressIn, onMicPressOut]);

  /** Trash button on the locked hands-free bar — discards the recording
   * without transcribing or sending anything. */
  const onLockedCancel = useCallback(() => {
    isMicHeldRef.current = false;
    lockedRef.current = false;
    setLocked(false);
    micPulse.stopAnimation();
    micPulse.setValue(1);
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldElapsed(0);
    setRecording(false);
    if (Platform.OS === 'web') {
      try { webRecorderRef.current?.stop(); } catch {}
      try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
      webRecorderRef.current = null;
      webStreamRef.current = null;
      webChunksRef.current = [];
    } else {
      void recorder.stop().catch(() => {});
      if (!isMicHeldByEvidenceLocker()) {
        void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
      }
    }
    releaseMicLease();
  }, [recorder, micPulse, releaseMicLease]);

  /** Checkmark button on the locked hands-free bar — finishes the recording
   * and goes to the normal transcribe → confirm flow, same as a slide-free
   * hold-and-release would. */
  const onLockedFinish = useCallback(() => {
    isMicHeldRef.current = false;
    lockedRef.current = false;
    setLocked(false);
    micPulse.stopAnimation();
    micPulse.setValue(1);
    stopRecording();
  }, [stopRecording, micPulse]);

  // Consume each explicit voice-entry request once. A navigation tap starts
  // hands-free mode; it must not pretend a finger is still holding the old UI.
  useEffect(() => {
    const request = entryParams.autostartMic;
    if (!focused || !request || lastMicEntry.current === request) return;
    lastMicEntry.current = request;
    router.setParams({ autostartMic: '' });
    if (!token) { notify('Sign in to speak', 'Please sign in before using voice questions.'); return; }
    if (recording || micStartingRef.current || transcribing || streaming || showTranscriptModal) {
      notify('Finish the current question', 'Stop or review the current recording before starting another.'); return;
    }
    onMicPressIn();
    lockedRef.current = true; setLocked(true);
  }, [focused, entryParams.autostartMic, token, recording, transcribing, streaming, showTranscriptModal, onMicPressIn, router, notify]);

  // Tabs stay mounted: unmount-only cleanup does not stop the microphone.
  useEffect(() => {
    if (!focused) { onLockedCancel(); stopCloudTTS(); stopNativeTTS(); }
  }, [focused, onLockedCancel, stopCloudTTS]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      // P0-A: Do NOT cancel during the native permission dialog window.
      // Android briefly backgrounds the app while the dialog is showing;
      // cancelling here would kill the mic flow before it starts.
      if (permissionPhaseRef.current) return;
      if (state !== 'active') {
        onLockedCancel();
        stopCloudTTS();
        stopNativeTTS();
        // V1-B: mark the speech gate as interrupted so TTS does not
        // auto-resume after the app returns to the foreground.  Covers
        // incoming phone calls (AppState → inactive/background on both
        // platforms) and Android picture-in-picture backgrounds.
        // Headphone-unplug (ACTION_AUDIO_BECOMING_NOISY) is a separate
        // native event not surfaced by the current Expo audio layer;
        // AT40 remains open pending a device build test.
        noteAudioInterruption();
      }
    });
    return () => sub.remove();
  }, [onLockedCancel, stopCloudTTS]);

  // PanResponder for the WhatsApp slide-to-cancel / slide-up-to-lock gestures
  // on the mic button.
  const micPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_: GestureResponderEvent, gs: PanResponderGestureState) =>
      Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
    onPanResponderGrant: () => {
      try { onMicPressIn(); } catch (err) { console.warn('mic press-in failed:', err); }
    },
    onPanResponderMove: (_: GestureResponderEvent, gs: PanResponderGestureState) => {
      // Once locked, the gesture is done — ignore any further finger movement.
      if (lockedRef.current) return;

      const { dx, dy } = gs;
      // A predominantly-upward drag locks the recording hands-free; a
      // predominantly-leftward drag cancels it. Whichever axis the user is
      // actually moving on wins, exactly like WhatsApp's own mic gesture.
      if (dy < -10 && Math.abs(dy) > Math.abs(dx)) {
        const clampedY = Math.max(-70, dy);
        slideY.setValue(clampedY);
        slideX.setValue(0);
        if (slideCancelledRef.current) {
          slideCancelledRef.current = false;
          setSlideCancelled(false);
        }
        if (clampedY <= LOCK_THRESHOLD) {
          lockedRef.current = true;
          setLocked(true);
          slideY.setValue(0);
          slideX.setValue(0);
        }
        return;
      }

      // Only allow sliding left (negative dx)
      const clampedX = Math.min(0, Math.max(-160, dx));
      slideX.setValue(clampedX);
      slideY.setValue(0);
      // Check if past cancel threshold
      if (clampedX <= CANCEL_THRESHOLD && !slideCancelledRef.current) {
        slideCancelledRef.current = true;
        setSlideCancelled(true);
      } else if (clampedX > CANCEL_THRESHOLD && slideCancelledRef.current) {
        slideCancelledRef.current = false;
        setSlideCancelled(false);
      }
    },
    onPanResponderRelease: () => {
      try { onMicPressOut(); } catch (err) { console.warn('mic release failed:', err); }
    },
    onPanResponderTerminate: () => {
      try { onMicPressOut(); } catch (err) { console.warn('mic terminate failed:', err); }
    },
  }), [onMicPressIn, onMicPressOut, slideX, slideY]);

  const cancelTranscript = useCallback(() => {
    setShowTranscriptModal(false);
    setTranscriptPreview('');
    setTranscriptMismatch(null);
    setTranscriptNeedsExtraCare(false);
    voiceSMRef.current?.tryTo('IDLE');
  }, []);

  const sendTranscript = useCallback(() => {
    const t = transcriptPreview.trim();
    setShowTranscriptModal(false);
    setTranscriptPreview('');
    setTranscriptMismatch(null);
    setTranscriptNeedsExtraCare(false);
    voiceSMRef.current?.tryTo('CHECKING');
    voiceSMRef.current?.tryTo('IDLE');
    if (t) send(t);
  }, [transcriptPreview, send]);

  const editTranscriptInComposer = useCallback(() => {
    // Push transcript into the text input so the user can edit before sending
    setInput(transcriptPreview);
    setShowTranscriptModal(false);
    setTranscriptPreview('');
    setTranscriptMismatch(null);
    setTranscriptNeedsExtraCare(false);
    voiceSMRef.current?.tryTo('IDLE');
  }, [transcriptPreview]);

  const cycleSpeechRate = useCallback(() => {
    // 1.0 → 1.5 → 2.0 → 1.0
    setSpeechRate((prev) => {
      if (prev < 1.25) return 1.5;
      if (prev < 1.75) return 2.0;
      return 1.0;
    });
  }, []);

  const startNewChat = useCallback(() => {
    // Increment conversation key FIRST so any in-flight SSE session-frame
    // from the old stream cannot overwrite the new session ID.
    convKeyRef.current += 1;
    setMessages([]);
    // Pre-generate a UUID so this conversation owns its ID from the moment
    // "New Conversation" is pressed — no races with backend session frames.
    setSessionId(generateId());
    setInput('');
    setExpandedDetails({});
    setSamplesRemaining(null);
    // Clear the SOS emergency banner when starting a fresh conversation.
    setHasSosBanner(false);
  }, []);

  const activeSuggestions = (() => {
    if (entryParams.topicId && TOPIC_SUGGESTIONS[entryParams.topicId]) {
      return TOPIC_SUGGESTIONS[entryParams.topicId];
    }
    if (primaryInterest) {
      // Map profile suggestions to the same shape the chips expect.
      return primaryInterest.chatSuggestions.map(s => ({
        text: s.text,
        icon: s.icon as React.ComponentProps<typeof Ionicons>['name'],
      }));
    }
    return proMode ? getProSuggestions(language.code) : getBasicSuggestions(language.code);
  })();

  /** True whenever the user has sent at least one message — collapses the reports strip */
  const chatIsActive = messages.length > 0;

  /** Minimum pixel height the chat zone must occupy (40% of screen) */

  /** Keep an answer on this phone so it opens with no network at all. */
  const saveAnswer = useCallback(
    async (m: Msg) => {
      if (!m.content.trim()) return;
      const idx = messages.findIndex((x) => x.id === m.id);
      const question =
        idx > 0
          ? [...messages.slice(0, idx)].reverse().find((x) => x.role === 'user')?.content || ''
          : '';
      try {
        await addBookmark(API_BASE as string, token, {
          question,
          answer: m.content,
          language: language.code,
          citations: (m.citations || []) as any,
        });
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, saved: true } : x)));
      } catch {
        crossAlert('Could not save', 'Please try again.');
      }
    },
    [messages, token, language],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="chat-screen">
      {/* Web-only: centers the chat column on wide desktop viewports instead
          of stretching mobile-width UI across the whole browser window.
          `styles.safe` (the full-viewport backdrop) and this wrapper share
          only their background color on native — Platform.OS gating below
          keeps native layout completely untouched. */}
      <View style={styles.webContentWrap}>

      {/* ═══════════════════════════ TOP ZONE ════════════════════════════
          Fixed area — header, ticker, FIR action card, reports strip.
          Does NOT scroll with the chat conversation. */}
      <View style={styles.topZone}>

      {/* ── HEADER — title · lang chip · usage pill · New Chat ─────────────── */}
      <View style={styles.header}>
        {/* Left: branding + language chip */}
        <View style={styles.headerBrand}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.title}>Dhara</Text>
            {isPro && (
              <View testID="pro-badge" style={styles.proBadge}>
                <Ionicons name="star" size={11} color={theme.colors.onBrandSecondary} />
                <Text style={styles.proBadgeText}>PRO</Text>
              </View>
            )}
          </View>
          <Pressable
            testID="header-lang-chip"
            style={styles.langChip}
            onPress={() => router.push('/(tabs)/settings')}
            hitSlop={6}
          >
            <Ionicons name="language-outline" size={12} color={theme.colors.brand} />
            <Text style={styles.langChipText}>{language.native}</Text>
          </Pressable>
        </View>

        {/* Right: New Chat + History — clean header, no usage clutter */}
        <View style={styles.headerButtons}>
          <Pressable testID="new-chat-button" style={styles.newChatBtn} onPress={startNewChat}>
            <Ionicons name="add" size={16} color={theme.colors.brand} />
            <Text style={styles.newChatText}>{t('home.newChat', language.code)}</Text>
          </Pressable>
          <Pressable
            testID="history-header-btn"
            style={styles.historyHeaderBtn}
            onPress={() => router.push('/(tabs)/history')}
            hitSlop={6}
          >
            <Ionicons name="time-outline" size={22} color={theme.colors.brand} />
          </Pressable>
        </View>
      </View>

      {/* ── Verified-sources scrolling ticker ────────────────────────────── */}
      <MarqueeBanner variant="light" />

      {/* Web-only fallback for Alert.alert (a no-op on react-native-web) —
          surfaces mic/permission errors that would otherwise vanish silently. */}
      {voiceBanner && (
        <View style={styles.voiceBanner} testID="voice-banner">
          <Ionicons name="mic-off-outline" size={18} color={theme.colors.brand} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.voiceBannerTitle}>{voiceBanner.title}</Text>
            <Text style={styles.voiceBannerMessage}>{voiceBanner.message}</Text>
          </View>
          <Pressable
            testID="voice-banner-dismiss"
            onPress={() => setVoiceBanner(null)}
            hitSlop={10}
            style={{ padding: 4 }}
          >
            <Ionicons name="close" size={18} color={theme.colors.onSurfaceTertiary} />
          </Pressable>
        </View>
      )}
      {blockedVoiceId && (
        <VoiceNotice testID="chat-playback-notice"
          message="Your browser paused audio. Tap Play voice to listen, or continue with text."
          onPlay={() => speakerRef.current?.retryPlayback()}
          onDismiss={stopCloudTTS} />
      )}

      </View>{/* ── end topZone ── */}

      {/* ─── Chat zone divider ──────────────────────────────────────────────
          Shown whenever a conversation is active. Provides a clear visual
          break between the top controls and the conversation area. */}
      {chatIsActive && (
        <View style={styles.chatDivider}>
          <Text style={styles.chatDividerLabel}>CONVERSATION</Text>
        </View>
      )}

      {/* ═══════════════════════════ BOTTOM ZONE ═════════════════════════
          Fills remaining screen height and scrolls independently. */}
      {/*
        keyboardVerticalOffset MUST be 0 here — it is not "the height of the chrome
        below us". The library computes the lift as
            frame.y + frame.height - (screenHeight - keyboardHeight - offset)
        and `frame` comes from onLayout, i.e. it is already measured relative to
        this screen's SafeAreaView, whose origin sits at window y=0. So
        `frame.y + frame.height` is the composer's real on-screen bottom and the
        tab bar + disclaimer banner below it are ALREADY subtracted automatically.
        Any non-zero offset is added on top and simply floats the composer that
        many pixels above the keyboard — the previous 64/88 left a visible gap.
        Keeping it 0 also means the variable-height disclaimer banner (it wraps to
        3-4 lines on narrow phones) needs no hardcoded constant to track.
      */}
      <KeyboardAvoidingView
        style={styles.chatZone}
        behavior="translate-with-padding"
        keyboardVerticalOffset={0}
      >
        {/* SOS Emergency Banner — shown after a distress reply, dismissible */}
        {hasSosBanner && (
          <SosEmergencyBanner onDismiss={() => setHasSosBanner(false)} language={language.code} />
        )}
        <ScrollView
          testID="chat-reading-area"
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emblem}>
                <Ionicons name="library" size={40} color={theme.colors.brandSecondary} />
              </View>
              <Text style={styles.emptyTitle}>
                {primaryInterest
                  ? `Hi${user?.name ? ` ${user.name.split(' ')[0]}` : ''}, ${primaryInterest.chatHeadline}`
                  : t('home.headline', language.code)}
              </Text>
              <Text style={styles.emptySub}>
                {primaryInterest
                  ? primaryInterest.chatSubline
                  : t('home.sub', language.code)}
              </Text>
              <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm, alignSelf: 'stretch', width: '100%' }}>
                {activeSuggestions.map((s, i) => (
                  <Pressable
                    key={i}
                    testID={`suggestion-${i}`}
                    style={styles.suggestion}
                    onPress={() => send(s.text)}
                  >
                    <Ionicons name={s.icon} size={20} color={theme.colors.brand} />
                    <Text style={styles.suggestionText} numberOfLines={3}>{s.text}</Text>
                  </Pressable>
                ))}
              </View>

              {/* ── Pro upgrade card — bottom of empty state, non-Pro users only ── */}
              {/* Batch FREE-V1-001: gated off for v1 (store IAP policy); flag stays false until a later release. */}
              {PRO_UPGRADE_ENABLED && !isPro && (
                <Pressable
                  testID="pro-upgrade-card"
                  style={styles.proUpgradeCard}
                  onPress={() => router.push('/upgrade')}
                >
                  <View style={styles.proUpgradeIconWrap}>
                    <Ionicons name="star" size={16} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proUpgradeTitle}>Upgrade to Pro</Text>
                    <Text style={styles.proUpgradeSub}>Lawyer-style deep answers, drafts & action plans</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.gold} />
                </Pressable>
              )}
            </View>
          ) : (
            messages.map((m) => (
              <View
                key={m.id}
                style={[styles.msg, m.role === 'user' ? styles.userMsg : styles.aiMsg]}
              >
                <View style={styles.msgHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text
                      style={[
                        styles.msgRole,
                        m.role === 'user' ? styles.userRole : styles.aiRole,
                      ]}
                    >
                      {m.role === 'user' ? 'You' : 'Dhara'}
                    </Text>
                    {m.role === 'assistant' && m.mode === 'pro' && (
                      <View style={styles.proTag}>
                        <Text style={styles.proTagText}>PRO</Text>
                      </View>
                    )}
                  </View>
                  {m.role === 'assistant' && m.content.length > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {/* Save for offline reading */}
                      <Pressable
                        testID={`save-${m.id}`}
                        onPress={() => saveAnswer(m)}
                        hitSlop={10}
                        disabled={!!m.saved}
                      >
                        <Ionicons
                          name={m.saved ? 'bookmark' : 'bookmark-outline'}
                          size={22}
                          color={m.saved ? theme.colors.brandSecondary : theme.colors.brand}
                        />
                      </Pressable>
                      {/* Playback speed toggle — cycles 1x → 1.5x → 2x */}
                      <Pressable
                        testID={`speed-${m.id}`}
                        onPress={cycleSpeechRate}
                        hitSlop={8}
                        style={styles.speedChip}
                      >
                        <Text style={styles.speedChipText}>
                          {speechRate === 1.0 ? '1x' : speechRate === 1.5 ? '1.5x' : '2x'}
                        </Text>
                      </Pressable>
                      <Pressable testID={`speak-${m.id}`} onPress={() => speak(m.id, m.content)} hitSlop={10}>
                        {ttsLoadingId === m.id ? (
                          <ActivityIndicator size="small" color={theme.colors.brand} />
                        ) : (
                          <Ionicons
                            name={speakingId === m.id ? 'stop-circle' : 'volume-high-outline'}
                            size={24}
                            color={theme.colors.brand}
                          />
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.msgText,
                    m.role === 'user' ? styles.userText : styles.aiText,
                  ]}
                >
                  {(m.role === 'assistant' && !streaming && m.citations && m.citations.length > 0
                    ? splitVerdict(m.content).verdict
                    : m.content) ||
                    (streaming && m.role === 'assistant' ? '…' : '')}
                </Text>
                {(() => {
                  // Summary-first disclosure. Only legal answers (assistant reply
                  // with verified citations, once streaming has finished) get the
                  // collapse treatment; everything else renders in full above.
                  const isLegalAnswer =
                    m.role === 'assistant' &&
                    !streaming &&
                    !!m.citations &&
                    m.citations.length > 0;
                  if (!isLegalAnswer) return null;
                  const { rest } = splitVerdict(m.content);
                  const open = !!expandedDetails[m.id];
                  return (
                    <>
                      <Pressable
                        testID={`legal-details-toggle-${m.id}`}
                        style={styles.detailsToggle}
                        onPress={() =>
                          setExpandedDetails((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                        }
                        hitSlop={8}
                      >
                        <Ionicons
                          name={open ? 'chevron-up' : 'document-text-outline'}
                          size={18}
                          color={theme.colors.brand}
                        />
                        <Text style={styles.detailsToggleText}>
                          {open ? 'Hide Legal Details' : 'View Legal Details'}
                        </Text>
                      </Pressable>
                      {open && (
                        <>
                          {!!rest && (
                            <Text style={[styles.msgText, styles.aiText, { marginTop: 6 }]}>
                              {rest}
                            </Text>
                          )}
                          <View style={styles.citationsWrap} testID={`citations-${m.id}`}>
                            <View style={styles.citationsHeaderRow}>
                      <Ionicons name="library-outline" size={11} color={theme.colors.brand} />
                      <Text style={styles.citationsHeader}>Sources</Text>
                    </View>
                            {m.citations!.map((c) => (
                              <View key={c.key} style={styles.citationCard}>
                                <View style={styles.citationHead}>
                                  <View style={styles.citationChip}>
                                    <Text style={styles.citationChipText}>{c.short_label}</Text>
                                  </View>
                                  <Text style={styles.citationVerified}>{verifiedLabel(c.verified_at)}</Text>
                                </View>
                                {isStale(c.verified_at) && (
                                  <View style={styles.staleWarningRow} testID={`stale-${c.key}`}>
                                    <Ionicons name="time-outline" size={12} color={theme.colors.warning} />
                                    <Text style={styles.staleWarningText}>{STALE_WARNING_TEXT}</Text>
                                  </View>
                                )}
                                {isIpcCitation(c) && (
                                  <View style={styles.ipcNoticeRow} testID={`ipc-notice-${c.key}`}>
                                    <Ionicons name="information-circle" size={13} color="#92400E" />
                                    <Text style={styles.ipcNoticeText}>This section has been renumbered or replaced under BNS 2023, effective 1 July 2024.</Text>
                                  </View>
                                )}
                                {!!c.registry_gap_note && (
                                  <View style={styles.gapNoteRow} testID={`gap-note-${c.key}`}>
                                    <Ionicons name="information-circle-outline" size={13} color="#1D4ED8" />
                                    <Text style={styles.gapNoteText}>{c.registry_gap_note}</Text>
                                  </View>
                                )}
                                <Text style={styles.citationTitle}>{c.citation}</Text>
                                {c.official_text ? (
                                  <Text style={styles.citationText} numberOfLines={8}>
                                    {c.official_text}
                                  </Text>
                                ) : (
                                  <Text style={styles.citationText} numberOfLines={8}>
                                    DRAFT — reviewed official text for this section is not yet available.
                                  </Text>
                                )}
                                <Text
                                  style={styles.citationSource}
                                  numberOfLines={1}
                                  onPress={() => {
                                    if (c.source_url) import('expo-linking').then((L) => L.openURL(c.source_url));
                                  }}
                                >
                                  {c.source_url
                                    ? `Source: ${(() => { try { return new URL(c.source_url).hostname.replace(/^www\./, ''); } catch { return 'indiacode.gov.in'; } })()} ↗`
                                    : 'Source: indiacode.gov.in'}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </>
                      )}
                    </>
                  );
                })()}
                {/* While an answer is still streaming, show its live citations in full
                    (the summary-first collapse only kicks in once streaming ends). */}
                {m.role === 'assistant' && streaming && m.citations && m.citations.length > 0 && (
                  <View style={styles.citationsWrap} testID={`citations-${m.id}`}>
                    <View style={styles.citationsHeaderRow}>
                      <Ionicons name="library-outline" size={11} color={theme.colors.brand} />
                      <Text style={styles.citationsHeader}>Sources</Text>
                    </View>
                    {m.citations.map((c) => (
                      <View key={c.key} style={styles.citationCard}>
                        <View style={styles.citationHead}>
                          <View style={styles.citationChip}>
                            <Text style={styles.citationChipText}>{c.short_label}</Text>
                          </View>
                          <Text style={styles.citationVerified}>{verifiedLabel(c.verified_at)}</Text>
                        </View>
                        {isStale(c.verified_at) && (
                          <View style={styles.staleWarningRow} testID={`stale-${c.key}`}>
                            <Ionicons name="time-outline" size={12} color={theme.colors.warning} />
                            <Text style={styles.staleWarningText}>{STALE_WARNING_TEXT}</Text>
                          </View>
                        )}
                        {isIpcCitation(c) && (
                          <View style={styles.ipcNoticeRow} testID={`ipc-notice-${c.key}`}>
                            <Ionicons name="information-circle" size={13} color="#92400E" />
                            <Text style={styles.ipcNoticeText}>This section has been renumbered or replaced under BNS 2023, effective 1 July 2024.</Text>
                          </View>
                        )}
                        {!!c.registry_gap_note && (
                          <View style={styles.gapNoteRow} testID={`gap-note-${c.key}`}>
                            <Ionicons name="information-circle-outline" size={13} color="#1D4ED8" />
                            <Text style={styles.gapNoteText}>{c.registry_gap_note}</Text>
                          </View>
                        )}
                        <Text style={styles.citationTitle}>{c.citation}</Text>
                        {c.official_text ? (
                          <Text style={styles.citationText} numberOfLines={8}>
                            {c.official_text}
                          </Text>
                        ) : (
                          <Text style={styles.citationText} numberOfLines={8}>
                            DRAFT — reviewed official text for this section is not yet available.
                          </Text>
                        )}
                        <Text
                          style={styles.citationSource}
                          numberOfLines={1}
                          onPress={() => {
                            if (c.source_url) import('expo-linking').then((L) => L.openURL(c.source_url));
                          }}
                        >
                          {c.source_url
                            ? `Source: ${(() => { try { return new URL(c.source_url).hostname.replace(/^www\./, ''); } catch { return 'indiacode.gov.in'; } })()} ↗`
                            : 'Source: indiacode.gov.in'}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {(() => {
                  if (m.role !== 'assistant') return null;
                  const step = nextStepFor(m.citations);
                  if (!step) return null;
                  return (
                    <Pressable
                      testID={`next-step-${m.id}`}
                      style={styles.nextStep}
                      onPress={() => router.push(step.route as any)}
                    >
                      <Ionicons name={step.icon} size={18} color={theme.colors.onBrandSecondary} />
                      <Text style={styles.nextStepText}>{step.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.colors.onBrandSecondary} />
                    </Pressable>
                  );
                })()}
                {m.role === 'assistant' && m.firIntent && (
                  <Pressable
                    testID={`fir-intent-cta-${m.id}`}
                    style={styles.firIntentCard}
                    onPress={() => router.push('/fir-draft' as any)}
                  >
                    <Ionicons name="document-text" size={20} color="#fff" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.firIntentTitle}>Start Guided FIR Draft</Text>
                      <Text style={styles.firIntentSub}>Answer 10 quick questions by voice or text — get a ready FIR draft in your language.</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#fff" />
                  </Pressable>
                )}
                {m.role === 'assistant' && !!m.statePrompt && (
                  <Pressable
                    testID={`state-prompt-${m.id}`}
                    style={styles.stateCard}
                    onPress={() => router.push('/state')}
                  >
                    <Ionicons name="location-outline" size={18} color={theme.colors.brand} />
                    <Text style={styles.stateCardText}>{m.statePrompt}</Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.brand} />
                  </Pressable>
                )}
                {m.role === 'assistant' && !!m.stateNote && (
                  <View testID={`state-note-${m.id}`} style={styles.stateNote}>
                    <Ionicons name="information-circle-outline" size={16} color={theme.colors.onSurfaceSecondary} />
                    <Text style={styles.stateNoteText}>{m.stateNote}</Text>
                  </View>
                )}
                {/* Follow-up question chips — appear after the last assistant answer */}
                {m.role === 'assistant' && !streaming && !!m.followUpQuestions && m.followUpQuestions.length > 0 && (
                  <View testID={`followup-chips-${m.id}`} style={styles.followUpChipsWrap}>
                    {m.followUpQuestions.map((q, qi) => (
                      <Pressable
                        key={qi}
                        testID={`followup-chip-${m.id}-${qi}`}
                        style={styles.followUpChip}
                        onPress={() => send(q)}
                        hitSlop={6}
                      >
                        <Ionicons name="arrow-redo-outline" size={13} color={theme.colors.brand} />
                        <Text style={styles.followUpChipText} numberOfLines={2}>{q}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
          {streaming && <ActivityIndicator style={{ marginTop: 12 }} color={theme.colors.brand} />}
        </ScrollView>

        {/* Guest Mode: 1-question-left warning (non-blocking, input stays usable) */}
        {!!user?.is_guest && guestQuota.warning && !guestQuota.limitReached && (
          <View style={styles.guestWarningBanner} testID="guest-warning-banner">
            <Ionicons name="information-circle-outline" size={18} color={theme.dhara.navy} />
            <Text style={styles.guestWarningText}>
              You have 1 free question left. Create a free account to save your legal history and continue using DHARA.
            </Text>
          </View>
        )}

        {/* Guest Mode: limit reached — blocks further questions, offers conversion */}
        {!!user?.is_guest && guestQuota.limitReached && (
          <View style={styles.guestLimitBar} testID="guest-limit-bar">
            <Text style={styles.guestLimitText}>
              {guestQuota.limitMessage || "You've reached the guest limit. Create a free account to continue."}
            </Text>
            <View style={styles.guestLimitBtnRow}>
              <Pressable
                testID="guest-create-account-btn"
                style={styles.guestLimitPrimaryBtn}
                onPress={() => { trackEvent('guest_converted_to_account'); router.push('/signup'); }}
              >
                <Text style={styles.guestLimitPrimaryBtnText}>Create Free Account</Text>
              </Pressable>
              <Pressable
                testID="guest-sign-in-btn"
                style={styles.guestLimitSecondaryBtn}
                onPress={() => router.push('/login')}
              >
                <Text style={styles.guestLimitSecondaryBtnText}>Sign In</Text>
              </Pressable>
            </View>
            <EmergencyCallShortcut language={language.code} />
          </View>
        )}

        {/* Unified input / recording bar — mic button always mounted for gesture continuity */}
        {locked && recording ? (
          /* Hands-free locked recording bar — replaces the composer entirely.
             The user released their finger after dragging up; recording keeps
             going until they tap trash (discard) or the checkmark (finish). */
          <View style={styles.lockedBar} testID="locked-rec-bar">
            <View style={styles.recLeft}>
              <Animated.View style={[styles.recDot, { transform: [{ scale: micPulse }] }]} />
              <Text style={styles.recTimer}>
                {String(Math.floor(holdElapsed / 60)).padStart(2, '0')}:
                {String(holdElapsed % 60).padStart(2, '0')}
              </Text>
            </View>
            <Waveform />
            <Pressable testID="locked-cancel-btn" style={styles.lockedIconBtn} onPress={onLockedCancel} hitSlop={10}>
              <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
            </Pressable>
            <Pressable testID="locked-finish-btn" style={styles.lockedSendBtn} onPress={onLockedFinish} hitSlop={10}>
              <Ionicons name="checkmark" size={22} color={theme.colors.onBrandPrimary} />
            </Pressable>
          </View>
        ) : (
          <View
            style={[recording ? styles.recordingBar : styles.inputBar]}
            testID={recording ? 'rec-bar' : 'input-bar'}
          >
            {recording ? (
              <>
                {/* Timer + red dot + live waveform on the left */}
                <View style={styles.recLeft}>
                  <Animated.View style={[styles.recDot, { transform: [{ scale: micPulse }] }]} />
                  <Text style={styles.recTimer}>
                    {String(Math.floor(holdElapsed / 60)).padStart(2, '0')}:
                    {String(holdElapsed % 60).padStart(2, '0')}
                  </Text>
                  <View style={styles.waveformInline} testID="voice-waveform">
                    {waveBars.map((bar, i) => (
                      <Animated.View
                        key={i}
                        style={[
                          styles.waveBar,
                          { height: bar.interpolate({ inputRange: [0, 1], outputRange: [4, 18] }) },
                        ]}
                      />
                    ))}
                  </View>
                </View>

                {/* Slide to cancel indicator */}
                <Animated.View style={[
                  styles.recCenter,
                  {
                    opacity: slideX.interpolate({
                      inputRange: [-160, -40, 0],
                      outputRange: [0.2, 0.7, 1],
                      extrapolate: 'clamp',
                    }),
                  }
                ]}>
                  {slideCancelled ? (
                    <View style={styles.cancelActive}>
                      <Ionicons name="trash" size={18} color={theme.colors.error} />
                      <Text style={styles.cancelActiveText}>Release to cancel</Text>
                    </View>
                  ) : (
                    <View style={styles.slideHint}>
                      <Ionicons name="chevron-back" size={14} color={theme.colors.onSurfaceTertiary} />
                      <Text style={styles.slideHintText}>
                        {Platform.OS === 'web' ? 'Tap mic to stop & send' : 'Slide to cancel'}
                      </Text>
                    </View>
                  )}
                </Animated.View>

                {/* Lock affordance — drag the mic straight up into this pill
                    to keep recording hands-free, exactly like WhatsApp. */}
                <Animated.View
                  testID="lock-hint"
                  pointerEvents="none"
                  style={[
                    styles.lockHint,
                    {
                      opacity: slideY.interpolate({ inputRange: [-70, -10, 0], outputRange: [1, 0.6, 0], extrapolate: 'clamp' }),
                      transform: [{
                        translateY: slideY.interpolate({ inputRange: [-70, 0], outputRange: [-6, 0], extrapolate: 'clamp' }),
                      }],
                    },
                  ]}
                >
                  <Ionicons name="lock-closed" size={13} color={theme.colors.brand} />
                  <Ionicons name="chevron-up" size={12} color={theme.colors.brand} />
                </Animated.View>
              </>
            ) : (
              <>
                <TextInput
                  testID="chat-input"
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder={`Ask in ${language.native}…`}
                  placeholderTextColor={theme.colors.onSurfaceTertiary}
                  multiline
                  editable={!streaming && !transcribing}
                  returnKeyType={Platform.OS !== 'web' ? 'send' : 'default'}
                  blurOnSubmit={false}
                  onSubmitEditing={
                    Platform.OS !== 'web'
                      ? () => { if (!streaming && !transcribing && input.trim()) send(input); }
                      : undefined
                  }
                  onKeyPress={(e: any) => {
                    if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                      e.preventDefault?.();
                      if (!streaming && !transcribing && input.trim()) send(input);
                    }
                  }}
                />
              </>
            )}

            {/* Right side: mic or send. Native keeps the WhatsApp-style
                press-and-hold PanResponder; web uses a plain click-to-toggle
                Pressable (see onWebMicPress) — press-and-hold has no
                reliable equivalent with a mouse, and can trigger the
                browser's own text-selection/context-menu on touch. */}
            {(!recording && input.trim().length > 0) ? (
              <Pressable
                testID="send-button"
                onPress={() => send(input)}
                disabled={streaming}
                style={styles.send}
              >
                <Ionicons name="arrow-up" size={24} color={theme.colors.onBrandPrimary} />
              </Pressable>
            ) : Platform.OS === 'web' ? (
              <Pressable
                testID="mic-button"
                onPress={onWebMicPress}
                style={recording ? styles.micRecording : styles.mic}
              >
                {transcribing ? (
                  <ActivityIndicator color={theme.colors.onBrandPrimary} />
                ) : (
                  <Ionicons name={recording ? 'stop' : 'mic'} size={26} color={theme.colors.onBrandPrimary} />
                )}
              </Pressable>
            ) : (
              <Animated.View
                testID="mic-button"
                style={[
                  recording ? styles.micRecording : styles.mic,
                  recording && {
                    transform: [
                      { translateX: slideX },
                      { translateY: slideY },
                      { scale: micPulse },
                    ],
                    backgroundColor: slideCancelled ? theme.colors.error : theme.colors.brandSecondary,
                  },
                ]}
                {...micPanResponder.panHandlers}
              >
                {transcribing ? (
                  <ActivityIndicator color={theme.colors.onBrandPrimary} />
                ) : (
                  <Ionicons
                    name={recording && slideCancelled ? 'trash' : 'mic'}
                    size={26}
                    color={theme.colors.onBrandPrimary}
                  />
                )}
              </Animated.View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
      </View>{/* ── end webContentWrap ── */}

      {/* ─── Transcript confirmation modal ───────────────────────────────── */}
      <Modal
        visible={showTranscriptModal}
        transparent
        animationType="fade"
        onRequestClose={cancelTranscript}
      >
        <View style={styles.pwOverlay}>
          <View style={styles.tcCard} testID="transcript-modal">
            <View style={styles.tcHeader}>
              <Ionicons name="mic-circle" size={26} color={theme.colors.brand} />
              <Text style={styles.tcTitle}>We heard</Text>
            </View>

            {transcriptMismatch && (
              <View style={styles.tcMismatchBanner} testID="transcript-mismatch-warning">
                <Ionicons name="warning" size={16} color={theme.colors.error} />
                <Text style={styles.tcMismatchText}>
                  {transcriptMismatch.detected
                    ? `This looks like ${transcriptMismatch.detected.charAt(0).toUpperCase()}${transcriptMismatch.detected.slice(1)} script, not ${language?.native || language?.name || 'the selected language'}. Please check before sending — it may search for the wrong words.`
                    : `This doesn't look like ${language?.native || language?.name || 'the selected language'}. Please check before sending.`}
                </Text>
              </View>
            )}

            {!transcriptMismatch && VOICE_COMPANION_ENABLED && transcriptNeedsExtraCare && (
              <View style={styles.tcMismatchBanner} testID="transcript-extra-care-warning">
                <Ionicons name="warning" size={16} color={theme.colors.error} />
                <Text style={styles.tcMismatchText}>
                  This includes a date, amount, section or state — please check it carefully before sending.
                </Text>
              </View>
            )}

            <Text style={styles.tcText} testID="transcript-text">
              {`\u201C${transcriptPreview}\u201D`}
            </Text>

            <Pressable
              testID="transcript-send-btn"
              style={[styles.tcSendBtn, transcriptMismatch && styles.tcSendBtnWarn]}
              onPress={sendTranscript}
            >
              <Ionicons name="send" size={16} color={theme.colors.onBrandPrimary} />
              <Text style={styles.tcSendText}>{transcriptMismatch ? 'Send anyway' : 'Correct — send'}</Text>
            </Pressable>

            <View style={styles.tcRow}>
              <Pressable
                testID="transcript-edit-btn"
                style={styles.tcSecondaryBtn}
                onPress={editTranscriptInComposer}
              >
                <Ionicons name="pencil" size={14} color={theme.colors.brand} />
                <Text style={styles.tcSecondaryText}>Edit</Text>
              </Pressable>
              <Pressable
                testID="transcript-cancel-btn"
                style={styles.tcSecondaryBtn}
                onPress={cancelTranscript}
              >
                <Ionicons name="mic-off" size={14} color={theme.colors.brand} />
                <Text style={styles.tcSecondaryText}>Re-record</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Paywall Modal — shown when Pro-mode samples exhausted */}
      <Modal
        visible={paywall !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPaywall(null)}
      >
        <View style={styles.pwOverlay}>
          <View style={styles.pwCard} testID="paywall-modal">
            <View style={styles.pwCrown}>
              <Ionicons name="lock-closed" size={28} color={theme.colors.brandSecondary} />
            </View>
            <Text style={styles.pwTitle}>Free samples used</Text>
            <Text style={styles.pwBody}>{paywall?.message}</Text>
            {PRO_UPGRADE_ENABLED && (
              <>
                <View style={styles.pwPriceRow}>
                  <Text style={styles.pwPrice}>{paywall?.pro_price_label}</Text>
                  <Text style={styles.pwPriceOr}>or</Text>
                  <Text style={styles.pwPrice}>{paywall?.pro_price_usd_label}</Text>
                </View>
                <Text style={styles.pwPriceMeta}>one-time · lifetime Pro access</Text>

                <Pressable
                  testID="paywall-upgrade-btn"
                  style={styles.pwUpgrade}
                  onPress={() => {
                    setPaywall(null);
                    router.push('/upgrade');
                  }}
                >
                  <Ionicons name="star" size={18} color={theme.colors.onBrandPrimary} />
                  <Text style={styles.pwUpgradeText}>Upgrade to Pro</Text>
                </Pressable>
              </>
            )}

            <Pressable
              testID="paywall-continue-basic-btn"
              onPress={() => {
                setPaywall(null);
                setProMode(false);
              }}
            >
              <Text style={styles.pwContinue}>Continue in Basic mode (free, unlimited) →</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
