import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, AudioModule } from 'expo-audio';
import { API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { INTAKE_TEMPLATES, getTemplate, IntakeTemplate } from '@/src/intakeTemplates';
import { MIC_BUSY_MESSAGE, withMicLease, type MicLease } from '@/src/voice/micArbiterGuard';

const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;

export default function ClientIntake() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [intake, setIntake] = useState<any>(null);
  const [template, setTemplate] = useState<IntakeTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeVoice, setActiveVoice] = useState<string | null>(null); // question id being recorded
  const [transcribingId, setTranscribingId] = useState<string | null>(null); // question id being transcribed
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Cloud Whisper transcription (no login on this public form — scoped to
  // this intake token server-side, see POST /advocate/intake/{token}/transcribe).
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingActiveRef = useRef(false);
  const micLeaseRef = useRef<MicLease | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/advocate/intake/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setIntake(data);
        if (data?.template_id) {
          setTemplate(getTemplate(data.template_id) ?? INTAKE_TEMPLATES[0]);
        } else {
          setTemplate(INTAKE_TEMPLATES[0]);
        }
      })
      .catch(() => setIntake(null))
      .finally(() => setLoading(false));
  }, [token]);

  // Stop a dangling recording if the user navigates away mid-recording.
  useEffect(() => () => { if (recordingActiveRef.current) { try { recorder.stop(); } catch {} } micLeaseRef.current?.release(); }, [recorder]);

  const toggleVoice = async (qId: string) => {
    if (activeVoice === qId) {
      // ── Stop recording, then upload for transcription ──
      setActiveVoice(null);
      recordingActiveRef.current = false;
      setTranscribingId(qId);
      try {
        await recorder.stop();
        const uri = recorder.uri;
        // Mic diagnosis fix: distinct sentinel for "nothing captured".
        if (!uri) throw new Error('__no_recording__');
        const form = new FormData();
        // @ts-expect-error RN FormData file
        form.append('audio', { uri, name: 'audio.m4a', type: 'audio/m4a' });
        form.append('language', 'en');
        const res = await fetch(`${API_BASE}/api/advocate/intake/${token}/transcribe`, {
          method: 'POST',
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.text) {
          setAnswers(prev => ({ ...prev, [qId]: (prev[qId] ? prev[qId] + ' ' : '') + data.text }));
        } else if (!res.ok) {
          alert(data?.detail || 'Could not transcribe your recording. Please try again or type your answer.');
        }
      } catch (e: any) {
        // Mic diagnosis fix: distinct message per cause, mirroring
        // src/voice/stt.ts's sttErrorToMessage() (this endpoint is a
        // separate advocate-intake route, not the shared Whisper path).
        alert(
          e?.message === '__no_recording__'
            ? 'No sound was recorded. Please allow the microphone and try again.'
            : 'Could not transcribe your recording. Please try again or type your answer.'
        );
      } finally {
        setTranscribingId(null);
        micLeaseRef.current?.release(); micLeaseRef.current = null;
      }
      return;
    }
    // ── Start recording ──
    try {
      // P0-A: Check current status first — skip the dialog when already granted.
      let permResult = await AudioModule.getRecordingPermissionsAsync();
      if (!permResult.granted) {
        permResult = await AudioModule.requestRecordingPermissionsAsync();
      }
      const { status } = permResult;
      if (status !== 'granted') {
        alert('Microphone permission denied. Please allow microphone access in Settings, or type your answer.');
        return;
      }
      // BATCH A1: claim the mic lease BEFORE touching the shared audio
      // session — setAudioModeAsync is global and must never run ahead of
      // a lease check, or it can disrupt an active Evidence Locker recording.
      const claimResult = await withMicLease(
        'intake_mic',
        () => { try { recorder.stop(); } catch {} recordingActiveRef.current = false; setActiveVoice(null); },
        async () => {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await recorder.prepareToRecordAsync();
        },
      );
      if (!claimResult.ok) { alert(MIC_BUSY_MESSAGE); return; }
      micLeaseRef.current = claimResult.lease;
      recorder.record();
      recordingActiveRef.current = true;
      setActiveVoice(qId);
    } catch {
      micLeaseRef.current?.release(); micLeaseRef.current = null;
      alert('Could not access the microphone. Please type your answer instead.');
    }
  };

  const handleSubmit = async () => {
    if (!clientName.trim()) { alert('Please enter your name.'); return; }
    const required = template?.questions.filter(q => q.required) ?? [];
    const missing = required.find(q => !answers[q.id]?.trim());
    if (missing) { alert(`Please answer: "${missing.label}"`); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/advocate/intake/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: clientName.trim(), transcript: Object.values(answers), answers }),
      });
      if (!r.ok) throw new Error();
      setDone(true);
    } catch { alert('Submission failed. Please try again.'); }
    setSubmitting(false);
  };

  if (loading) return (
    <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color={NAVY} size="large" /></View></SafeAreaView>
  );

  if (!intake || intake.expired) return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#DC2626" />
        <Text style={s.errorTitle}>{intake?.expired ? 'This link has expired' : 'Link not found'}</Text>
        <Text style={s.errorSub}>Please ask your advocate to send a new link.</Text>
      </View>
    </SafeAreaView>
  );

  if (intake.status === 'complete' || done) return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <Ionicons name="checkmark-circle" size={64} color="#059669" />
        <Text style={s.doneTitle}>Submitted Successfully</Text>
        <Text style={s.doneSub}>Your information has been sent to your advocate securely. They will contact you shortly.</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={s.safe}>
        {/* Header */}
        <View style={s.header}>
          <View style={[s.headerIcon, { backgroundColor: (template?.color ?? NAVY) + '22' }]}>
            <Ionicons name={(template?.icon ?? 'document-text-outline') as any} size={20} color={template?.color ?? NAVY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>{template?.title ?? 'Client Intake'}</Text>
            <Text style={s.headerSub}>Powered by DHARA AI — Secure &amp; Confidential</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Name */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>Your Full Name <Text style={s.req}>*</Text></Text>
            <TextInput
              style={s.input}
              value={clientName}
              onChangeText={setClientName}
              placeholder="Enter your full name"
              placeholderTextColor="#9CA3AF"
              returnKeyType="next"
            />
          </View>

          {/* Template questions */}
          {template?.questions.map((q) => {
            const isRecording = activeVoice === q.id;
            const isTranscribing = transcribingId === q.id;
            const showMic = Platform.OS !== 'web';
            return (
              <View key={q.id} style={s.fieldWrap}>
                <Text style={s.label}>{q.label}{q.required ? <Text style={s.req}> *</Text> : null}</Text>
                <View style={s.inputRow}>
                  <TextInput
                    style={[s.input, q.type === 'textarea' && s.textarea, { flex: 1 }]}
                    value={answers[q.id] ?? ''}
                    onChangeText={t => setAnswers(prev => ({ ...prev, [q.id]: t }))}
                    placeholder={q.placeholder ?? ''}
                    placeholderTextColor="#9CA3AF"
                    multiline={q.type === 'textarea'}
                    numberOfLines={q.type === 'textarea' ? 3 : 1}
                    textAlignVertical={q.type === 'textarea' ? 'top' : 'center'}
                    editable={!isTranscribing}
                  />
                  {showMic && (
                    <Pressable
                      style={[s.micBtn, isRecording && s.micBtnActive]}
                      onPress={() => toggleVoice(q.id)}
                      disabled={isTranscribing}
                    >
                      {isTranscribing
                        ? <ActivityIndicator size="small" color={NAVY} />
                        : <Ionicons name={isRecording ? 'stop' : 'mic-outline'} size={20} color={isRecording ? '#fff' : NAVY} />}
                    </Pressable>
                  )}
                </View>
                {isRecording && <Text style={s.recording}>🎙 Recording… tap again to stop</Text>}
                {isTranscribing && <Text style={s.recording}>Transcribing…</Text>}
              </View>
            );
          })}

          <Pressable style={[s.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
            {submitting
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Ionicons name="send" size={18} color="#fff" /><Text style={s.submitText}>Submit to Advocate</Text></>
            }
          </Pressable>

          <Text style={s.privacy}>🔒 Your information is encrypted and only visible to your advocate.</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FDFBF7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  header: { backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 11, color: GOLD, marginTop: 2 },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  fieldWrap: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700', color: '#1F2937' },
  req: { color: '#DC2626' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1F2937' },
  textarea: { minHeight: 80, paddingTop: 12 },
  micBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D1D5DB', marginTop: 0 },
  micBtnActive: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  recording: { fontSize: 12, color: '#DC2626', fontWeight: '600' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: NAVY, borderRadius: 14, paddingVertical: 16, marginTop: 8 },
  submitText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  privacy: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 4 },
  errorTitle: { fontSize: 18, fontWeight: '800', color: '#1F2937' },
  errorSub: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
  doneTitle: { fontSize: 22, fontWeight: '800', color: '#059669' },
  doneSub: { fontSize: 14, color: '#374151', textAlign: 'center', lineHeight: 22 },
});
