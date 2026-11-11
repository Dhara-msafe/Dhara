/**
 * NoteDraftStep — rendered while a consultation is NOTE_DRAFT. Either
 * offers to generate the first AI draft (Claude Sonnet 5.5), or lets the
 * advocate edit/regenerate/approve an existing draft.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiPatch, apiPost } from '../api';
import type { Consultation, NoteSections } from '../api';

const c = theme.colors;

const SECTION_META: { key: keyof NoteSections; label: string; hint: string }[] = [
  { key: 'verified_facts', label: 'Verified facts', hint: 'Facts stated directly by a participant.' },
  { key: 'client_instructions', label: 'Client instructions', hint: 'What the client asked the advocate to do.' },
  { key: 'advice_given', label: 'Advice given', hint: 'Legal advice explicitly given.' },
  { key: 'open_uncertainties', label: 'Open uncertainties', hint: 'Things left unclear or pending.' },
  { key: 'proposed_actions', label: 'Proposed actions', hint: 'Specific next steps mentioned.' },
];

const EMPTY_SECTIONS: NoteSections = {
  verified_facts: [], client_instructions: [], advice_given: [], open_uncertainties: [], proposed_actions: [],
};

export default function NoteDraftStep({
  consultation, token, onChanged,
}: { consultation: Consultation; token: string; onChanged: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [sections, setSections] = useState<NoteSections>(consultation.note_draft?.sections || EMPTY_SECTIONS);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // Re-sync the local edit buffer whenever a fresh draft arrives (new generation).
  // Intentionally keyed only on generated_at — the sections object itself is
  // replaced wholesale on every (re)generation, so this is the right trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSections(consultation.note_draft?.sections || EMPTY_SECTIONS);
  }, [consultation.note_draft?.generated_at]);

  const generate = async () => {
    setGenerating(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/note/generate`);
      onChanged();
    } catch (e: any) {
      Alert.alert('Draft generation failed', e?.message || 'Please try again.');
    }
    setGenerating(false);
  };

  const updateItemText = (key: keyof NoteSections, idx: number, text: string) => {
    setSections(prev => {
      const items = [...prev[key]];
      items[idx] = { ...items[idx], text };
      return { ...prev, [key]: items };
    });
  };

  const removeItem = (key: keyof NoteSections, idx: number) => {
    setSections(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== idx) }));
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      await apiPatch(token, `/consultations/${consultation.id}/note`, { sections });
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
    setSaving(false);
  };

  const approve = () => {
    crossAlert(
      'Approve this note?',
      'Approving finalises this note as a permanent, auditable record. You can still create task drafts afterwards, but the note text cannot be edited again.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setApproving(true);
            try {
              await apiPost(token, `/consultations/${consultation.id}/note/approve`);
              onChanged();
            } catch (e: any) {
              Alert.alert('Could not approve', e?.message || 'Please try again.');
            }
            setApproving(false);
          },
        },
      ],
    );
  };

  if (!consultation.note_draft) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>Generate the structured note</Text>
        <Text style={styles.body}>
          DHARA will read the {consultation.input_method === 'manual' ? 'notes' : 'transcript'} and extract
          verified facts, client instructions, advice given, open uncertainties, and proposed actions — each
          with a source reference. Nothing is invented.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={generate} disabled={generating}>
          {generating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Generate AI draft</Text>}
        </Pressable>
        {generating && <Text style={styles.generatingHint}>This usually takes 10–20 seconds…</Text>}
      </View>
    );
  }

  const citations = consultation.note_draft.statute_citations || [];

  return (
    <View style={styles.wrap}>
      <View style={styles.versionRow}>
        <Text style={styles.heading}>Draft note</Text>
        <Text style={styles.versionBadge}>v{consultation.note_draft.version}</Text>
      </View>
      <Text style={styles.body}>Edit any item, remove anything inaccurate, then approve to finalise.</Text>

      {SECTION_META.map(meta => (
        <View key={meta.key} style={styles.section}>
          <Text style={styles.sectionTitle}>{meta.label}</Text>
          <Text style={styles.sectionHint}>{meta.hint}</Text>
          {sections[meta.key].length === 0 ? (
            <Text style={styles.sectionEmpty}>Nothing extracted for this section.</Text>
          ) : sections[meta.key].map((item, idx) => (
            <View key={idx} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.itemInput}
                  value={item.text}
                  onChangeText={t => updateItemText(meta.key, idx, t)}
                  multiline
                />
                {!!item.source_ref && <Text style={styles.sourceRef} numberOfLines={2}>“{item.source_ref}”</Text>}
                {meta.key === 'proposed_actions' && !!item.assignee && (
                  <Text style={styles.assignee}>Assignee: {item.assignee}</Text>
                )}
              </View>
              <Pressable onPress={() => removeItem(meta.key, idx)} style={styles.removeBtn} accessibilityLabel="Remove item">
                <Text style={styles.removeBtnText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}

      {citations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statute citations</Text>
          {citations.map((cite, i) => (
            <Text key={i} style={styles.citationText}>• {cite.statute} {cite.section || ''} — {cite.relevance}</Text>
          ))}
        </View>
      )}

      <Pressable style={styles.secondaryBtn} onPress={saveEdits} disabled={saving}>
        {saving ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.secondaryBtnText}>Save edits</Text>}
      </Pressable>

      <Pressable style={styles.regenerateBtn} onPress={generate} disabled={generating}>
        {generating ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.regenerateBtnText}>Regenerate from source</Text>}
      </Pressable>

      <Pressable style={[styles.primaryBtn, { marginTop: 16 }]} onPress={approve} disabled={approving}>
        {approving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Approve & finalise note</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 4 },
  heading: { fontFamily: theme.fonts.display, fontSize: 20, color: c.navy },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  versionBadge: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: c.muted, backgroundColor: c.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  body: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20, marginBottom: 16 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: '#fff' },
  generatingHint: { textAlign: 'center', marginTop: 10, color: c.muted, fontFamily: theme.fonts.body, fontSize: 12 },
  section: { marginTop: 18 },
  sectionTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.navy },
  sectionHint: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2, marginBottom: 10 },
  sectionEmpty: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, fontStyle: 'italic' },
  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.surface,
    borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 10, marginBottom: 8,
  },
  itemInput: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, minHeight: 20, padding: 0 },
  sourceRef: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, fontStyle: 'italic', marginTop: 4 },
  assignee: { fontFamily: theme.fonts.bodyMedium, fontSize: 11, color: c.navy, marginTop: 2 },
  removeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { color: c.error, fontSize: 15 },
  citationText: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, marginBottom: 4 },
  secondaryBtn: { marginTop: 20, borderWidth: 1.5, borderColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.navy },
  regenerateBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  regenerateBtnText: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.muted, textDecorationLine: 'underline' },
});
