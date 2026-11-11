/**
 * NoteDraftStep — rendered while a consultation is NOTE_DRAFT. Either
 * offers to generate the first AI draft (Claude Sonnet 5.5), or lets the
 * advocate edit/regenerate/approve an existing draft.
 *
 * BATCH N2 (versioning): every "Save edits" / (re)generate appends a new
 * immutable version instead of mutating in place. Saves/approves send
 * `expected_version`; a 409 version_conflict (e.g. the same note saved from
 * two tabs) shows an in-app conflict screen with "Reapply my edits" instead
 * of silently overwriting. Past versions are browsable with a
 * restore-as-new-version action. The approve confirmation and the conflict
 * screen use the new in-app ConfirmModal, never a native alert/confirm.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiPost, updateNote, approveNoteVersion, NoteVersionConflictError } from '../api';
import type { Consultation, NoteSections, NoteDraft } from '../api';
import ConfirmModal from '../ConfirmModal';
import { LegacyConsentNotice } from '../ui';

const c = theme.colors;

const SECTION_META: { key: keyof NoteSections; label: string; hint: string }[] = [
  { key: 'facts_stated', label: 'Facts stated by participants', hint: 'Facts stated directly by a participant.' },
  { key: 'client_instructions', label: 'Client instructions', hint: 'What the client asked the advocate to do.' },
  { key: 'advice_given', label: 'Advice given', hint: 'Legal advice explicitly given.' },
  { key: 'open_uncertainties', label: 'Open uncertainties', hint: 'Things left unclear or pending.' },
  { key: 'proposed_actions', label: 'Proposed actions', hint: 'Specific next steps mentioned.' },
];

const EMPTY_SECTIONS: NoteSections = {
  facts_stated: [], client_instructions: [], advice_given: [], open_uncertainties: [], proposed_actions: [],
};

interface Conflict { current_version: number; current_sections: NoteSections }

export default function NoteDraftStep({
  consultation, token, advocateVerified, onChanged,
}: { consultation: Consultation; token: string; advocateVerified: boolean; onChanged: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [sections, setSections] = useState<NoteSections>(consultation.note_draft?.sections || EMPTY_SECTIONS);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<NoteDraft | null>(null);
  const legacyBlocked = !!consultation.legacy_consent_incomplete;

  // Re-sync the local edit buffer whenever a NEW version arrives — every
  // save/(re)generate/revise bumps note_draft.version, so that (not
  // generated_at, which edits intentionally preserve) is the right trigger.
  useEffect(() => {
    setSections(consultation.note_draft?.sections || EMPTY_SECTIONS);
    setConflict(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultation.note_draft?.version]);

  const generate = async () => {
    setGenerating(true);
    try {
      await apiPost(token, `/consultations/${consultation.id}/note/generate`);
      onChanged();
    } catch (e: any) {
      crossAlert('Draft generation failed', e?.message || 'Please try again.');
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

  const doSave = async (baseVersion: number) => {
    setSaving(true);
    try {
      await updateNote(token, consultation.id, sections, baseVersion);
      setConflict(null);
      onChanged();
    } catch (e: any) {
      if (e instanceof NoteVersionConflictError) {
        setConflict({ current_version: e.current_version, current_sections: e.current_sections });
      } else {
        crossAlert('Could not save', e?.message || 'Please try again.');
      }
    }
    setSaving(false);
  };

  const saveEdits = () => doSave(consultation.note_draft?.version || 1);

  /** Conflict screen action: keep my local edits, retry against the server's current version. */
  const reapplyMyEdits = () => { if (conflict) doSave(conflict.current_version); };

  /** Conflict screen action: discard my local edits, load the server's current content instead. */
  const discardAndReload = () => {
    if (conflict) setSections(conflict.current_sections);
    setConflict(null);
    onChanged();
  };

  const doApprove = async () => {
    setApproving(true);
    try {
      await approveNoteVersion(token, consultation.id, consultation.note_draft?.version || 1);
      setApproveModalOpen(false);
      onChanged();
    } catch (e: any) {
      if (e instanceof NoteVersionConflictError) {
        setApproveModalOpen(false);
        setConflict({ current_version: e.current_version, current_sections: e.current_sections });
      } else {
        crossAlert('Could not approve', e?.message || 'Please try again.');
      }
    }
    setApproving(false);
  };

  const confirmRestore = () => {
    if (!restoreTarget) return;
    setSections(restoreTarget.sections);
    setRestoreTarget(null);
    setHistoryOpen(false);
  };

  if (!consultation.note_draft) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>Generate the structured note</Text>
        <Text style={styles.body}>
          DHARA will read the {consultation.input_method === 'manual' ? 'notes' : 'transcript'} and extract
          facts stated by participants, client instructions, advice given, open uncertainties, and proposed actions — each
          with a source reference. Nothing is invented.
        </Text>
        {legacyBlocked ? (
          <LegacyConsentNotice />
        ) : advocateVerified ? (
          <>
            <Pressable style={styles.primaryBtn} onPress={generate} disabled={generating}>
              {generating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Generate AI draft</Text>}
            </Pressable>
            {generating && <Text style={styles.generatingHint}>This usually takes 10–20 seconds…</Text>}
          </>
        ) : (
          <View style={styles.verificationNotice}>
            <Text style={styles.verificationNoticeText}>
              AI drafting is not available for this account yet. Your manual notes are saved and will be
              ready to draft as soon as this account can use it.
            </Text>
          </View>
        )}
      </View>
    );
  }

  // Conflict screen takes over the whole step until resolved — never
  // silently merges or overwrites.
  if (conflict) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>This note changed</Text>
        <Text style={styles.body}>
          Someone (or something, like a regeneration) saved version {conflict.current_version} of this note
          before your save went through. Choose how to continue — nothing has been overwritten.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={reapplyMyEdits} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Reapply my edits</Text>}
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={discardAndReload} disabled={saving}>
          <Text style={styles.secondaryBtnText}>Discard my edits and load version {conflict.current_version}</Text>
        </Pressable>
      </View>
    );
  }

  const citations = consultation.note_draft.statute_citations || [];
  const draft = consultation.note_draft;
  const versions = (consultation.note_versions || []).slice().sort((a, b) => b.version - a.version);

  return (
    <View style={styles.wrap}>
      <View style={styles.versionRow}>
        <Text style={styles.heading}>Draft note</Text>
        <Text style={styles.versionBadge}>v{draft.version}</Text>
        <Text style={styles.notApprovedBadge}>Not approved</Text>
      </View>
      {!!draft.diff_summary && draft.source === 'revise' && (
        <Text style={styles.reviseHint}>{draft.diff_summary}</Text>
      )}
      <Text style={styles.body}>Edit any item, remove anything inaccurate, then approve to finalise.</Text>

      {legacyBlocked && <LegacyConsentNotice />}

      {(consultation.note_versions || []).length > 1 && (
        <Pressable onPress={() => setHistoryOpen(o => !o)} style={styles.historyToggle}>
          <Text style={styles.historyToggleText}>{historyOpen ? 'Hide version history' : `View version history (${consultation.note_versions.length})`}</Text>
        </Pressable>
      )}
      {historyOpen && (
        <View style={styles.historyBox}>
          {versions.map(v => (
            <View key={v.version} style={styles.historyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyVersionText}>
                  v{v.version}{v.approved ? ' · Approved' : ''}{v.version === draft.version ? ' · Current' : ''}
                </Text>
                <Text style={styles.historyMetaText}>{v.diff_summary || v.source}</Text>
                {!!v.author_name && <Text style={styles.historyMetaText}>By {v.author_name}</Text>}
              </View>
              {v.version !== draft.version && (
                <Pressable style={styles.restoreBtn} onPress={() => setRestoreTarget(v)}>
                  <Text style={styles.restoreBtnText}>Restore as new version</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

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
                {item.provenance === 'edited' && <Text style={styles.editedTag}>Edited by advocate</Text>}
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

      <Pressable style={styles.secondaryBtn} onPress={saveEdits} disabled={saving || legacyBlocked}>
        {saving ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.secondaryBtnText}>Save edits</Text>}
      </Pressable>

      {legacyBlocked ? null : advocateVerified ? (
        <>
          <Pressable style={styles.regenerateBtn} onPress={generate} disabled={generating}>
            {generating ? <ActivityIndicator color={c.navy} size="small" /> : <Text style={styles.regenerateBtnText}>Regenerate from source</Text>}
          </Pressable>

          <Pressable style={[styles.primaryBtn, { marginTop: 16 }]} onPress={() => setApproveModalOpen(true)} disabled={approving}>
            {approving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Approve & finalise note</Text>}
          </Pressable>
        </>
      ) : (
        <View style={[styles.verificationNotice, { marginTop: 16 }]}>
          <Text style={styles.verificationNoticeText}>
            Approval and regeneration are not available for this account yet.
          </Text>
        </View>
      )}

      <ConfirmModal
        visible={approveModalOpen}
        title={`Approve version ${draft.version}?`}
        message={`This approves version ${draft.version} as the official record and makes it exportable. If anything needs to change afterwards, you can revise it — that opens a new version for editing while this approved version stays visible and unchanged.`}
        confirmLabel="Approve"
        loading={approving}
        onCancel={() => setApproveModalOpen(false)}
        onConfirm={doApprove}
      />

      <ConfirmModal
        visible={!!restoreTarget}
        title={`Restore version ${restoreTarget?.version ?? ''} as a new version?`}
        message="This replaces your current unsaved edits with that version's content. Nothing is saved yet — review it, then tap Save edits to create the new version."
        confirmLabel="Load into editor"
        onCancel={() => setRestoreTarget(null)}
        onConfirm={confirmRestore}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 4 },
  heading: { fontFamily: theme.fonts.display, fontSize: 20, color: c.navy },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  versionBadge: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: c.muted, backgroundColor: c.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  notApprovedBadge: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: '#92400E', backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  reviseHint: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, fontStyle: 'italic', marginBottom: 6 },
  body: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20, marginBottom: 16 },
  historyToggle: { marginBottom: 14 },
  historyToggleText: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.navy, textDecorationLine: 'underline' },
  historyBox: { gap: 8, marginBottom: 16, backgroundColor: c.surfaceSecondary, borderRadius: 10, padding: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 8, padding: 10, gap: 8 },
  historyVersionText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },
  historyMetaText: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, marginTop: 2 },
  restoreBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  restoreBtnText: { fontFamily: theme.fonts.bodyMedium, fontSize: 11, color: c.navy, textDecorationLine: 'underline' },
  primaryBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: '#fff' },
  generatingHint: { textAlign: 'center', marginTop: 10, color: c.muted, fontFamily: theme.fonts.body, fontSize: 12 },
  verificationNotice: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: 14 },
  verificationNoticeText: { fontFamily: theme.fonts.body, fontSize: 13, color: '#92400E', lineHeight: 19 },
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
  editedTag: { fontFamily: theme.fonts.bodyMedium, fontSize: 10, color: '#92400E', marginTop: 4 },
  removeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { color: c.error, fontSize: 15 },
  citationText: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, marginBottom: 4 },
  secondaryBtn: { marginTop: 20, borderWidth: 1.5, borderColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.navy },
  regenerateBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  regenerateBtnText: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.muted, textDecorationLine: 'underline' },
});
