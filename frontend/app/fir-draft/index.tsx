/**
 * DHARA FIR Interview Engine — Conversational UI (v3)
 * Stage-based chat interface that guides citizens through FIR preparation.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Platform, Alert, KeyboardAvoidingView, Linking, Image,
  Animated, PanResponder,
  type GestureResponderEvent, type PanResponderGestureState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { API_BASE, useAuth } from '@/src/auth';
import {
  useAudioRecorder, RecordingPresets, setAudioModeAsync, AudioModule,
  createAudioPlayer,
} from 'expo-audio';
import { whisperTranscribeFile } from '@/src/voice/stt';
import { ChunkedSpeaker } from '@/src/voice/tts';
import { createBrowserTtsPlayer } from '@/src/voice/browserPlayer';
import { VoiceNotice } from '@/src/components/VoiceNotice';
import { trackEvent } from '@/src/analytics';
import { theme } from '@/src/theme';
import FirSectionDrawer, { SectionItem, DroppedSection } from '@/src/components/FirSectionDrawer';
import { MarqueeBanner } from '@/src/components/MarqueeBanner';

// Native location is optional; importing it on web fails in the installed version.
const Location: typeof import('expo-location') | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Platform.OS !== 'web' ? (() => { try { return require('expo-location'); } catch { return null; } })() : null;

// ── Theme ─────────────────────────────────────────────────────────────────────
const NAVY   = theme.colors.primary;
const GOLD   = theme.colors.gold;
const CREAM  = theme.colors.surfaceSecondary;
const SURFACE = theme.colors.surface;
const MUTED  = theme.colors.onSurfaceSecondary;
const RED    = theme.colors.error;
const GREEN  = theme.colors.success;
const BORDER = theme.colors.border;

// ── Language options ──────────────────────────────────────────────────────────
const FIR_LANGUAGES = [
  { code: 'en', label: 'English',  native: 'English',  sttLang: 'en-IN' },
  { code: 'hi', label: 'Hindi',    native: 'हिन्दी',   sttLang: 'hi-IN' },
  { code: 'mr', label: 'Marathi',  native: 'मराठी',    sttLang: 'mr-IN' },
  { code: 'ta', label: 'Tamil',    native: 'தமிழ்',    sttLang: 'ta-IN' },
];
const FIR_LANG_KEY = 'fir_draft_lang_v3';
const FIR_SESSION_KEY = 'fir_active_session_v3';
const FIR_MODULE_KEY = 'fir_selected_module_v1';

// ── Mic gesture thresholds (mirrors the Home screen's WhatsApp-style mic) ──
const CANCEL_THRESHOLD = -80; // px the user must drag left to cancel
const LOCK_THRESHOLD = -55; // px the user must drag up to lock hands-free recording

// ── Incident modules ──────────────────────────────────────────────────────────
const INCIDENT_MODULES = [
  {
    key: 'cybercrime',
    emoji: '💻',
    label: 'Cybercrime',
    sublabel: 'Online fraud · UPI scam · Hacking',
    bns: 'IT Act · BNS 318',
    color: '#1A3F74',
  },
  {
    key: 'domestic_violence',
    emoji: '🏠',
    label: 'Domestic Violence',
    sublabel: 'Dowry · 498A · DV Act',
    bns: 'BNS 85 · DV Act',
    color: '#7B2D8B',
  },
  {
    key: 'theft',
    emoji: '📱',
    label: 'Theft / Robbery',
    sublabel: 'Stolen phone · Snatching · Burglary',
    bns: 'BNS 303–310',
    color: '#B45309',
  },
  {
    key: 'posh',
    emoji: '👔',
    label: 'Workplace Harassment',
    sublabel: 'POSH Act · Sexual harassment at work',
    bns: 'BNS 74–75 · POSH 2013',
    color: '#0F766E',
  },
  {
    key: 'consumer_fraud',
    emoji: '💳',
    label: 'Consumer / Banking Fraud',
    sublabel: 'E-commerce · UPI · Defective goods',
    bns: 'BNS 318 · Consumer Act',
    color: '#1D4ED8',
  },
  {
    key: 'other',
    emoji: '❓',
    label: 'Other Incident',
    sublabel: 'Assault · Murder · General complaint',
    bns: 'All BNS sections',
    color: '#4B5563',
  },
] as const;

type ModuleKey = typeof INCIDENT_MODULES[number]['key'];

// Allowed file types for evidence upload
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ALLOWED_EXT = ['jpg','jpeg','png','heic','heif','webp','mp4','mov','avi','pdf','doc','docx'];

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'bot' | 'user';
  text: string;
  timestamp: string;
}
interface TurnResponse {
  session_id: string;
  stage: string;
  bot_message: string;
  input_type: string;
  quick_replies?: string[];
  skip_label?: string;
  confirmed_address?: string;
  suggested_sections?: any[];
  dropped_sections?: any[];
  slots_preview?: any;
  draft?: string;
  completed?: boolean;
  safety_flags?: string[];
  // v3.3: Emergency & alert fields
  show_emergency?: boolean;
  action?: string;
  emergency_numbers?: Array<{ label: string; number: string }>;
  show_cybercrime_alert?: boolean;
  // v3.4: Probe progress for "Q X/Y" UI counter
  probe_progress_done?: number;
  probe_progress_total?: number;
}
interface UploadedFile {
  file_id: string;
  filename: string;
  file_type: string;
  local_uri?: string;   // v3.3: client-side preview URI
  content_type?: string;
  caption?: string;     // Issue 17: evidence caption
}

function msgId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function FirDraftScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ resumeId?: string }>();
  const { user } = useAuth();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  // ── Session state ──────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputType, setInputType] = useState<string>('quick_reply');
  const [quickReplies, setQuickReplies] = useState<string[]>(["Yes, I'm safe", "No, I need help"]);
  const [skipLabel, setSkipLabel] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<UploadedFile[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [gpsAvailable, setGpsAvailable] = useState(Platform.OS !== 'web');
  // v3.3: New state
  const [currentStage, setCurrentStage] = useState<string>('safety_gate');
  const [showEmergencyScreen, setShowEmergencyScreen] = useState(false);
  const [emergencyNumbers, setEmergencyNumbers] = useState<Array<{label: string; number: string}>>([]);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [checkingResume, setCheckingResume] = useState(true);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const autoResumedId = useRef<string | null>(null);

  // Issue 9: Section drawer state
  const [showSectionDrawer, setShowSectionDrawer] = useState(false);
  const [suggestedSections, setSuggestedSections] = useState<SectionItem[]>([]);
  const [droppedSections, setDroppedSections] = useState<DroppedSection[]>([]);
  const [sectionMsgId, setSectionMsgId] = useState<string | null>(null);
  const messageYsRef = useRef<{[id: string]: number}>({});

  // Probe progress state (for "Q 3/12" indicator)
  const [probeCurrentNum, setProbeCurrentNum] = useState(0);
  const [probeTotal, setProbeTotal] = useState(0);
  const [autoSpeak, setAutoSpeak]   = useState(true);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [ttsLoadingMsgId, setTtsLoadingMsgId] = useState<string | null>(null);
  const speakerRef   = useRef<InstanceType<typeof ChunkedSpeaker> | null>(null);
  const browserAudioRef = useRef<HTMLAudioElement | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const autoSpeakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingIdRef = useRef<string | null>(null);
  // Forward-declared refs to avoid stale closures in applyTurn callback
  const autoSpeakRef = useRef(true);
  const speakRef = useRef<((msgId: string, text: string) => void) | null>(null);

  // ── Language ───────────────────────────────────────────────────────────────
  const [language, setLanguage] = useState('en');
  const [sessionStarted, setSessionStarted] = useState(false);
  // ── Module selection ───────────────────────────────────────────────────────
  const [selectedModule, setSelectedModule] = useState<ModuleKey | null>(null);

  // ── Voice recording ────────────────────────────────────────────────────────
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recordingRequestedRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const recordingStartingRef = useRef(false);
  // Web-only: browser MediaRecorder (expo-audio recording doesn't work on web)
  const webRecorderRef = useRef<any>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const webStreamRef = useRef<any>(null);

  // ── WhatsApp-style mic gesture (slide-to-cancel / slide-up-to-lock) ────────
  // Mirrors the Home screen's mic gesture exactly, so voice input feels the
  // same everywhere in the app. The animated values drive the mic button's
  // position/scale; the gesture only engages on native (press-and-hold with
  // drag has no reliable mouse equivalent — web keeps a simple tap-toggle).
  const slideX = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(0)).current;
  const micPulse = useRef(new Animated.Value(1)).current;
  const waveBars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.3))).current;
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [slideCancelled, setSlideCancelled] = useState(false);
  const slideCancelledRef = useRef(false);
  const [holdElapsed, setHoldElapsed] = useState(0);
  const holdTimerRef = useRef<any>(null);

  const scrollRef = useRef<ScrollView>(null);

  // Live waveform while recording — purely visual Animated loops, same as
  // the Home screen (no dependency on native audio-level metering, which is
  // known to be unreliable on several Android OEMs and undefined on web).
  useEffect(() => {
    const loops: Animated.CompositeAnimation[] = [];
    if (isRecording) {
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
      waveBars.forEach((bar) => { bar.stopAnimation(); bar.setValue(0.3); });
    }
    return () => { loops.forEach((l) => l.stop()); };
  }, [isRecording, waveBars]);

  // ── Load saved language + check for saved session ────────────────────────
  useEffect(() => {
    const init = async () => {
      const savedLang = await AsyncStorage.getItem(FIR_LANG_KEY);
      if (savedLang) setLanguage(savedLang);
      // v3.3: If a resumeId was passed from home screen, auto-resume
      if (params.resumeId) {
        setSavedSessionId(params.resumeId);
        setCheckingResume(false);
        return;
      }
      // v3.3: Check for a paused/active session to resume
      const saved = await AsyncStorage.getItem(FIR_SESSION_KEY);
      if (saved) {
        try {
          const res = await fetch(`${API_BASE}/api/fir/session/${saved}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (res.ok) {
            const sess = await res.json();
            if (sess.status !== 'completed' && sess.status !== 'cancelled') {
              setSavedSessionId(saved);
            } else {
              await AsyncStorage.removeItem(FIR_SESSION_KEY);
            }
          } else {
            await AsyncStorage.removeItem(FIR_SESSION_KEY);
          }
        } catch { /* session gone */ }
      }
      setCheckingResume(false);
    };
    init();
  }, [params.resumeId, token]);

  const saveLanguage = async (code: string) => {
    setLanguage(code);
    await AsyncStorage.setItem(FIR_LANG_KEY, code);
  };

  // ── Auto-scroll to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, isLoading]);

  // ── Add message helper ─────────────────────────────────────────────────────
  const addMessage = useCallback((role: 'bot' | 'user', text: string): string => {
    const id = msgId();
    setMessages(prev => [...prev, {
      id, role, text,
      timestamp: new Date().toISOString(),
    }]);
    return id;
  }, []);

  // ── Apply turn response ───────────────────────────────────────────────────
  const applyTurn = useCallback((res: TurnResponse) => {
    let botMsgId: string | undefined;
    if (res.bot_message) {
      botMsgId = addMessage('bot', res.bot_message);
    }
    setCurrentStage(res.stage || '');
    setInputType(res.input_type || 'text');
    setQuickReplies(res.quick_replies || []);
    setSkipLabel(res.skip_label);
    if (res.draft) setDraft(res.draft);
    // v3.4: Update probe progress counter "Q X/Y"
    if (res.probe_progress_done !== undefined && res.probe_progress_total !== undefined) {
      setProbeCurrentNum(res.probe_progress_done + 1);  // 1-indexed: "Q 1/10"
      setProbeTotal(res.probe_progress_total);
    }
    // v3.3: Emergency screen
    if (res.show_emergency || res.action === 'EMERGENCY') {
      setEmergencyNumbers(res.emergency_numbers || [
        { label: 'Emergency', number: '112' },
        { label: 'Women Helpline', number: '181' },
        { label: 'Ambulance', number: '108' },
      ]);
      setShowEmergencyScreen(true);
    }
    // Issue 9: Capture sections when section_suggest stage is entered
    if (res.suggested_sections && res.suggested_sections.length > 0) {
      setSuggestedSections(res.suggested_sections);
      if (botMsgId) setSectionMsgId(botMsgId);
    }
    if (res.dropped_sections && res.dropped_sections.length > 0) {
      setDroppedSections(res.dropped_sections);
    }
    // TTS: auto-speak bot message
    if (botMsgId && res.bot_message) {
      // Use ref to avoid stale closure
      if (autoSpeakTimerRef.current) clearTimeout(autoSpeakTimerRef.current);
      autoSpeakTimerRef.current = setTimeout(() => {
        if (autoSpeakRef.current && botMsgId) {
          speakRef.current?.(botMsgId, res.bot_message!);
        }
      }, 200);
    }
  }, [addMessage]);

  // ── Create session ─────────────────────────────────────────────────────────
  const startSession = async () => {
    if (!language) return;
    setIsLoading(true);
    setSessionStarted(true);
    setMessages([]);
    setSavedSessionId(null);
    try {
      // Try to silently get GPS for session_location_start (native only)
      let sessionLocationStart = null;
      try {
        if (Location) {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            sessionLocationStart = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          }
        }
      } catch { /* GPS optional at start */ }

      const res = await fetch(`${API_BASE}/api/fir/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id || `anon-${Date.now()}`,
          language,
          session_location_start: sessionLocationStart,
          incident_type: selectedModule ?? 'other',
        }),
      });
      if (!res.ok) throw new Error('Session creation failed');
      const data: TurnResponse = await res.json();
      setSessionId(data.session_id);
      trackEvent('complaint_started', { complaint_type: selectedModule ?? 'other' });
      // v3.3: Persist session for silent resume
      await AsyncStorage.setItem(FIR_SESSION_KEY, data.session_id);
      applyTurn(data);
    } catch {
      Alert.alert('Error', 'Could not start session. Please check your connection.');
      setSessionStarted(false);
    } finally {
      setIsLoading(false);
    }
  };

  // ── v3.3: Resume a saved session ─────────────────────────────────────────
  const resumeSession = useCallback(async (sid: string) => {
    setIsLoading(true);
    setResumeError(null);
    setSessionStarted(true);
    setMessages([]);
    try {
      const res = await fetch(`${API_BASE}/api/fir/session/${sid}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('Session not found');
      const sess = await res.json();
      setSessionId(sid);
      setLanguage(sess.language || 'en');
      setCurrentStage(sess.stage || 'safety_gate');
      await AsyncStorage.setItem(FIR_SESSION_KEY, sid);

      // Issue 17: Restore evidence files with captions
      const storedEvidence: any[] = sess.evidence_files || [];
      if (storedEvidence.length > 0) {
        const restored = storedEvidence.map((e: any) => ({
          file_id: typeof e === 'string' ? e : e.file_id,
          filename: typeof e === 'string' ? e : (e.filename || e),
          file_type: e.file_type || 'document',
          local_uri: undefined,
          content_type: e.content_type,
          caption: e.caption || '',
        }));
        setEvidenceFiles(restored);
      }

      // Issue 9: Restore sections if already suggested
      if (sess.suggested_sections?.length > 0) {
        setSuggestedSections(sess.suggested_sections);
      }
      if (sess.dropped_sections?.length > 0) {
        setDroppedSections(sess.dropped_sections);
      }

      // v3.4: Restore FULL conversation thread (all narrative_turns, using .message key)
      const turns: any[] = sess.narrative_turns || [];
      turns.forEach((t: any) => {
        const text = t.message || t.content || t.text || '';
        if (text) addMessage(t.role as 'bot' | 'user', text);
      });

      // Resume with current probe (adds "Welcome back!" message via backend)
      const currentProbe = sess.current_probe;
      if (currentProbe) {
        // Fetch the probe definition via a "continue" turn
        const tRes = await fetch(`${API_BASE}/api/fir/session/${sid}/turn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ action: 'resume' }),
        });
        if (tRes.ok) {
          const tData: TurnResponse = await tRes.json();
          applyTurn(tData);
        } else {
          addMessage('bot', 'Welcome back! Please continue from where you left off.');
          setInputType('voice_or_text');
        }
      } else {
        // Session may already be at section_suggest or later — just restore UI
        addMessage('bot', 'Welcome back! Your session has been restored.');
        setInputType(sess.stage === 'free_narrative' ? 'voice_or_text' : 'text');
      }
    } catch {
      setResumeError('Could not restore your complaint. Check your connection and tap Continue your complaint to retry.');
      setSessionStarted(false);
    } finally {
      setIsLoading(false);
    }
  }, [addMessage, applyTurn, token]);

  // Home/complaint cards already express the user's intention to continue.
  // Wait for local language hydration, then resume once rather than asking twice.
  useEffect(() => {
    if (!params.resumeId || checkingResume || autoResumedId.current === params.resumeId) return;
    autoResumedId.current = params.resumeId;
    void resumeSession(params.resumeId);
  }, [params.resumeId, checkingResume, resumeSession]);

  // ── Send a turn ────────────────────────────────────────────────────────────
  const sendTurn = useCallback(async (
    userMsg?: string,
    gps?: { lat: number; lng: number },
    action?: string,
  ) => {
    if (!sessionId || isLoading) return;
    if (userMsg) addMessage('user', userMsg);
    else if (action === 'skip') addMessage('user', skipLabel || 'Skip');
    else if (action === 'upload_done') addMessage('user', `${evidenceFiles.length} file(s) uploaded`);

    setIsLoading(true);
    setTextInput('');
    try {
      const body: any = {};
      if (userMsg) body.user_message = userMsg;
      if (gps) body.gps = gps;
      if (action) body.action = action;
      const res = await fetch(`${API_BASE}/api/fir/session/${sessionId}/turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Turn failed: ${res.status}`);
      const data: TurnResponse = await res.json();
      applyTurn(data);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, isLoading, skipLabel, evidenceFiles.length, addMessage, applyTurn, token]);

  // ── GPS capture ────────────────────────────────────────────────────────────
  const handleGetGPS = async () => {
    // GPS not supported on web — fall back silently to typed input
    if (!Location) {
      setGpsAvailable(false);
      return;
    }
    let { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      if (!canAskAgain) {
        Alert.alert(
          'Location Permission Required',
          'GPS access is needed to pinpoint the incident location. Please enable it in Settings.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Skip GPS', onPress: () => sendTurn(undefined, undefined, 'skip') },
          ],
        );
      } else {
        Alert.alert('Permission Denied', 'GPS permission was denied.', [
          { text: 'Skip GPS', onPress: () => sendTurn(undefined, undefined, 'skip') },
        ]);
      }
      return;
    }
    setIsLoading(true);
    addMessage('user', '📍 Getting GPS location…');
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await sendTurn(
        undefined,
        { lat: loc.coords.latitude, lng: loc.coords.longitude },
        undefined,
      );
    } catch {
      Alert.alert('GPS Error', 'Could not get location. Please try again.');
    } finally {
    }
  };

  // ── Evidence upload — with type validation + 413 handling ───────────────
  const handlePickEvidence = async () => {
    if (!sessionId) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const assets = result.assets || [];
      if (assets.length === 0) return;

      setUploadingEvidence(true);
      const uploaded: UploadedFile[] = [];
      for (const asset of assets.slice(0, 10 - evidenceFiles.length)) {
        // v3.3: File type validation
        const ext = (asset.name?.split('.').pop() || '').toLowerCase();
        const mime = asset.mimeType || '';
        const allowed = ALLOWED_EXT.includes(ext) || ALLOWED_MIME.includes(mime);
        if (!allowed) {
          Alert.alert('Unsupported File', `"${asset.name}" is not supported.
Allowed: JPG, PNG, HEIC, MP4, MOV, PDF, DOC, DOCX`);
          continue;
        }
        try {
          const formData = new FormData();
          if (Platform.OS === 'web') {
            const blob = await (await fetch(asset.uri)).blob();
            formData.append('file', blob, asset.name);
          } else {
            formData.append('file', {
              uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream',
            } as any);
          }
          const res = await fetch(`${API_BASE}/api/fir/session/${sessionId}/evidence`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: formData,
          });
          // v3.3: 413 error
          if (res.status === 413) {
            Alert.alert('File Too Large', `"${asset.name}" exceeds the size limit (20 MB). Please compress the file and try again.`);
            continue;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.file) {
              uploaded.push({
                ...data.file,
                local_uri: asset.uri,           // store for thumbnail
                content_type: asset.mimeType,
              });
            }
          }
        } catch (e) {
          console.warn('Evidence upload failed for', asset.name, e);
        }
      }
      if (uploaded.length > 0) {
        setEvidenceFiles(prev => [...prev, ...uploaded]);
        addMessage('user', `📎 Uploaded: ${uploaded.map(f => f.filename).join(', ')}`);
      }
    } catch (err) {
      Alert.alert('Upload failed', 'Please try again.');
      console.warn('Evidence upload error:', err);
    } finally {
      setUploadingEvidence(false);
    }
  };

  // ── v3.3: Remove evidence file ─────────────────────────────────────────────
  const handleRemoveEvidence = async (fileId: string) => {
    if (!sessionId) return;
    try {
      await fetch(`${API_BASE}/api/fir/session/${sessionId}/evidence/${fileId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      setEvidenceFiles(prev => prev.filter(f => f.file_id !== fileId));
    } catch {
      Alert.alert('Error', 'Could not remove file. Please try again.');
    }
  };

  // Issue 17: Update evidence caption
  const captionTimersRef = useRef<{[fileId: string]: ReturnType<typeof setTimeout>}>({});
  const handleCaptionChange = useCallback((fileId: string, caption: string) => {
    // Update local state immediately
    setEvidenceFiles(prev => prev.map(f => f.file_id === fileId ? { ...f, caption } : f));
    // Debounce the PATCH to backend (500ms)
    if (captionTimersRef.current[fileId]) clearTimeout(captionTimersRef.current[fileId]);
    captionTimersRef.current[fileId] = setTimeout(async () => {
      if (!sessionId) return;
      try {
        await fetch(`${API_BASE}/api/fir/session/${sessionId}/evidence/${fileId}/caption`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ caption }),
        });
      } catch { /* best effort */ }
    }, 500);
  }, [sessionId, token]);

  // ── Voice recording ────────────────────────────────────────────────────────
  const startRecording = async () => {
    if (transcribing || recordingStartingRef.current || recordingActiveRef.current) return;
    recordingRequestedRef.current = true;
    recordingStartingRef.current = true;
    stopTTS();
    setVoiceNotice(null);

    // ── Web: use browser MediaRecorder (expo-audio recording is not supported on web) ──
    if (Platform.OS === 'web') {
      try {
        if (!(navigator as any)?.mediaDevices?.getUserMedia) {
          setVoiceNotice('Microphone recording is not supported in this browser. Please type your answer below.');
          return;
        }
        const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
        webStreamRef.current = stream;
        const WMR = (window as any).MediaRecorder;
        const mimeType = (WMR && WMR.isTypeSupported('audio/webm;codecs=opus'))
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const mr = new WMR(stream, { mimeType });
        webChunksRef.current = [];
        mr.ondataavailable = (e: any) => { if (e.data?.size > 0) webChunksRef.current.push(e.data); };
        mr.start();
        webRecorderRef.current = mr;
        recordingActiveRef.current = true;
        setIsRecording(true);
      } catch {
        setIsRecording(false);
        setVoiceNotice('Microphone access is blocked. Click the 🔒 icon in your browser address bar to allow mic access, or type your answer below.');
      } finally {
        recordingStartingRef.current = false;
      }
      return;
    }

    // ── Native: use expo-audio ──────────────────────────────────────────────
    try {
      const { status } = await AudioModule.requestRecordingPermissionsAsync();
      if (status !== 'granted') {
        setVoiceNotice('Microphone access is blocked. Allow microphone access in your device settings, or type your answer below.');
        return;
      }
      if (!recordingRequestedRef.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      // A permission prompt or preparation can outlast the user's press.
      // Stop and discard immediately rather than recording after they let go.
      if (!recordingRequestedRef.current) {
        await recorder.stop();
        return;
      }
      recordingActiveRef.current = true;
      setIsRecording(true);
    } catch {
      setIsRecording(false);
      setVoiceNotice('Could not access the microphone. Check its permission, end any active call, or type your answer below.');
    } finally {
      recordingStartingRef.current = false;
    }
  };

  const stopRecording = async () => {
    recordingRequestedRef.current = false;
    if (!recordingActiveRef.current) return;
    recordingActiveRef.current = false;
    setIsRecording(false);
    setTranscribing(true);

    // ── Web: stop browser MediaRecorder and upload ──────────────────────────
    if (Platform.OS === 'web') {
      const mr = webRecorderRef.current;
      if (!mr) { setTranscribing(false); return; }
      try {
        const audioBlob: Blob = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Recording stop timeout')), 8000);
          mr.onstop = () => {
            clearTimeout(timeout);
            const blob = new Blob(webChunksRef.current, { type: 'audio/webm' });
            resolve(blob);
          };
          try { mr.stop(); } catch (e) { clearTimeout(timeout); reject(e); }
        });
        // Stop all mic tracks
        try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
        webRecorderRef.current = null;
        webStreamRef.current = null;
        webChunksRef.current = [];

        if (!audioBlob || audioBlob.size === 0) {
          setVoiceNotice('No audio captured. Please hold the mic button while speaking.');
          return;
        }
        const blobUrl = URL.createObjectURL(audioBlob);
        try {
          const langCode = FIR_LANGUAGES.find(l => l.code === language)?.code || 'en';
          if (!API_BASE || !token) throw new Error('Voice input is unavailable');
          const result = await whisperTranscribeFile(API_BASE, token, blobUrl, langCode);
          const text = result?.text || '';
          if (text) setTextInput(prev => (prev ? prev + ' ' + text : text));
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } catch {
        setVoiceNotice('Could not transcribe this recording. Please try again or type your response instead.');
      } finally {
        setTranscribing(false);
      }
      return;
    }

    // ── Native: stop expo-audio recorder and upload ─────────────────────────
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording URI');
      const langCode = FIR_LANGUAGES.find(l => l.code === language)?.code || 'en';
      if (!API_BASE || !token) throw new Error('Voice input is unavailable');
      const result = await whisperTranscribeFile(API_BASE, token, uri, langCode);
      const text = result?.text || '';
      if (text) setTextInput(prev => (prev ? prev + ' ' + text : text));
    } catch {
      setVoiceNotice('Could not transcribe this recording. Please try again or type your response instead.');
    } finally {
      setTranscribing(false);
    }
  };

  /** Discards the in-progress recording without transcribing — used when the
   * user slides left past CANCEL_THRESHOLD, or taps trash on the locked bar. */
  const discardRecording = useCallback(async () => {
    recordingRequestedRef.current = false;
    if (!recordingActiveRef.current) return;
    recordingActiveRef.current = false;
    setIsRecording(false);
    if (Platform.OS === 'web') {
      try { webRecorderRef.current?.stop(); } catch {}
      try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
      webRecorderRef.current = null;
      webStreamRef.current = null;
      webChunksRef.current = [];
    } else {
      try { await recorder.stop(); } catch {}
      try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); } catch {}
    }
  }, [recorder]);

  /** Resets the pulse animation + hold timer. Called on press-out, lock
   * cancel/finish, and cancel-via-slide — kept in one place to avoid the
   * timer/animation leaking into the next recording. */
  const resetMicGestureUi = useCallback(() => {
    micPulse.stopAnimation();
    micPulse.setValue(1);
    if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
    setHoldElapsed(0);
  }, [micPulse]);

  // WhatsApp-style hold-to-talk handlers — wraps startRecording/stopRecording
  // with the slide-to-cancel / slide-up-to-lock gesture state, exactly like
  // the Home screen's mic. Used by both the native PanResponder and the
  // web tap-to-toggle button, so the live timer + waveform show everywhere.
  const onMicPressIn = useCallback(() => {
    slideCancelledRef.current = false;
    setSlideCancelled(false);
    lockedRef.current = false;
    setLocked(false);
    slideX.setValue(0);
    slideY.setValue(0);
    setHoldElapsed(0);
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdTimerRef.current = setInterval(() => setHoldElapsed((prev) => prev + 1), 1000);
    Animated.loop(
      Animated.sequence([
        Animated.timing(micPulse, { toValue: 1.25, duration: 600, useNativeDriver: true }),
        Animated.timing(micPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
    void startRecording();
  }, [startRecording, slideX, slideY, micPulse]);

  const onMicPressOut = useCallback(() => {
    // Locked (hands-free) recording — lifting the finger must NOT stop it.
    if (lockedRef.current) {
      slideX.setValue(0);
      slideY.setValue(0);
      return;
    }
    resetMicGestureUi();
    slideX.setValue(0);
    slideY.setValue(0);
    if (slideCancelledRef.current) {
      setSlideCancelled(false);
      slideCancelledRef.current = false;
      void discardRecording();
      return;
    }
    void stopRecording();
  }, [slideX, slideY, resetMicGestureUi, discardRecording, stopRecording]);

  /** Trash button on the locked hands-free bar — discards without transcribing. */
  const onLockedCancel = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    resetMicGestureUi();
    void discardRecording();
  }, [resetMicGestureUi, discardRecording]);

  /** Checkmark button on the locked hands-free bar — finishes + transcribes. */
  const onLockedFinish = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    resetMicGestureUi();
    void stopRecording();
  }, [resetMicGestureUi, stopRecording]);

  // PanResponder for the WhatsApp slide-to-cancel / slide-up-to-lock gestures
  // on the mic button (native only — web uses a plain tap-toggle, see below).
  const micPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_: GestureResponderEvent, gs: PanResponderGestureState) =>
      Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
    onPanResponderGrant: () => {
      try { onMicPressIn(); } catch (err) { console.warn('fir mic press-in failed:', err); }
    },
    onPanResponderMove: (_: GestureResponderEvent, gs: PanResponderGestureState) => {
      // Once locked, the gesture is done — ignore any further finger movement.
      if (lockedRef.current) return;
      const { dx, dy } = gs;
      // A predominantly-upward drag locks the recording hands-free; a
      // predominantly-leftward drag cancels it — whichever axis the user is
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
      if (clampedX <= CANCEL_THRESHOLD && !slideCancelledRef.current) {
        slideCancelledRef.current = true;
        setSlideCancelled(true);
      } else if (clampedX > CANCEL_THRESHOLD && slideCancelledRef.current) {
        slideCancelledRef.current = false;
        setSlideCancelled(false);
      }
    },
    onPanResponderRelease: () => {
      try { onMicPressOut(); } catch (err) { console.warn('fir mic release failed:', err); }
    },
    onPanResponderTerminate: () => {
      try { onMicPressOut(); } catch (err) { console.warn('fir mic terminate failed:', err); }
    },
  }), [onMicPressIn, onMicPressOut, slideX, slideY]);

  // ── v3.3: Pause session — calls API ─────────────────────────────────────
  const handlePause = async () => {
    try {
      if (sessionId) {
        await fetch(`${API_BASE}/api/fir/session/${sessionId}/pause`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        // Keep session_id in AsyncStorage so user can resume
      }
    } catch { /* best effort */ }
    router.back();
  };

  // ── v3.3: Back navigation ─────────────────────────────────────────────────
  const handleBack = async () => {
    if (!sessionId || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/fir/session/${sessionId}/back`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        addMessage('bot', `↩ Going back...

${data.bot_message}`);
        setCurrentStage(data.stage || 'probe');
        setInputType(data.input_type || 'text');
        setQuickReplies(data.quick_replies || []);
        setSkipLabel(data.skip_label);
      }
    } catch { /* ignore */ }
    finally { setIsLoading(false); }
  };

  // ── Navigate to result ────────────────────────────────────────────────────
  useEffect(() => {
    if (draft) {
      const sid = sessionId;
      setTimeout(() => {
        router.push({
          pathname: '/fir-draft/result',
          params: { sessionId: sid || '' },
        });
      }, 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // ── TTS: stop any ongoing speech ──────────────────────────────────────────
  const stopTTS = useCallback(() => {
    if (autoSpeakTimerRef.current) clearTimeout(autoSpeakTimerRef.current);
    try { speakerRef.current?.stop(); } catch {}
    speakerRef.current = null;
    setSpeakingMsgId(null);
    setTtsLoadingMsgId(null);
    speakingIdRef.current = null;
    setPlaybackBlocked(false);
    setVoiceNotice(null);
  }, []);

  useFocusEffect(useCallback(() => () => {
    stopTTS();
    recordingRequestedRef.current = false;
    lockedRef.current = false; setLocked(false);
    slideCancelledRef.current = false; setSlideCancelled(false);
    if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
    micPulse.stopAnimation(); micPulse.setValue(1); setHoldElapsed(0);
    if (recordingActiveRef.current) {
      recordingActiveRef.current = false;
      setIsRecording(false);
      if (Platform.OS === 'web') {
        // Cleanup web MediaRecorder
        try { webRecorderRef.current?.stop(); } catch {}
        try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
        webRecorderRef.current = null;
        webStreamRef.current = null;
        webChunksRef.current = [];
      } else {
        void recorder.stop().catch(() => {});
      }
    }
  }, [recorder, stopTTS, micPulse]));

  // Keep forward-declared refs current
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);

  const speak = useCallback(async (msgId: string, text: string) => {
    if (speakingIdRef.current === msgId && speakerRef.current?.playbackBlocked) {
      speakerRef.current.retryPlayback();
      return;
    }
    // Toggle: tap again to stop
    if (speakingMsgId === msgId || ttsLoadingMsgId === msgId) { stopTTS(); return; }
    stopTTS();
    if (!text?.trim() || !token) return;

    speakingIdRef.current = msgId;
    setTtsLoadingMsgId(msgId);

    try {
      if (Platform.OS !== 'web') {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      }
    } catch {}

    if (speakingIdRef.current !== msgId) return;
    const speaker = new ChunkedSpeaker({
      apiBase: API_BASE,
      token,
      language: language || 'en',
      group: msgId,
      rate: 1.0,
      writeAudio: async (buf: ArrayBuffer, index: number) => {
        if (Platform.OS === 'web') {
          const blob = new Blob([buf], { type: 'audio/mpeg' });
          const url = (globalThis as any).URL.createObjectURL(blob);
          return { uri: url, cleanup: () => { try { (globalThis as any).URL.revokeObjectURL(url); } catch {} } };
        }
        // Native: write to cache file
        const arr = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < arr.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + CHUNK)) as any);
        }
        const g: any = globalThis;
        const b64 = g.btoa ? g.btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
        const file = new File(Paths.cache, `dhara-fir-tts-${msgId}-${index}.mp3`);
        try { file.delete(); } catch {}
        file.create();
        file.write(b64, { encoding: 'base64' });
        return { uri: file.uri, cleanup: () => { try { file.delete(); } catch {} } };
      },
      createPlayer: (uri: string) => {
        if (Platform.OS === 'web') {
          if (!browserAudioRef.current) browserAudioRef.current = new Audio();
          return createBrowserTtsPlayer(browserAudioRef.current, uri);
        }
        const player = createAudioPlayer({ uri });
        let disposed = false;
        let started = false; let finished = false; let onDone: (() => void) | null = null;
        let finishedBeforeSubscribe = false;
        const fireFinish = () => {
          if (finished) return; finished = true;
          if (onDone) onDone(); else finishedBeforeSubscribe = true;
        };
        const tryStart = () => {
          if (started || disposed) return; started = true;
          try { player.play(); } catch { setTimeout(() => { if (!disposed) { try { player.play(); } catch {} } }, 150); }
        };
        try {
          (player as any).addListener?.('playbackStatusUpdate', (st: any) => {
            if (!started && st?.isLoaded) tryStart();
            if (st?.didJustFinish || (st?.duration > 0 && st?.currentTime >= st?.duration - 0.05)) fireFinish();
          });
        } catch {}
        if ((player as any).isLoaded) tryStart();
        const startGuard = setTimeout(() => { if (!started) tryStart(); }, 2500);
        const guard = setTimeout(fireFinish, 90_000);
        return {
          play: () => tryStart(),
          remove: () => { disposed = true; clearTimeout(startGuard); clearTimeout(guard); try { player.pause(); } catch {} try { player.remove(); } catch {} },
          setPlaybackRate: (r: number) => { try { player.setPlaybackRate(r); } catch {} },
          onFinish: (cb: () => void) => {
            onDone = cb;
            if (finishedBeforeSubscribe) setTimeout(cb, 0);
          },
        };
      },
      onSpeakingChange: (speaking: boolean) => {
        if (speaking && speakingIdRef.current === msgId) {
          setSpeakingMsgId(msgId);
          setTtsLoadingMsgId(null);
          setPlaybackBlocked(false);
          setVoiceNotice(null);
        }
        if (!speaking && speakingIdRef.current === msgId) {
          setSpeakingMsgId(null);
          setTtsLoadingMsgId(null);
          speakingIdRef.current = null;
        }
      },
      onPlaybackBlocked: () => {
        if (speakerRef.current !== speaker) return;
        setSpeakingMsgId(null);
        setTtsLoadingMsgId(null);
        setPlaybackBlocked(true);
        setVoiceNotice('Your browser paused audio. Tap Play voice to listen, or continue with text. Your complaint is unaffected.');
      },
      onError: (message: string) => {
        if (speakerRef.current !== speaker) return;
        setSpeakingMsgId(null);
        setTtsLoadingMsgId(null);
        setPlaybackBlocked(false);
        setVoiceNotice(message.includes('429') ? 'The daily voice limit has been reached. You can still continue with text.' : 'Voice is unavailable right now. You can continue with text and try listening again later.');
      },
    });
    speakerRef.current = speaker;
    speaker.end(text);
  }, [speakingMsgId, ttsLoadingMsgId, stopTTS, token, language]);

  // ── Selected language ──────────────────────────────────────────────────────
  const selectedLang = FIR_LANGUAGES.find(l => l.code === language) || FIR_LANGUAGES[0];
  // Keep speakRef in sync for use inside applyTurn callback
  useEffect(() => { speakRef.current = speak; }, [speak]);

  // ─────────────────────────────────────────────────────────────────────────
  // PRE-SESSION: Language picker + Start button
  // ─────────────────────────────────────────────────────────────────────────
  if (!sessionStarted) {
    if (checkingResume) {
      return (
        <SafeAreaView style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size="large" color={NAVY} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView testID="fir-start-screen" style={styles.root}>
        <View style={styles.preHeader}>
          <Pressable testID="fir-start-back" onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={NAVY} />
          </Pressable>
          <Text style={styles.preTitle}>FIR Draft Assistant</Text>
        </View>
        <MarqueeBanner variant="light" />
        <ScrollView contentContainerStyle={styles.preBody}>
          {resumeError ? <Text testID="fir-resume-error" accessibilityRole="alert" style={{ color: theme.colors.error, lineHeight: 22 }}>{resumeError}</Text> : null}
          {/* v3.3: Resume banner */}
          {savedSessionId && (
            <Pressable testID="fir-resume-saved" style={styles.resumeCard} onPress={() => resumeSession(savedSessionId)}>
              <Ionicons name="refresh-circle-outline" size={24} color={GOLD} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.resumeTitle}>Continue your complaint</Text>
                <Text style={styles.resumeSubtitle}>You have an unfinished session. Tap to resume.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={MUTED} />
            </Pressable>
          )}

          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeIcon}>⚖️</Text>
            <Text style={styles.welcomeTitle}>Prepare your FIR draft</Text>
            <Text style={styles.welcomeSubtitle}>
              I will guide you step by step through a conversation to prepare a
              formal complaint letter ready to present at the police station.
            </Text>
            <View style={styles.welcomeFeatures}>
              {['Bilingual draft (English + your language)', 'GPS-pinned incident location', 'Evidence attachment support', 'BNS section suggestions'].map((f) => (
                <View key={f} style={styles.featureRow}>
                  <Text style={styles.featureDot}>✓</Text>
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── Incident Module Picker ────────────────────────────────── */}
          <Text style={styles.langLabel}>What happened?</Text>
          <View style={styles.moduleGrid}>
            {INCIDENT_MODULES.map(mod => {
              const isSelected = selectedModule === mod.key;
              return (
                <Pressable
                  key={mod.key}
                  testID={`module-${mod.key}`}
                  style={[styles.moduleCard, isSelected && { borderColor: mod.color, borderWidth: 2.5, backgroundColor: `${mod.color}12` }]}
                  onPress={() => setSelectedModule(isSelected ? null : mod.key)}
                >
                  <View style={[styles.moduleEmojiBadge, { backgroundColor: `${mod.color}18` }]}>
                    <Text style={styles.moduleEmoji}>{mod.emoji}</Text>
                  </View>
                  <View style={styles.moduleInfo}>
                    <Text style={[styles.moduleLabel, isSelected && { color: mod.color }]} numberOfLines={1}>{mod.label}</Text>
                    <Text style={styles.moduleSub} numberOfLines={1}>{mod.sublabel}</Text>
                    <Text style={[styles.moduleBns, { color: mod.color }]} numberOfLines={1}>{mod.bns}</Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={18} color={mod.color} style={styles.moduleCheck} />
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Language picker */}
          <Text style={styles.langLabel}>Draft language</Text>
          <View style={styles.langRow}>
            {FIR_LANGUAGES.map(l => (
              <Pressable
                key={l.code}
                style={[styles.langChip, language === l.code && styles.langChipActive]}
                onPress={() => saveLanguage(l.code)}
              >
                <Text style={[styles.langChipText, language === l.code && styles.langChipTextActive]}>
                  {l.native}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Disclaimer */}
          <View style={styles.disclaimer}>
            <Ionicons name="information-circle-outline" size={16} color={MUTED} />
            <Text style={styles.disclaimerText}>
              This produces a citizen draft for reference only — NOT a registered FIR.
              Present it at the police station for official registration.
            </Text>
          </View>

          {/* Start button */}
          <Pressable testID="fir-start-complaint" style={styles.startBtn} onPress={startSession}>
            {selectedModule && selectedModule !== 'other' ? (
              <Text style={styles.startBtnText}>
                {`Start ${INCIDENT_MODULES.find(m => m.key === selectedModule)?.label ?? ''} Complaint`}
              </Text>
            ) : (
              <Text style={styles.startBtnText}>{savedSessionId ? 'Start New Complaint' : 'Start My Complaint'}</Text>
            )}
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION ACTIVE: Chat UI
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      {/* v3.3: Emergency overlay */}
      {showEmergencyScreen && (
        <EmergencyOverlay
          numbers={emergencyNumbers}
          onContinue={() => {
            setShowEmergencyScreen(false);
            // If still in safety_gate, advance to narrative
            if (currentStage === 'safety_gate') {
              sendTurn(undefined, undefined, 'continue_safe');
            }
          }}
          onExit={() => {
            setShowEmergencyScreen(false);
            handlePause();
          }}
        />
      )}

      {/* Header */}
      <View style={styles.headerShell} testID="fir-chat-header">
      <View style={styles.chatHeader}>
        <Pressable testID="fir-header-back" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={SURFACE} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text testID="fir-header-title" style={styles.headerTitle}>FIR Draft Assistant</Text>
          <Text style={styles.headerLang}>{selectedLang.native}</Text>
        </View>
        {/* TTS auto-speak toggle */}
        <Pressable
          testID="fir-auto-speak-toggle"
          accessibilityLabel={autoSpeak ? 'Turn automatic voice off' : 'Turn automatic voice on'}
          accessibilityState={{ checked: autoSpeak }}
          onPress={() => { setAutoSpeak(p => !p); if (autoSpeak) stopTTS(); }}
          style={styles.pauseBtn}
        >
          <Ionicons
            name={autoSpeak ? 'volume-high-outline' : 'volume-mute-outline'}
            size={20}
            color={autoSpeak ? GOLD : MUTED}
          />
        </Pressable>
        <Pressable testID="fir-save-pause" accessibilityLabel="Save and continue later" onPress={handlePause} style={styles.pauseBtn}>
          <Ionicons name="bookmark-outline" size={20} color={GOLD} />
        </Pressable>
      </View>
      {(currentStage === 'probe' || suggestedSections.length > 0) && (
        <View style={styles.headerActions} testID="fir-header-actions">
          {probeTotal > 0 && currentStage === 'probe' && (
            <View style={styles.progressChip} testID="fir-probe-progress">
              <Text style={styles.progressText}>Q {probeCurrentNum}/{probeTotal}</Text>
            </View>
          )}
          {currentStage === 'probe' && (
            <Pressable testID="fir-previous-question" accessibilityLabel="Previous question" onPress={handleBack} style={styles.pauseBtn}>
              <Ionicons name="arrow-undo-outline" size={20} color={GOLD} />
            </Pressable>
          )}
          {suggestedSections.length > 0 && (
            <Pressable testID="fir-sections-button" accessibilityLabel="Suggested sections" onPress={() => setShowSectionDrawer(true)} style={styles.pauseBtn}>
              <Ionicons name="list-outline" size={22} color={GOLD} />
            </Pressable>
          )}
        </View>
      )}
      </View>
      {/* Scrolling verified-sources ticker */}
      <MarqueeBanner variant="dark" />
      {voiceNotice && (
        <VoiceNotice testID="fir-voice-notice" message={voiceNotice}
          onPlay={playbackBlocked ? () => speakerRef.current?.retryPlayback() : undefined}
          onDismiss={() => { if (playbackBlocked) { setAutoSpeak(false); stopTTS(); } setVoiceNotice(null); }} />
      )}

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.map(msg => (
            <View
              key={msg.id}
              onLayout={(e) => { messageYsRef.current[msg.id] = e.nativeEvent.layout.y; }}
            >
              <MessageBubble
                role={msg.role}
                text={msg.text}
                msgId={msg.id}
                onSpeak={speak}
                isSpeaking={speakingMsgId === msg.id}
                isTtsLoading={ttsLoadingMsgId === msg.id}
              />
            </View>
          ))}
          {isLoading && <TypingIndicator />}
          {/* v3.3: Save & Continue Later link */}
          {sessionId && !isLoading && inputType !== 'done' && (
            <Pressable style={styles.saveLaterRow} onPress={handlePause}>
              <Text style={styles.saveLaterText}>Save & continue later</Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Input Area */}
        {!isLoading && sessionId && (
          <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            {inputType === 'quick_reply' && (
              <QuickReplyChips
                replies={quickReplies}
                skipLabel={skipLabel}
                currentStage={currentStage}
                onSelect={(reply) => {
                  const lc = reply.toLowerCase();
                  // v3.3: Safety gate button detection
                  if (currentStage === 'safety_gate' && (lc.includes('no') || lc.includes('need help'))) {
                    sendTurn(undefined, undefined, 'not_safe');
                  } else if (lc.includes("safe now") && lc.includes("continue")) {
                    setShowEmergencyScreen(false);
                    sendTurn(undefined, undefined, 'continue_safe');
                  } else if (lc.includes('exit for now')) {
                    handlePause();
                  } else {
                    sendTurn(reply);
                  }
                }}
                onSkip={() => sendTurn(skipLabel || 'Skip')}
              />
            )}

            {(inputType === 'text' || inputType === 'voice_or_text') && (
              <TextInputArea
                value={textInput}
                onChange={setTextInput}
                onSend={(t) => { if (t.trim()) sendTurn(t.trim()); }}
                onSkip={skipLabel ? () => sendTurn(undefined, undefined, 'skip') : undefined}
                skipLabel={skipLabel}
                showVoice={inputType === 'voice_or_text'}
                isRecording={isRecording}
                transcribing={transcribing}
                onStartRecord={onMicPressIn}
                onStopRecord={onMicPressOut}
                onAttach={handlePickEvidence}
                attachedFiles={evidenceFiles}
                onRemoveAttach={handleRemoveEvidence}
                onCaptionChange={handleCaptionChange}
                locked={locked}
                slideCancelled={slideCancelled}
                slideX={slideX}
                slideY={slideY}
                micPulse={micPulse}
                waveBars={waveBars}
                holdElapsed={holdElapsed}
                onLockedCancel={onLockedCancel}
                onLockedFinish={onLockedFinish}
                micPanHandlers={micPanResponder.panHandlers}
              />
            )}

            {inputType === 'gps' && gpsAvailable && (
              <GPSWidget
                onGetGPS={handleGetGPS}
                onSkip={() => sendTurn(undefined, undefined, 'skip')}
                skipLabel={skipLabel}
              />
            )}

            {inputType === 'gps' && !gpsAvailable && (
              /* Web fallback: typed place input when GPS is unavailable */
              <TextInputArea
                value={textInput}
                onChange={setTextInput}
                onSend={(t) => { if (t.trim()) sendTurn(t.trim()); }}
                onSkip={skipLabel ? () => sendTurn(undefined, undefined, 'skip') : undefined}
                skipLabel={skipLabel}
                showVoice={false}
                isRecording={false}
                transcribing={false}
                onStartRecord={() => {}}
                onStopRecord={() => {}}
                onAttach={handlePickEvidence}
                attachedFiles={evidenceFiles}
                onRemoveAttach={handleRemoveEvidence}
              />
            )}

            {inputType === 'evidence' && (
              <EvidenceWidget
                files={evidenceFiles}
                uploading={uploadingEvidence}
                onPick={handlePickEvidence}
                onDone={() => sendTurn(undefined, undefined, 'upload_done')}
                onSkip={() => sendTurn(undefined, undefined, 'skip')}
                skipLabel={skipLabel}
                onRemove={handleRemoveEvidence}
                onCaptionChange={handleCaptionChange}
              />
            )}

            {inputType === 'confirm' && (
              <ConfirmButtons
                confirmLabel={quickReplies[0] || 'Yes, proceed'}
                cancelLabel={quickReplies[1] || 'Go back'}
                onConfirm={() => sendTurn(quickReplies[0] || 'Yes')}
                onCancel={() => sendTurn(quickReplies[1] || 'No')}
              />
            )}

            {inputType === 'done' && (
              <Pressable
                style={styles.viewDraftBtn}
                onPress={() => router.push({
                  pathname: '/fir-draft/result',
                  params: { sessionId: sessionId || '' },
                })}
              >
                <Ionicons name="document-text-outline" size={22} color="#fff" />
                <Text style={styles.viewDraftBtnText}>View Your FIR Draft</Text>
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Issue 9: Section Drawer */}
      <FirSectionDrawer
        visible={showSectionDrawer}
        onClose={() => setShowSectionDrawer(false)}
        suggestedSections={suggestedSections}
        droppedSections={droppedSections}
        onJump={() => {
          if (sectionMsgId && messageYsRef.current[sectionMsgId] !== undefined) {
            scrollRef.current?.scrollTo({ y: Math.max(0, messageYsRef.current[sectionMsgId] - 20), animated: true });
          }
          setShowSectionDrawer(false);
        }}
      />
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageBubble({
  role, text, msgId, onSpeak, isSpeaking, isTtsLoading,
}: {
  role: 'bot' | 'user'; text: string;
  msgId?: string;
  onSpeak?: (id: string, text: string) => void;
  isSpeaking?: boolean;
  isTtsLoading?: boolean;
}) {
  const isBot = role === 'bot';
  return (
    <View style={[styles.bubbleWrap, isBot ? styles.bubbleWrapBot : styles.bubbleWrapUser]}>
      {isBot && (
        <View style={styles.botAvatar}>
          <Text style={styles.botAvatarText}>⚖</Text>
        </View>
      )}
      <View style={{ flex: 1, maxWidth: '85%' }}>
        <View style={[styles.bubble, isBot ? styles.bubbleBot : styles.bubbleUser]}>
          <Text style={[styles.bubbleText, isBot ? styles.bubbleTextBot : styles.bubbleTextUser]}>
            {text}
          </Text>
        </View>
        {/* TTS speaker button on bot messages */}
        {isBot && msgId && onSpeak && (
          <Pressable
            testID={`fir-listen-${msgId}`}
            onPress={() => onSpeak(msgId, text)}
            style={styles.ttsBubbleBtn}
            hitSlop={8}
          >
            {isTtsLoading ? (
              <ActivityIndicator size="small" color={GOLD} />
            ) : (
              <Ionicons
                name={isSpeaking ? 'stop-circle-outline' : 'volume-medium-outline'}
                size={16}
                color={isSpeaking ? GOLD : MUTED}
              />
            )}
            <Text style={[styles.ttsBubbleBtnText, isSpeaking && { color: GOLD }]}>
              {isSpeaking ? 'Stop' : 'Listen'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function TypingIndicator() {
  return (
    <View style={[styles.bubbleWrap, styles.bubbleWrapBot]}>
      <View style={styles.botAvatar}>
        <Text style={styles.botAvatarText}>⚖</Text>
      </View>
      <View style={[styles.bubble, styles.bubbleBot, { paddingVertical: 10, paddingHorizontal: 16 }]}>
        <ActivityIndicator size="small" color={GOLD} />
      </View>
    </View>
  );
}

function QuickReplyChips({
  replies, skipLabel, onSelect, onSkip, currentStage,
}: { replies: string[]; skipLabel?: string; onSelect: (r: string) => void; onSkip: () => void; currentStage?: string }) {
  return (
    <View style={styles.chipsWrap}>
      {replies.map(r => {
        const isNoBtn = currentStage === 'safety_gate' && (r.toLowerCase().includes('no') || r.toLowerCase().includes('need help'));
        return (
          <Pressable
            key={r}
            style={[styles.chip, isNoBtn && styles.chipDanger]}
            onPress={() => onSelect(r)}
          >
            <Text style={[styles.chipText, isNoBtn && styles.chipTextDanger]}>{r}</Text>
          </Pressable>
        );
      })}
      {!!skipLabel && (
        <Pressable style={[styles.chip, styles.chipSkip]} onPress={onSkip}>
          <Text style={[styles.chipText, styles.chipTextSkip]}>{skipLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function TextInputArea({
  value, onChange, onSend, onSkip, skipLabel, showVoice,
  isRecording, transcribing, onStartRecord, onStopRecord,
  onAttach, attachedFiles, onRemoveAttach, onCaptionChange,
  locked, slideCancelled, slideX, slideY, micPulse, waveBars, holdElapsed,
  onLockedCancel, onLockedFinish, micPanHandlers,
}: {
  value: string; onChange: (v: string) => void; onSend: (v: string) => void;
  onSkip?: () => void; skipLabel?: string;
  showVoice: boolean; isRecording: boolean; transcribing: boolean;
  onStartRecord: () => void; onStopRecord: () => void;
  onAttach?: () => void;
  attachedFiles?: UploadedFile[];
  onRemoveAttach?: (fileId: string) => void;
  onCaptionChange?: (fileId: string, caption: string) => void;
  locked?: boolean;
  slideCancelled?: boolean;
  slideX?: Animated.Value;
  slideY?: Animated.Value;
  micPulse?: Animated.Value;
  waveBars?: Animated.Value[];
  holdElapsed?: number;
  onLockedCancel?: () => void;
  onLockedFinish?: () => void;
  micPanHandlers?: any;
}) {
  // Hands-free locked recording bar — replaces the composer entirely, same
  // as the Home screen. The user dragged the mic up and released; recording
  // keeps going until they tap trash (discard) or the checkmark (finish).
  if (locked && isRecording) {
    return (
      <View style={styles.lockedBar} testID="fir-locked-rec-bar">
        <View style={styles.recLeft}>
          <Animated.View style={[styles.recDot, { transform: [{ scale: micPulse || 1 }] }]} />
          <Text style={styles.recTimer}>
            {String(Math.floor((holdElapsed || 0) / 60)).padStart(2, '0')}:
            {String((holdElapsed || 0) % 60).padStart(2, '0')}
          </Text>
        </View>
        {!!waveBars && (
          <View style={styles.waveformRow} testID="fir-voice-waveform">
            {waveBars.map((bar, i) => (
              <Animated.View
                key={i}
                style={[styles.waveBar, { height: bar.interpolate({ inputRange: [0, 1], outputRange: [4, 22] }) }]}
              />
            ))}
          </View>
        )}
        <Pressable testID="fir-locked-cancel-btn" style={styles.lockedIconBtn} onPress={onLockedCancel} hitSlop={10}>
          <Ionicons name="trash-outline" size={20} color={RED} />
        </Pressable>
        <Pressable testID="fir-locked-finish-btn" style={styles.lockedSendBtn} onPress={onLockedFinish} hitSlop={10}>
          <Ionicons name="checkmark" size={22} color={SURFACE} />
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      {/* ── Attachment thumbnail strip (visible when files attached during text probes) */}
      {attachedFiles && attachedFiles.length > 0 && !isRecording && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.attachStrip}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}
        >
          {attachedFiles.map(f => {
            const isImg = f.file_type === 'image' || (f.content_type || '').startsWith('image/');
            const isVid = f.file_type === 'video' || (f.content_type || '').startsWith('video/');
            return (
              <View key={f.file_id} style={styles.attachChip}>
                {isImg && f.local_uri ? (
                  <Image source={{ uri: f.local_uri }} style={styles.attachThumb} resizeMode="cover" />
                ) : (
                  <View style={styles.attachThumb}>
                    <Ionicons
                      name={isVid ? 'videocam' : 'document-text'}
                      size={18} color={NAVY}
                    />
                  </View>
                )}
                <Text style={styles.attachChipName} numberOfLines={1}>{f.filename}</Text>
                {onRemoveAttach && (
                  <Pressable onPress={() => onRemoveAttach(f.file_id)} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={RED} />
                  </Pressable>
                )}
              </View>
            );
          })}
          {/* Add more button */}
          {onAttach && (
            <Pressable style={styles.attachAddBtn} onPress={onAttach}>
              <Ionicons name="add" size={18} color={NAVY} />
            </Pressable>
          )}
        </ScrollView>
      )}

      <View style={[styles.textRow, isRecording && styles.textRowRecording]}>
        {isRecording ? (
          <>
            {/* Timer + red dot + live waveform on the left */}
            <View style={styles.recLeft}>
              <Animated.View style={[styles.recDot, { transform: [{ scale: micPulse || 1 }] }]} />
              <Text style={styles.recTimer}>
                {String(Math.floor((holdElapsed || 0) / 60)).padStart(2, '0')}:
                {String((holdElapsed || 0) % 60).padStart(2, '0')}
              </Text>
              {!!waveBars && (
                <View style={styles.waveformInline} testID="fir-voice-waveform">
                  {waveBars.map((bar, i) => (
                    <Animated.View
                      key={i}
                      style={[styles.waveBar, { height: bar.interpolate({ inputRange: [0, 1], outputRange: [4, 18] }) }]}
                    />
                  ))}
                </View>
              )}
            </View>

            {/* Slide to cancel indicator */}
            <Animated.View style={[
              styles.recCenter,
              {
                opacity: slideX ? slideX.interpolate({
                  inputRange: [-160, -40, 0],
                  outputRange: [0.2, 0.7, 1],
                  extrapolate: 'clamp',
                }) : 1,
              },
            ]}>
              {slideCancelled ? (
                <View style={styles.cancelActive}>
                  <Ionicons name="trash" size={18} color={RED} />
                  <Text style={styles.cancelActiveText}>Release to cancel</Text>
                </View>
              ) : (
                <View style={styles.slideHint}>
                  <Ionicons name="chevron-back" size={14} color={MUTED} />
                  <Text style={styles.slideHintText}>
                    {Platform.OS === 'web' ? 'Tap mic to stop & send' : 'Slide to cancel'}
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Lock affordance — drag the mic straight up into this pill to
                keep recording hands-free, exactly like WhatsApp. Native only. */}
            {Platform.OS !== 'web' && !!slideY && (
              <Animated.View
                testID="fir-lock-hint"
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
                <Ionicons name="lock-closed" size={13} color={NAVY} />
                <Ionicons name="chevron-up" size={12} color={NAVY} />
              </Animated.View>
            )}
          </>
        ) : (
          <>
            {/* Paperclip attach button */}
            {onAttach && (
              <Pressable
                testID="fir-attach-evidence"
                accessibilityLabel="Attach evidence"
                style={styles.attachBtn}
                onPress={onAttach}
                hitSlop={8}
              >
                <Ionicons name="attach" size={22} color={MUTED} />
                {attachedFiles && attachedFiles.length > 0 && (
                  <View style={styles.attachBadge}>
                    <Text style={styles.attachBadgeText}>{attachedFiles.length}</Text>
                  </View>
                )}
              </Pressable>
            )}
            <TextInput
              testID="fir-text-input"
              style={styles.textBox}
              value={value}
              onChangeText={onChange}
              placeholder="Type your response here…"
              placeholderTextColor={MUTED}
              multiline
              maxLength={2000}
            />
          </>
        )}

        {showVoice && (
          Platform.OS === 'web' ? (
            // Web: click to start / click again to stop (more natural for desktop)
            <Pressable
              testID="fir-mic-button"
              accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
              style={[styles.micBtn, isRecording && styles.micBtnActive]}
              disabled={transcribing}
              onPress={isRecording ? onStopRecord : onStartRecord}
            >
              {transcribing
                ? <ActivityIndicator size="small" color={SURFACE} />
                : <Ionicons name={isRecording ? 'stop-circle' : 'mic-outline'} size={22} color={SURFACE} />}
            </Pressable>
          ) : (
            // Native: WhatsApp-style press-and-hold with slide-to-cancel /
            // slide-up-to-lock, driven by the parent's PanResponder.
            <Animated.View
              testID="fir-mic-button"
              accessibilityLabel="Hold to record your answer"
              style={[
                styles.micBtn,
                isRecording && styles.micBtnActive,
                isRecording && {
                  transform: [
                    { translateX: slideX || 0 },
                    { translateY: slideY || 0 },
                    { scale: micPulse || 1 },
                  ],
                },
                isRecording && slideCancelled && { backgroundColor: RED },
              ]}
              {...(micPanHandlers || {})}
            >
              {transcribing
                ? <ActivityIndicator size="small" color={SURFACE} />
                : <Ionicons name={isRecording ? (slideCancelled ? 'trash' : 'mic') : 'mic-outline'} size={22} color={SURFACE} />}
            </Animated.View>
          )
        )}
        {!isRecording && (
          <Pressable
            testID="fir-send-btn"
            style={[styles.sendBtn, !value.trim() && styles.sendBtnDisabled]}
            onPress={() => onSend(value)}
            disabled={!value.trim()}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        )}
      </View>
      {onSkip && !!skipLabel && !isRecording && (
        <Pressable style={styles.skipRow} onPress={onSkip}>
          <Text style={styles.skipText}>{skipLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function GPSWidget({
  onGetGPS, onSkip, skipLabel,
}: { onGetGPS: () => void; onSkip: () => void; skipLabel?: string }) {
  return (
    <View style={styles.widgetWrap}>
      <Text style={styles.widgetHint}>
        Your precise GPS location helps police identify the exact spot
      </Text>
      <Pressable style={styles.gpsBtn} onPress={onGetGPS}>
        <Ionicons name="location" size={22} color="#fff" />
        <Text style={styles.gpsBtnText}>Get GPS Location</Text>
      </Pressable>
      <Pressable style={styles.skipRow} onPress={onSkip}>
        <Text style={styles.skipText}>{skipLabel || 'No, text description is enough'}</Text>
      </Pressable>
    </View>
  );
}

function EvidenceWidget({
  files, uploading, onPick, onDone, onSkip, skipLabel, onRemove, onCaptionChange,
}: {
  files: UploadedFile[]; uploading: boolean;
  onPick: () => void; onDone: () => void; onSkip: () => void;
  skipLabel?: string;
  onRemove?: (fileId: string) => void;
  onCaptionChange?: (fileId: string, caption: string) => void;
}) {
  return (
    <View style={styles.widgetWrap}>
      {files.length > 0 && (
        <View style={styles.evidenceList}>
          {files.map(f => {
            const isImage = f.file_type === 'image' || (f.content_type || '').startsWith('image/');
            const isVideo = f.file_type === 'video' || (f.content_type || '').startsWith('video/');
            return (
              <View key={f.file_id} style={styles.evidenceItemWrap}>
                <View style={styles.evidenceItem}>
                  {/* Thumbnail */}
                  {isImage && f.local_uri ? (
                    <Image
                      source={{ uri: f.local_uri }}
                      style={styles.evidenceThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <Ionicons
                      name={isImage ? 'image-outline' : isVideo ? 'videocam-outline' : 'document-outline'}
                      size={20} color={NAVY}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text style={styles.evidenceItemText} numberOfLines={1}>{f.filename}</Text>
                  {/* × remove button */}
                  {onRemove && (
                    <Pressable
                      onPress={() => onRemove(f.file_id)}
                      style={styles.evidenceRemoveBtn}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={18} color={RED} />
                    </Pressable>
                  )}
                </View>
                {/* Issue 17: Caption input */}
                {onCaptionChange && (
                  <TextInput
                    style={styles.captionInput}
                    value={f.caption || ''}
                    onChangeText={(text) => onCaptionChange(f.file_id, text)}
                    placeholder="Add a caption (e.g. broken window at entry)"
                    placeholderTextColor={MUTED}
                    returnKeyType="done"
                    maxLength={200}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}
      <View style={styles.evidenceBtns}>
        <Pressable
          style={[styles.evidenceAddBtn, uploading && { opacity: 0.6 }]}
          onPress={onPick}
          disabled={uploading}
        >
          {uploading
            ? <ActivityIndicator size="small" color={NAVY} />
            : <Ionicons name="attach" size={20} color={NAVY} />}
          <Text style={styles.evidenceAddText}>
            {uploading ? 'Uploading…' : `Add Files${files.length > 0 ? ` (${files.length})` : ''}`}
          </Text>
        </Pressable>
        {files.length > 0 && (
          <Pressable style={styles.evidenceDoneBtn} onPress={onDone}>
            <Text style={styles.evidenceDoneText}>Done ({files.length})</Text>
          </Pressable>
        )}
      </View>
      <Pressable style={styles.skipRow} onPress={onSkip}>
        <Text style={styles.skipText}>{skipLabel || 'No evidence to upload'}</Text>
      </Pressable>
    </View>
  );
}

function ConfirmButtons({
  confirmLabel, cancelLabel, onConfirm, onCancel,
}: { confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <View style={styles.confirmWrap}>
      <Pressable style={styles.confirmYes} onPress={onConfirm}>
        <Text style={styles.confirmYesText}>{confirmLabel}</Text>
      </Pressable>
      <Pressable style={styles.confirmNo} onPress={onCancel}>
        <Text style={styles.confirmNoText}>{cancelLabel}</Text>
      </Pressable>
    </View>
  );
}

// ── Emergency Overlay (v3.3) ─────────────────────────────────────────────────
function EmergencyOverlay({
  numbers, onContinue, onExit,
}: { numbers: Array<{label: string; number: string}>; onContinue: () => void; onExit: () => void }) {
  const handleCall = (num: string) => {
    Linking.openURL(`tel:${num}`).catch(() =>
      Alert.alert('Cannot call', `Please manually dial ${num}`)
    );
  };
  return (
    <View style={eStyles.overlay}>
      <View style={eStyles.card}>
        <Text style={eStyles.title}>⚠️ Emergency Numbers</Text>
        <Text style={eStyles.subtitle}>
          If you are in immediate danger, please call for help first.
        </Text>
        {numbers.map(n => (
          <Pressable key={n.number} style={eStyles.callBtn} onPress={() => handleCall(n.number)}>
            <Ionicons name="call" size={22} color="#fff" />
            <View style={{ marginLeft: 10 }}>
              <Text style={eStyles.callLabel}>{n.label}</Text>
              <Text style={eStyles.callNum}>{n.number}</Text>
            </View>
          </Pressable>
        ))}
        <Pressable style={eStyles.continueBtn} onPress={onContinue}>
          <Text style={eStyles.continueBtnText}>{"I'm safe now \u2014 continue filing"}</Text>
        </Pressable>
        <Pressable style={eStyles.exitBtn} onPress={onExit}>
          <Text style={eStyles.exitBtnText}>Exit for now (session saved)</Text>
        </Pressable>
      </View>
    </View>
  );
}

const eStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#B91C1C', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#374151', marginBottom: 16, textAlign: 'center', lineHeight: 20 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#B91C1C', borderRadius: 10,
    padding: 14, marginBottom: 10,
  },
  callLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  callNum: { color: '#fecaca', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  continueBtn: {
    backgroundColor: theme.colors.primary, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  continueBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  exitBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  exitBtnText: { color: '#6B7280', fontSize: 14 },
});

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SURFACE },
  flex1: { flex: 1 },

  // Pre-session
  preHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  preTitle: { fontSize: 17, fontWeight: '700', color: NAVY, marginLeft: 12 },
  preBody: { padding: 20, paddingBottom: 40 },
  welcomeCard: {
    backgroundColor: CREAM, borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 24,
  },
  welcomeIcon: { fontSize: 40, marginBottom: 12 },
  welcomeTitle: { fontSize: 20, fontWeight: '700', color: NAVY, textAlign: 'center', marginBottom: 8 },
  welcomeSubtitle: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  welcomeFeatures: { width: '100%', gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureDot: { fontSize: 14, color: GREEN, fontWeight: '700', width: 16 },
  featureText: { fontSize: 13, color: NAVY, flex: 1 },
  langLabel: { fontSize: 14, fontWeight: '600', color: NAVY, marginBottom: 10 },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  langChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  langChipActive: { backgroundColor: NAVY, borderColor: NAVY },
  langChipText: { fontSize: 13, color: MUTED, fontWeight: '500' },
  langChipTextActive: { color: '#fff' },
  // ── Module grid ────────────────────────────────────────────────────────────
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },
  moduleCard: {
    width: '47.5%', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1.5,
    borderColor: BORDER, paddingVertical: 10, paddingHorizontal: 10, minHeight: 66,
  },
  moduleEmojiBadge: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  moduleEmoji: { fontSize: 20 },
  moduleInfo: { flex: 1, minWidth: 0 },
  moduleLabel: { fontSize: 12.5, fontWeight: '700', color: NAVY, lineHeight: 17 },
  moduleSub: { fontSize: 10.5, color: MUTED, marginTop: 1, lineHeight: 14 },
  moduleBns: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  moduleCheck: { position: 'absolute', top: 6, right: 6 },
  disclaimer: {
    flexDirection: 'row', gap: 8, backgroundColor: '#F0F4FF',
    borderRadius: 10, padding: 12, marginBottom: 24,
  },
  disclaimerText: { fontSize: 12, color: MUTED, flex: 1, lineHeight: 17 },
  startBtn: {
    backgroundColor: NAVY, borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Chat header
  headerShell: { backgroundColor: theme.dhara.navy, flexShrink: 0 },
  chatHeader: {
    backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8, gap: 4,
  },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  headerLang: { fontSize: 12, color: GOLD },
  backBtn: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pauseBtn: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // v3.4: Probe progress chip in header
  progressChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(211,182,117,0.5)',
  },
  progressText: { fontSize: 12, color: GOLD, fontWeight: '700', letterSpacing: 0.5 },

  // Messages
  messageList: { flex: 1, backgroundColor: '#F7F5F0' },
  messageListContent: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8, gap: 12 },
  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleWrapBot: { justifyContent: 'flex-start' },
  bubbleWrapUser: { justifyContent: 'flex-end' },
  botAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  botAvatarText: { fontSize: 14 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleBot: { backgroundColor: NAVY, borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: CREAM, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextBot: { color: '#fff' },
  bubbleTextUser: { color: NAVY },

  // Input area
  inputArea: {
    backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER,
    paddingHorizontal: 12, paddingTop: 10,
  },

  // Quick reply chips
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  chip: {
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: NAVY, borderWidth: 0,
  },
  chipSkip: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: BORDER },
  chipText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  chipTextSkip: { color: MUTED },

  // Text input
  textRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4 },
  textRowRecording: { alignItems: 'center', minHeight: 56 },
  textBox: {
    flex: 1, borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: NAVY,
    maxHeight: 120, backgroundColor: SURFACE,
  },
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center',
  },
  micBtnActive: { backgroundColor: RED },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: BORDER },
  skipRow: { alignItems: 'center', paddingVertical: 8 },
  skipText: { fontSize: 13, color: MUTED, textDecorationLine: 'underline' },

  // WhatsApp-style mic gesture — hands-free locked recording bar (replaces
  // the composer entirely once the user drags the mic up and releases).
  lockedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, minHeight: 56,
  },
  lockedIconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  lockedSendBtn: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center', backgroundColor: NAVY,
  },
  // Live "is listening" waveform — plain Animated bars, matches Home.
  waveformRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 4, height: 24,
  },
  waveBar: { width: 4, borderRadius: 2, backgroundColor: RED },
  waveformInline: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20 },
  // Floating "slide up to lock" pill above the mic button
  lockHint: {
    position: 'absolute', right: 2, bottom: 54,
    flexDirection: 'column', alignItems: 'center', gap: 2,
    backgroundColor: SURFACE, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 8,
    borderWidth: 1, borderColor: BORDER,
  },
  recLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 90 },
  recDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: RED },
  recTimer: {
    fontVariant: ['tabular-nums'], fontWeight: '700', fontSize: 14,
    color: RED, minWidth: 40,
  },
  recCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  slideHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  slideHintText: { color: MUTED, fontSize: 12, fontWeight: '500' },
  cancelActive: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelActiveText: { color: RED, fontSize: 13, fontWeight: '700' },

  // GPS widget
  widgetWrap: { paddingBottom: 4, gap: 8 },
  widgetHint: { fontSize: 12, color: MUTED, textAlign: 'center' },
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: NAVY, borderRadius: 12, paddingVertical: 14,
  },
  gpsBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // TTS button below bot bubble
  ttsBubbleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', marginTop: 3, marginLeft: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, backgroundColor: CREAM,
    borderWidth: 1, borderColor: BORDER,
  },
  ttsBubbleBtnText: { fontSize: 11, color: MUTED, fontWeight: '500' },

  // Paperclip attach button in text input bar
  attachBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    marginRight: 2, position: 'relative',
  },
  attachBadge: {
    position: 'absolute', top: 2, right: 2,
    backgroundColor: RED, borderRadius: 7, minWidth: 14, height: 14,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2,
  },
  attachBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  // Attachment thumbnail strip above text input
  attachStrip: {
    maxHeight: 80, borderTopWidth: 1, borderTopColor: BORDER,
    backgroundColor: CREAM,
  },
  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: SURFACE, borderRadius: 8,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 6, paddingVertical: 4,
    maxWidth: 180,
  },
  attachThumb: {
    width: 40, height: 40, borderRadius: 6, backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  attachChipName: { fontSize: 11, color: NAVY, flex: 1 },
  attachAddBtn: {
    width: 44, height: 44, borderRadius: 8, borderWidth: 1.5,
    borderColor: BORDER, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },

  // Evidence widget
  evidenceList: { gap: 6, marginBottom: 4 },
  evidenceItemWrap: {
    borderRadius: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: '#D1DCE8',
    marginBottom: 2,
  },
  evidenceItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CREAM, paddingHorizontal: 10, paddingVertical: 6,
  },
  // Issue 17: caption input below each evidence thumbnail
  captionInput: {
    borderTopWidth: 1, borderTopColor: '#D1DCE8',
    paddingHorizontal: 10, paddingVertical: 7,
    fontSize: 12, color: NAVY,
    backgroundColor: '#FAFAF8',
    fontStyle: 'italic',
  },
  evidenceItemText: { fontSize: 13, color: NAVY, flex: 1 },
  evidenceBtns: { flexDirection: 'row', gap: 8 },
  evidenceAddBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: NAVY, borderRadius: 10, paddingVertical: 10, borderStyle: 'dashed',
  },
  evidenceAddText: { fontSize: 14, color: NAVY, fontWeight: '600' },
  evidenceDoneBtn: {
    backgroundColor: GREEN, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  evidenceDoneText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Confirm
  confirmWrap: { gap: 8, paddingBottom: 4 },
  confirmYes: {
    backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center',
  },
  confirmYesText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  confirmNo: {
    backgroundColor: 'transparent', borderWidth: 1.5, borderColor: BORDER,
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  confirmNoText: { color: MUTED, fontSize: 14 },

  // View draft
  viewDraftBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: NAVY, borderRadius: 14, paddingVertical: 16, marginBottom: 4,
  },
  viewDraftBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // v3.3: New styles
  resumeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: NAVY, borderRadius: 12, padding: 14, marginBottom: 12,
  },
  resumeTitle: { color: GOLD, fontSize: 14, fontWeight: '700' },
  resumeSubtitle: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  saveLaterRow: { alignItems: 'center', paddingVertical: 8, marginTop: 4 },
  saveLaterText: { color: MUTED, fontSize: 13, textDecorationLine: 'underline' },
  evidenceThumb: { width: 36, height: 36, borderRadius: 6, marginRight: 4 },
  evidenceRemoveBtn: { padding: 2 },
  chipDanger: { backgroundColor: '#FEF2F2', borderColor: '#B91C1C' },
  chipTextDanger: { color: '#B91C1C' },
});
