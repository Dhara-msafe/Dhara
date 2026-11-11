/**
 * ApprovedStep — rendered once a consultation is APPROVED. Shows the
 * finalised, read-only note plus export (share/copy) and task-draft actions.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, Clipboard, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiPost, fetchExportText, newIdempotencyKey, reviseNote } from '../api';
import type { Consultation, NoteSections } from '../api';
import ConfirmModal from '../ConfirmModal';

const c = theme.colors;

const SECTION_META: { key: keyof NoteSections; label: string }[] = [
  { key: 'facts_stated', label: 'Facts stated by participants' },
  { key: 'client_instructions', label: 'Client instructions' },
  { key: 'advice_given', label: 'Advice given' },
  { key: 'open_uncertainties', label: 'Open uncertainties' },
  { key: 'proposed_actions', label: 'Proposed actions' },
];

export default function ApprovedStep({
  consultation, token, advocateVerified, onChanged,
}: { consultation: Consultation; token: string; advocateVerified: boolean; onChanged: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [creatingTasks, setCreatingTasks] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reviseModalOpen, setReviseModalOpen] = useState(false);
  const approved = consultation.approved_version;
  if (!approved) return null;

  const doExport = async (mode: 'share' | 'copy') => {
    const setBusy = mode === 'share' ? setExporting : setCopying;
    setBusy(true);
    try {
      const text = await fetchExportText(token, consultation.id);
      if (mode === 'copy') {
        Clipboard.setString(text);
        crossAlert('Copied', 'The note was copied to your clipboard.');
      } else if (Platform.OS === 'web') {
        await Share.share({ message: text });
      } else {
        const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        const fileUri = `${dir}consultation-${consultation.id.slice(0, 8)}.txt`;
        await FileSystem.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Share consultation note' });
        } else {
          await Share.share({ message: text });
        }
      }
    } catch (e: any) {
      crossAlert('Export failed', e?.message || 'Please try again.');
    }
    setBusy(false);
  };

  const createTasks = async () => {
    setCreatingTasks(true);
    try {
      const r = await apiPost<{ tasks_created: number; already_created?: boolean }>(
        token, `/consultations/${consultation.id}/tasks`, {}, newIdempotencyKey(),
      );
      if (r.already_created) {
        crossAlert('Task drafts already created', 'These proposed actions already have task drafts — no new ones were created.');
      } else {
        crossAlert('Task drafts created', `${r.tasks_created} task${r.tasks_created === 1 ? '' : 's'} created from proposed actions.`);
      }
    } catch (e: any) {
      crossAlert('Could not create tasks', e?.message || 'Please try again.');
    }
    setCreatingTasks(false);
  };

  const doRevise = async () => {
    setRevising(true);
    try {
      await reviseNote(token, consultation.id);
      setReviseModalOpen(false);
      onChanged();
    } catch (e: any) {
      crossAlert('Could not revise', e?.message || 'Please try again.');
    }
    setRevising(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.approvedBanner}>
        <Text style={styles.approvedBannerText}>
          ✓ Approved v{approved.version}{approved.approved_at ? ` · ${new Date(approved.approved_at).toLocaleString()}` : ''}
        </Text>
        {!!approved.approved_by_name && <Text style={styles.hashText}>Approved by {approved.approved_by_name}</Text>}
        {!!approved.content_hash && <Text style={styles.hashText}>Audit hash: {approved.content_hash}</Text>}
      </View>

      {SECTION_META.map(meta => {
        const items = approved.sections?.[meta.key] || [];
        if (items.length === 0) return null;
        return (
          <View key={meta.key} style={styles.section}>
            <Text style={styles.sectionTitle}>{meta.label}</Text>
            {items.map((item, idx) => (
              <View key={idx} style={styles.itemCard}>
                <Text style={styles.itemText}>{item.text}</Text>
                {!!item.source_ref && <Text style={styles.sourceRef}>“{item.source_ref}”</Text>}
                {meta.key === 'proposed_actions' && !!item.assignee && (
                  <Text style={styles.assignee}>Assignee: {item.assignee}</Text>
                )}
                {item.provenance === 'edited' && <Text style={styles.editedTag}>Edited by advocate</Text>}
              </View>
            ))}
          </View>
        );
      })}

      {approved.statute_citations?.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statute citations</Text>
          {approved.statute_citations.map((cite, i) => (
            <Text key={i} style={styles.citationText}>• {cite.statute} {cite.section || ''} — {cite.relevance}</Text>
          ))}
        </View>
      )}

      <View style={styles.actionsRow}>
        <Pressable style={[styles.actionBtn, !advocateVerified && styles.actionBtnDisabled]} onPress={() => doExport('copy')} disabled={copying || !advocateVerified}>
          {copying ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.actionBtnText}>Copy text</Text>}
        </Pressable>
        <Pressable style={[styles.actionBtn, !advocateVerified && styles.actionBtnDisabled]} onPress={() => doExport('share')} disabled={exporting || !advocateVerified}>
          {exporting ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.actionBtnText}>Share / Export</Text>}
        </Pressable>
      </View>
      {!advocateVerified && (
        <View style={styles.verificationNotice}>
          <Text style={styles.verificationNoticeText}>
            Export is not available for this account yet.
          </Text>
        </View>
      )}

      <Pressable style={styles.primaryBtn} onPress={createTasks} disabled={creatingTasks}>
        {creatingTasks ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create task drafts from actions</Text>}
      </Pressable>

      <Pressable style={styles.reviseBtn} onPress={() => setReviseModalOpen(true)} disabled={revising}>
        <Text style={styles.reviseBtnText}>Revise this note</Text>
      </Pressable>

      <ConfirmModal
        visible={reviseModalOpen}
        title="Revise this note?"
        message={`This opens a new, unapproved version (v${approved.version + 1}) for editing. This approved version (v${approved.version}) stays visible and exportable exactly as it is until the new version is approved in its place.`}
        confirmLabel="Revise"
        loading={revising}
        onCancel={() => setReviseModalOpen(false)}
        onConfirm={doRevise}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 4 },
  approvedBanner: { backgroundColor: '#E7F1EB', borderRadius: 12, padding: 14, marginBottom: 16 },
  approvedBannerText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: '#1F6B4A' },
  hashText: { fontFamily: theme.fonts.body, fontSize: 11, color: '#1F6B4A', marginTop: 4 },
  section: { marginTop: 14 },
  sectionTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.navy, marginBottom: 8 },
  itemCard: { backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 8 },
  itemText: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, lineHeight: 20 },
  sourceRef: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, fontStyle: 'italic', marginTop: 4 },
  assignee: { fontFamily: theme.fonts.bodyMedium, fontSize: 11, color: c.navy, marginTop: 2 },
  editedTag: { fontFamily: theme.fonts.bodyMedium, fontSize: 10, color: '#92400E', marginTop: 4 },
  citationText: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, marginBottom: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  actionBtn: { flex: 1, borderWidth: 1.5, borderColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.navy },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: '#fff' },
  reviseBtn: { marginTop: 14, paddingVertical: 10, alignItems: 'center' },
  reviseBtnText: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.muted, textDecorationLine: 'underline' },
  verificationNotice: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: 14, marginTop: 10 },
  verificationNoticeText: { fontFamily: theme.fonts.body, fontSize: 13, color: '#92400E', lineHeight: 19 },
});
