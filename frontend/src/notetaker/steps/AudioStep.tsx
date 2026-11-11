/**
 * AudioStep — rendered while a consultation is AUDIO_REVIEW. Lets the
 * advocate confirm the uploaded file and kick off Whisper transcription.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { theme } from '@/src/theme';
import { apiPost } from '../api';
import { formatFileSize } from '../ui';
import type { Consultation } from '../api';

const c = theme.colors;

export default function AudioStep({
  consultation, token, onChanged,
}: { consultation: Consultation; token: string; onChanged: () => void }) {
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/audio/transcribe`);
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not start transcription', e?.message || 'Please try again.');
    }
    setStarting(false);
  };

  const sizeLabel = formatFileSize(consultation.audio_size_bytes || 0);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Audio ready to transcribe</Text>
      <Text style={styles.body}>Review the file below, then start transcription. This uses Whisper and may take a minute.</Text>
      <View style={styles.fileCard}>
        <Text style={styles.fileName} numberOfLines={1}>{consultation.audio_original_name || 'Audio file'}</Text>
        <Text style={styles.fileMeta}>{sizeLabel}</Text>
      </View>
      <Pressable style={styles.primaryBtn} onPress={start} disabled={starting}>
        {starting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Start transcription</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 4 },
  heading: { fontFamily: theme.fonts.display, fontSize: 20, color: c.navy, marginBottom: 6 },
  body: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20, marginBottom: 16 },
  fileCard: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 16 },
  fileName: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  fileMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: '#fff' },
});
