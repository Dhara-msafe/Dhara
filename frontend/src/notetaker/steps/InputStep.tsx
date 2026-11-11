/**
 * InputStep — rendered while a consultation is READY. Branches by
 * input_method: manual notes, pasted/imported transcript, or audio upload.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '@/src/theme';
import { apiPost } from '../api';
import { uploadForm } from '@/src/utils/upload';
import { API_BASE } from '@/src/auth';
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
    if (!notes.trim()) { Alert.alert('Notes required', 'Write a few notes before continuing.'); return; }
    setSaving(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/manual-notes`, { notes });
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
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
      Alert.alert('Could not read file', 'Please paste the transcript text instead.');
    }
    setPicking(false);
  };

  const save = async () => {
    if (!text.trim()) { Alert.alert('Transcript required', 'Paste or import a transcript before continuing.'); return; }
    setSaving(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/transcript`, { text });
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not import transcript', e?.message || 'Please try again.');
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

const ALLOWED_EXT = ['.mp3', '.wav', '.m4a'];

function AudioImport({ consultation, token, onChanged }: { consultation: Consultation; token: string; onChanged: () => void }) {
  const [picked, setPicked] = useState<{ uri: string; name: string; mimeType: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);

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
        Alert.alert('Unsupported format', 'Please choose an MP3, WAV, or M4A file.');
        setPicking(false);
        return;
      }
      if ((asset.size || 0) > 25 * 1024 * 1024) {
        Alert.alert('File too large', 'Maximum audio size is 25 MB.');
        setPicking(false);
        return;
      }
      setPicked({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'audio/mpeg', size: asset.size || 0 });
    } catch {
      Alert.alert('Could not select file', 'Please try again.');
    }
    setPicking(false);
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
      Alert.alert('Upload failed', e?.message || 'Please try again.');
    }
    setUploading(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Upload audio recording</Text>
      <Text style={styles.body}>MP3, WAV, or M4A — up to 25 MB. DHARA transcribes it automatically after upload.</Text>

      <Pressable style={styles.secondaryBtn} onPress={pick} disabled={picking || uploading}>
        {picking ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.secondaryBtnText}>{picked ? 'Choose a different file' : 'Choose audio file'}</Text>}
      </Pressable>

      {picked && (
        <View style={styles.fileCard}>
          <Text style={styles.fileName} numberOfLines={1}>{picked.name}</Text>
          <Text style={styles.fileMeta}>{(picked.size / (1024 * 1024)).toFixed(1)} MB</Text>
        </View>
      )}

      <Pressable style={[styles.primaryBtn, !picked && styles.disabledBtn]} onPress={upload} disabled={!picked || uploading}>
        {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Upload audio</Text>}
      </Pressable>
    </View>
  );
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
  secondaryBtn: { borderWidth: 1.5, borderColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
  secondaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.navy },
  fileCard: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 16 },
  fileName: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  fileMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
});
