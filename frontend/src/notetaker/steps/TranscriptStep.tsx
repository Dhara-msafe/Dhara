/**
 * TranscriptStep — rendered while a consultation is TRANSCRIPT_REVIEW.
 * Lets the advocate edit the working transcript (original is preserved)
 * before approving it to move into note drafting.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { theme } from '@/src/theme';
import { apiPatch, apiPost } from '../api';
import type { Consultation } from '../api';

const c = theme.colors;

export default function TranscriptStep({
  consultation, token, onChanged,
}: { consultation: Consultation; token: string; onChanged: () => void }) {
  const [text, setText] = useState(consultation.working_transcript || '');
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const dirty = text !== (consultation.working_transcript || '');

  const save = async () => {
    setSaving(true);
    try {
      await apiPatch(token, `/consultations/${consultation.id}/transcript`, { working_transcript: text });
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
    setSaving(false);
  };

  const approve = async () => {
    if (dirty) { Alert.alert('Save changes first', 'Save your edits before approving the transcript.'); return; }
    setApproving(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/transcript/approve`);
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not approve', e?.message || 'Please try again.');
    }
    setApproving(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Review the transcript</Text>
      <Text style={styles.body}>Edit for accuracy. The original import is always kept for reference.</Text>

      <TextInput
        style={styles.textArea}
        value={text}
        onChangeText={setText}
        multiline
        textAlignVertical="top"
      />

      <View style={styles.row}>
        <Pressable style={styles.linkBtn} onPress={() => setShowOriginal(s => !s)}>
          <Text style={styles.linkBtnText}>{showOriginal ? 'Hide original' : 'View original import'}</Text>
        </Pressable>
        <Pressable style={styles.secondarySmallBtn} onPress={save} disabled={!dirty || saving}>
          {saving ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={[styles.secondarySmallBtnText, !dirty && { opacity: 0.4 }]}>Save changes</Text>}
        </Pressable>
      </View>

      {showOriginal && (
        <View style={styles.originalBox}>
          <Text style={styles.originalText}>{consultation.original_transcript}</Text>
        </View>
      )}

      <Pressable
        style={[styles.primaryBtn, (dirty || !text.trim()) && styles.disabledBtn, { marginTop: 20 }]}
        onPress={approve}
        disabled={dirty || !text.trim() || approving}
      >
        {approving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Approve transcript & draft note</Text>}
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
    minHeight: 260,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  linkBtn: { paddingVertical: 8 },
  linkBtnText: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.navy, textDecorationLine: 'underline' },
  secondarySmallBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: c.surfaceSecondary },
  secondarySmallBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  originalBox: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 14, marginTop: 10 },
  originalText: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  disabledBtn: { opacity: 0.4 },
  primaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: '#fff' },
});
