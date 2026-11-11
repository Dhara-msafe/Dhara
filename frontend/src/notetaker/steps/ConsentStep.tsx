/**
 * ConsentStep — rendered while a consultation is in DRAFT or CONSENT_PENDING,
 * and reachable at any later active stage via the "Manage consent" entry
 * point in the consultation header (a late-added participant must force a
 * fresh readiness check, which this enables).
 *
 * The backend only transitions to READY once every *required* participant's
 * latest decision is 'given'; a decline/unknown on any required participant
 * blocks (or demotes back to) CONSENT_PENDING, and offers "continue with
 * manual notes only" as the documented way to proceed without recording or
 * AI drafting. A participant can also withdraw consent at any point, which
 * halts further capture/upload/AI work for the whole consultation.
 *
 * BATCH N1-B2: adds the "unknown" outcome, per-consent scope/notice-version/
 * evidence-reference capture, and per-participant withdrawal. The withdraw
 * confirmation uses the new in-app ConfirmModal, not a native alert/confirm.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiPost, newIdempotencyKey, withdrawConsent, CONSENT_SCOPE_OPTIONS, CURRENT_CONSENT_NOTICE_VERSION } from '../api';
import type { Consultation, Consent, ConsentScope } from '../api';
import ConfirmModal from '../ConfirmModal';

const c = theme.colors;

const SCOPE_LABELS: Record<ConsentScope, string> = {
  notes: 'Notes', audio: 'Audio', transcription: 'Transcription', storage: 'Storage',
};

function defaultScope(inputMethod: Consultation['input_method']): ConsentScope[] {
  const scope: ConsentScope[] = ['notes', 'storage'];
  if (inputMethod === 'audio_import') scope.push('audio', 'transcription');
  if (inputMethod === 'transcript_import') scope.push('transcription');
  return scope;
}

export default function ConsentStep({
  consultation, consents, token, onChanged,
}: { consultation: Consultation; consents: Consent[]; token: string; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [scope, setScope] = useState<ConsentScope[]>(defaultScope(consultation.input_method));
  const [evidenceRef, setEvidenceRef] = useState('');
  const [saving, setSaving] = useState<'given' | 'declined' | 'unknown' | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<Consent | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // One row per participant, showing only their LATEST decision — the full
  // record list (every decision ever made, with its own timestamp/notice
  // version/scope) stays available behind "View consent history" so nothing
  // is lost, it just isn't shown as if every historical entry were current.
  const byParticipant = new Map<string, Consent[]>();
  for (const item of consents) {
    const list = byParticipant.get(item.participant_name) || [];
    list.push(item);
    byParticipant.set(item.participant_name, list);
  }
  const current: Consent[] = Array.from(byParticipant.values()).map(
    list => list.slice().sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).slice(-1)[0],
  );
  const hasHistory = consents.length > current.length;

  // Drive messaging from the backend's own readiness computation (every
  // required participant's LATEST decision), not a local "any given?"
  // shortcut — a required participant's decline/unknown still blocks even
  // after someone else has already consented.
  const summary = consultation.consent_summary;
  const status = summary?.status ?? (consents.length === 0 ? 'not_started' : 'pending');

  const toggleScope = (s: ConsentScope) => {
    setScope(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]));
  };

  const submit = async (decision: 'given' | 'declined' | 'unknown') => {
    if (!name.trim()) { crossAlert('Name required', "Enter the participant's name."); return; }
    setSaving(decision);
    try {
      await apiPost(token, `/consultations/${consultation.id}/consent`, {
        participant_name: name.trim(),
        participant_role: role.trim() || null,
        decision,
        scope,
        consent_notice_version: CURRENT_CONSENT_NOTICE_VERSION,
        evidence_ref: evidenceRef.trim() || null,
      }, newIdempotencyKey());
      setName(''); setRole(''); setEvidenceRef('');
      setScope(defaultScope(consultation.input_method));
      onChanged();
    } catch (e: any) {
      crossAlert('Could not record consent', e?.message || 'Please try again.');
    }
    setSaving(null);
  };

  const continueManualOnly = () => {
    crossAlert(
      'Continue with manual notes only?',
      'Recording, audio upload and AI drafting stay switched off for this consultation. You can still type notes manually, but this cannot be undone for this consultation.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Continue manually',
          onPress: async () => {
            setContinuing(true);
            try {
              await apiPost(token, `/consultations/${consultation.id}/consent/continue-manual-only`, undefined, newIdempotencyKey());
              onChanged();
            } catch (e: any) {
              crossAlert('Could not continue', e?.message || 'Please try again.');
            }
            setContinuing(false);
          },
        },
      ],
    );
  };

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      await withdrawConsent(token, consultation.id, withdrawTarget.participant_name, newIdempotencyKey());
      setWithdrawTarget(null);
      onChanged();
    } catch (e: any) {
      crossAlert('Could not withdraw consent', e?.message || 'Please try again.');
    }
    setWithdrawing(false);
  };

  const renderConsentCard = (item: Consent, key: string) => {
    const isWithdrawn = item.decision === 'withdrawn';
    return (
      <View key={key} style={styles.consentRow}>
        <View style={styles.consentRowTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.consentName}>{item.participant_name}</Text>
            {!!item.participant_role && <Text style={styles.consentRole}>{item.participant_role}</Text>}
          </View>
          <View style={[
            styles.decisionBadge,
            item.decision === 'given' && styles.decisionGiven,
            (item.decision === 'declined' || isWithdrawn) && styles.decisionDeclined,
            item.decision === 'unknown' && styles.decisionUnknown,
          ]}>
            <Text style={[
              styles.decisionText,
              item.decision === 'given' && styles.decisionTextGiven,
              (item.decision === 'declined' || isWithdrawn) && styles.decisionTextDeclined,
              item.decision === 'unknown' && styles.decisionTextUnknown,
            ]}>
              {item.decision === 'given' ? 'Consent given'
                : item.decision === 'declined' ? 'Declined'
                : item.decision === 'unknown' ? 'Unknown'
                : 'Withdrawn'}
            </Text>
          </View>
        </View>

        <View style={styles.consentMetaRow}>
          {!!item.scope?.length && (
            <Text style={styles.consentMetaText}>Scope: {item.scope.map(s => SCOPE_LABELS[s] || s).join(', ')}</Text>
          )}
          {!!item.consent_notice_version && (
            <Text style={styles.consentMetaText}>Notice {item.consent_notice_version}</Text>
          )}
          <Text style={styles.consentMetaText}>{new Date(item.recorded_at).toLocaleString()}</Text>
        </View>
        {!!item.evidence_ref && <Text style={styles.consentMetaText}>Evidence: {item.evidence_ref}</Text>}

        {!isWithdrawn && (
          <Pressable style={styles.withdrawBtn} onPress={() => setWithdrawTarget(item)}>
            <Text style={styles.withdrawBtnText}>Withdraw consent</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Participant consent</Text>
      <Text style={styles.body}>
        Record whether each participant consents to this consultation being noted.
        Every required participant must grant consent before you can continue — a
        decline, an unknown/no-response, or a withdrawal from any one of them blocks
        the consultation.
      </Text>

      {current.length > 0 && (
        <View style={styles.list}>
          {current.map(item => renderConsentCard(item, item.id))}
        </View>
      )}

      {hasHistory && (
        <Pressable onPress={() => setHistoryOpen(o => !o)} style={styles.historyToggle}>
          <Text style={styles.historyToggleText}>
            {historyOpen ? 'Hide consent history' : `View consent history (${consents.length} record${consents.length === 1 ? '' : 's'})`}
          </Text>
        </Pressable>
      )}
      {historyOpen && (
        <View style={styles.historyBox}>
          {consents
            .slice()
            .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
            .map(item => renderConsentCard(item, `history-${item.id}`))}
        </View>
      )}

      <View style={styles.form}>
        <Text style={styles.fieldLabel}>Participant name *</Text>
        <TextInput
          style={styles.input} value={name} onChangeText={setName}
          placeholder="e.g. Priya Sharma" placeholderTextColor={c.muted}
        />
        <Text style={styles.fieldLabel}>Role (optional)</Text>
        <TextInput
          style={styles.input} value={role} onChangeText={setRole}
          placeholder="e.g. Client, Witness" placeholderTextColor={c.muted}
        />

        <Text style={styles.fieldLabel}>What are they consenting to?</Text>
        <View style={styles.scopeRow}>
          {CONSENT_SCOPE_OPTIONS.map(s => (
            <Pressable key={s} style={[styles.scopeChip, scope.includes(s) && styles.scopeChipActive]} onPress={() => toggleScope(s)}>
              <Text style={[styles.scopeChipText, scope.includes(s) && styles.scopeChipTextActive]}>{SCOPE_LABELS[s]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.noticeVersionHint}>Consent notice version: {CURRENT_CONSENT_NOTICE_VERSION}</Text>

        <Text style={styles.fieldLabel}>Evidence reference (optional)</Text>
        <TextInput
          style={styles.input} value={evidenceRef} onChangeText={setEvidenceRef}
          placeholder="e.g. Signed form filed as Exhibit A" placeholderTextColor={c.muted}
        />

        <View style={styles.actionRow}>
          <Pressable style={styles.declineBtn} onPress={() => submit('declined')} disabled={saving !== null}>
            {saving === 'declined' ? <ActivityIndicator color={c.error} size="small" /> : <Text style={styles.declineBtnText}>Declined</Text>}
          </Pressable>
          <Pressable style={styles.unknownBtn} onPress={() => submit('unknown')} disabled={saving !== null}>
            {saving === 'unknown' ? <ActivityIndicator color={c.muted} size="small" /> : <Text style={styles.unknownBtnText}>Unknown</Text>}
          </Pressable>
          <Pressable style={styles.giveBtn} onPress={() => submit('given')} disabled={saving !== null}>
            {saving === 'given' ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.giveBtnText}>Given</Text>}
          </Pressable>
        </View>
      </View>

      {status === 'blocked' && (
        <View style={styles.blockedBox}>
          <Text style={styles.blockedText}>
            {summary?.reason || 'A required participant has not consented. Resolve this before continuing.'}
          </Text>
          <Pressable style={styles.manualOnlyBtn} onPress={continueManualOnly} disabled={continuing}>
            {continuing
              ? <ActivityIndicator color={c.navy} size="small" />
              : <Text style={styles.manualOnlyBtnText}>Continue with manual notes only (no recording, no AI)</Text>}
          </Pressable>
        </View>
      )}

      {status === 'pending' && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{summary?.reason || 'Waiting for every required participant to respond before you can continue.'}</Text>
        </View>
      )}

      {status === 'not_started' && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>Record at least the first participant&apos;s decision to get started.</Text>
        </View>
      )}

      <ConfirmModal
        visible={!!withdrawTarget}
        title="Withdraw consent?"
        message={
          withdrawTarget
            ? `This withdraws consent for ${withdrawTarget.participant_name}. It halts further recording, upload and AI drafting for this consultation. Retention policy is not configured — any material already captured is left as is and is not deleted or modified.`
            : ''
        }
        confirmLabel="Withdraw consent"
        destructive
        loading={withdrawing}
        onCancel={() => setWithdrawTarget(null)}
        onConfirm={confirmWithdraw}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 4 },
  heading: { fontFamily: theme.fonts.display, fontSize: 20, color: c.navy, marginBottom: 6 },
  body: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20, marginBottom: 16 },
  list: { gap: 8, marginBottom: 16 },
  consentRow: {
    backgroundColor: c.surface,
    borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 12, gap: 6,
  },
  consentRowTop: { flexDirection: 'row', alignItems: 'center' },
  consentName: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  consentRole: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  decisionBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.surfaceSecondary },
  decisionGiven: { backgroundColor: '#E7F1EB' },
  decisionDeclined: { backgroundColor: '#FEE4E2' },
  decisionUnknown: { backgroundColor: '#FEF3C7' },
  decisionText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: c.muted },
  decisionTextGiven: { color: '#1F6B4A' },
  decisionTextDeclined: { color: c.error },
  decisionTextUnknown: { color: '#92400E' },
  consentMetaRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  consentMetaText: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted },
  withdrawBtn: { alignSelf: 'flex-start', marginTop: 2 },
  withdrawBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.error, textDecorationLine: 'underline' },
  form: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 16 },
  fieldLabel: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.muted, marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 10, padding: 12,
    fontFamily: theme.fonts.body, fontSize: 14, color: c.ink,
  },
  scopeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  scopeChip: { borderWidth: 1.5, borderColor: c.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  scopeChipActive: { backgroundColor: c.navy, borderColor: c.navy },
  scopeChipText: { fontFamily: theme.fonts.bodyMedium, fontSize: 12, color: c.muted },
  scopeChipTextActive: { color: '#fff' },
  noticeVersionHint: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  declineBtn: { flex: 1, borderWidth: 1.5, borderColor: c.error, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  declineBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.error },
  unknownBtn: { flex: 1, borderWidth: 1.5, borderColor: c.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  unknownBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.muted },
  giveBtn: { flex: 1, backgroundColor: c.navy, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  giveBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: '#fff' },
  noticeBox: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginTop: 16 },
  noticeText: { fontFamily: theme.fonts.body, fontSize: 12, color: '#92400E', lineHeight: 18 },
  blockedBox: { backgroundColor: '#FEE4E2', borderRadius: 10, padding: 12, marginTop: 16, gap: 10 },
  blockedText: { fontFamily: theme.fonts.body, fontSize: 12, color: c.error, lineHeight: 18 },
  manualOnlyBtn: { borderWidth: 1.5, borderColor: c.navy, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: c.surface },
  manualOnlyBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.navy, textAlign: 'center' },
});
