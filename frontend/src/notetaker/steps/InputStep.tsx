/**
 * InputStep — rendered while a consultation is READY. Branches by
 * input_method: manual notes, pasted/imported transcript, or audio upload
 * (file picker or live microphone recording — recording is native-only).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, AudioModule } from 'expo-audio';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiPost } from '../api';
import { formatFileSize } from '../ui';
import { uploadForm } from '@/src/utils/upload';
import { API_BASE } from '@/src/auth';
import { withMicLease, MIC_BUSY_MESSAGE, type MicLease } from '@/src/voice/micArbiterGuard';
import type { Consultation } from '../api';

const c = theme.colors;

export default function InputStep({
  consultation, token, onChanged,
}: { consultation: Consultation; token: string; onChanged: () => void }) {
  if (consultation.input_method === 'manual') {
    return <ManualInput consultation={consultation} token={token} onChanged={onChanged} />;
  }
  if (consultation.input_method === 'transcript_import') {
    return <TranscriptImport consultation={consultation} token={token} onChanged={onChanged} />;
  }
  return <AudioImport consultation={consultation} token={token} onChanged={onChanged} />;
}

function ManualInput({ consultation, token, onChanged }: { consultation: Consultation; token: string; onChanged: () => void }) {
  const [notes, setNotes] = useState(consultation.manual_notes || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!notes.trim()) { crossAlert('Notes required', 'Write a few notes before continuing.'); return; }
    setSaving(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/manual-notes`, { notes });
      onChanged();
    } catch (e: any) {
      crossAlert('Could not save', e?.message || 'Please try again.');
    }
    setSaving(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Type your notes</Text>
      <Text style={styles.body}>Write what was discussed. You can keep editing until you continue to drafting.</Text>
      <TextInput
        style={styles.textArea}
        value={notes}
        onChangeText={setNotes}
        placeholder="Record what the client said, advice given, and next steps…"
        placeholderTextColor={c.muted}
        multiline
        textAlignVertical="top"
      />
      <Pressable style={[styles.primaryBtn, !notes.trim() && styles.disabledBtn]} onPress={save} disabled={!notes.trim() || saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save & continue to draft</Text>}
      </Pressable>
    </View>
  );
}

function TranscriptImport({ consultation, token, onChanged }: { consultation: Consultation; token: string; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const pickFile = async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'text/*'], copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.[0]) {
        const content = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
        setText(content);
      }
    } catch {
      crossAlert('Could not read file', 'Please paste the transcript text instead.');
    }
    setPicking(false);
  };

  const save = async () => {
    if (!text.trim()) { crossAlert('Transcript required', 'Paste or import a transcript before continuing.'); return; }
    setSaving(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/transcript`, { text });
      onChanged();
    } catch (e: any) {
      crossAlert('Could not import transcript', e?.message || 'Please try again.');
    }
    setSaving(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Import the transcript</Text>
      <Text style={styles.body}>Paste the transcript text, or import a .txt file.</Text>
      <Pressable style={styles.secondaryBtn} onPress={pickFile} disabled={picking}>
        {picking ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.secondaryBtnText}>Import from .txt file</Text>}
      </Pressable>
      <TextInput
        style={styles.textArea}
        value={text}
        onChangeText={setText}
        placeholder="Paste transcript text here…"
        placeholderTextColor={c.muted}
        multiline
        textAlignVertical="top"
      />
      <Pressable style={[styles.primaryBtn, !text.trim() && styles.disabledBtn]} onPress={save} disabled={!text.trim() || saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Import & review</Text>}
      </Pressable>
    </View>
  );
}

function AudioImport({ consultation, token, onChanged }: { consultation: Consultation; token: string; onChanged: () => void }) {
  const [picked, setPicked] = useState<{ uri: string; name: string; mimeType: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [permBlocked, setPermBlocked] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const micLeaseRef = useRef<MicLease | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Best-effort cleanup if the advocate navigates away mid-recording.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    micLeaseRef.current?.release();
    if (Platform.OS !== 'web') { try { recorder.stop(); } catch {} }
  }, [recorder]);

  const pick = async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) { setPicking(false); return; }
      const asset = result.assets[0];
      const ext = ('.' + (asset.name.split('.').pop() || '')).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        crossAlert('Unsupported format', 'Please choose an MP3, WAV, or M4A file.');
        setPicking(false);
        return;
      }
      if ((asset.size || 0) > 25 * 1024 * 1024) {
        crossAlert('File too large', 'Maximum audio size is 25 MB.');
        setPicking(false);
        return;
      }
      setPicked({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'audio/mpeg', size: asset.size || 0 });
    } catch {
      crossAlert('Could not select file', 'Please try again.');
    }
    setPicking(false);
  };

  // ── Live microphone recording (native only — see InputStep header comment) ──
  const startRecording = async () => {
    setPermBlocked(false);
    try {
      let permResult = await AudioModule.getRecordingPermissionsAsync();
      if (!permResult.granted) {
        permResult = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!permResult.granted) {
        if (!permResult.canAskAgain) setPermBlocked(true);
        else crossAlert('Microphone needed', 'Allow microphone access to record this consultation live.');
        return;
      }
      const claimResult = await withMicLease(
        'notetaker_mic',
        () => { try { recorder.stop(); } catch {} stopTimer(); setIsRecording(false); },
        async () => {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await recorder.prepareToRecordAsync();
        },
      );
      if (!claimResult.ok) { crossAlert('Microphone busy', MIC_BUSY_MESSAGE); return; }
      micLeaseRef.current = claimResult.lease;
      recorder.record();
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch {
      micLeaseRef.current?.release(); micLeaseRef.current = null;
      crossAlert('Could not start recording', 'Check microphone permission and try again.');
    }
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const finishRecording = async (discard: boolean) => {
    stopTimer();
    setIsRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      micLeaseRef.current?.release(); micLeaseRef.current = null;
      if (discard || !uri) return;
      let size = 0;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        size = info.exists ? (info as any).size || 0 : 0;
      } catch {}
      setPicked({ uri, name: `consultation-${Date.now()}.m4a`, mimeType: 'audio/m4a', size });
    } catch {
      crossAlert('Recording error', 'Could not finish the recording. Please try again.');
    }
  };

  const upload = async () => {
    if (!picked) return;
    setUploading(true);
    try {
      const r = await uploadForm(
        `${API_BASE}/api/notetaker/consultations/${consultation.id}/audio`,
        { uri: picked.uri, name: picked.name, type: picked.mimeType },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.detail || 'Upload failed');
      }
      onChanged();
    } catch (e: any) {
      crossAlert('Upload failed', e?.message || 'Please try again.');
    }
    setUploading(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Add the audio recording</Text>
      <Text style={styles.body}>MP3, WAV, or M4A — up to 25 MB. DHARA transcribes it automatically after upload.</Text>

      {isRecording ? (
        <View style={styles.recordingCard}>
          <View style={styles.recordingDotRow}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingTime}>{formatSeconds(recordSeconds)}</Text>
          </View>
          <Text style={styles.recordingHint}>Recording the consultation live…</Text>
          <View style={styles.recordingActions}>
            <Pressable style={styles.discardBtn} onPress={() => finishRecording(true)}>
              <Text style={styles.discardBtnText}>Discard</Text>
            </Pressable>
            <Pressable style={styles.stopBtn} onPress={() => finishRecording(false)}>
              <Text style={styles.stopBtnText}>Stop recording</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.choiceRow}>
          {Platform.OS !== 'web' && (
            <Pressable style={[styles.secondaryBtn, styles.choiceBtn]} onPress={startRecording} disabled={picking || uploading}>
              <Text style={styles.secondaryBtnText}>🎙️ Record now</Text>
            </Pressable>
          )}
          <Pressable style={[styles.secondaryBtn, styles.choiceBtn]} onPress={pick} disabled={picking || uploading}>
            {picking ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.secondaryBtnText}>{picked ? 'Choose different file' : 'Choose audio file'}</Text>}
          </Pressable>
        </View>
      )}

      {permBlocked && (
        <View style={styles.permBanner}>
          <Text style={styles.permBannerText}>Microphone access is blocked. Enable it in your device settings to record live.</Text>
          <Pressable onPress={() => Linking.openSettings()} style={styles.permBannerBtn}>
            <Text style={styles.permBannerBtnText}>Open Settings</Text>
          </Pressable>
        </View>
      )}

      {picked && !isRecording && (
        <View style={styles.fileCard}>
          <Text style={styles.fileName} numberOfLines={1}>{picked.name}</Text>
          <Text style={styles.fileMeta}>{formatFileSize(picked.size)}</Text>
        </View>
      )}

      <Pressable style={[styles.primaryBtn, (!picked || isRecording) && styles.disabledBtn]} onPress={upload} disabled={!picked || isRecording || uploading}>
        {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Upload audio</Text>}
      </Pressable>
    </View>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 4 },
  heading: { fontFamily: theme.fonts.display, fontSize: 20, color: c.navy, marginBottom: 6 },
  body: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20, marginBottom: 16 },
  textArea: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 12, padding: 14,
    fontFamily: theme.fonts.body, fontSize: 15, color: c.ink, backgroundColor: c.surface,
    minHeight: 220, marginBottom: 16,
  },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  disabledBtn: { opacity: 0.4 },
  primaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: '#fff' },
  secondaryBtn: { borderWidth: 1.5, borderColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.navy },
  choiceRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  choiceBtn: { flex: 1 },
  fileCard: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 16 },
  fileName: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  fileMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  recordingCard: {
    backgroundColor: c.surface, borderRadius: 14, borderWidth: 1.5, borderColor: c.error,
    padding: 18, alignItems: 'center', marginBottom: 16,
  },
  recordingDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.error },
  recordingTime: { fontFamily: theme.fonts.bodySemiBold, fontSize: 22, color: c.ink, fontVariant: ['tabular-nums'] },
  recordingHint: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 6, marginBottom: 14 },
  recordingActions: { flexDirection: 'row', gap: 10, width: '100%' },
  discardBtn: { flex: 1, borderWidth: 1.5, borderColor: c.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  discardBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
  stopBtn: { flex: 1.4, backgroundColor: c.error, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  stopBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: '#fff' },
  permBanner: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 16 },
  permBannerText: { fontFamily: theme.fonts.body, fontSize: 12, color: '#92400E', lineHeight: 18, marginBottom: 8 },
  permBannerBtn: { alignSelf: 'flex-start', backgroundColor: '#92400E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  permBannerBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: '#fff' },
});
