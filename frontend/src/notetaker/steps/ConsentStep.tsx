/**
 * ConsentStep — rendered while a consultation is in DRAFT or CONSENT_PENDING.
 * Records per-participant consent. The backend only transitions to READY
 * once every *required* participant's latest decision is 'given'; a
 * decline/unknown on any required participant blocks (or demotes back to)
 * CONSENT_PENDING, and offers "continue with manual notes only" as the
 * documented way to proceed without recording or AI drafting.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiPost, newIdempotencyKey } from '../api';
import type { Consultation, Consent } from '../api';

const c = theme.colors;

export default function ConsentStep({
  consultation, consents, token, onChanged,
}: { consultation: Consultation; consents: Consent[]; token: string; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState<'given' | 'declined' | null>(null);
  const [continuing, setContinuing] = useState(false);

  // Drive messaging from the backend's own readiness computation (every
  // required participant's LATEST decision), not a local "any given?"
  // shortcut — a required participant's decline/unknown still blocks even
  // after someone else has already consented.
  const summary = consultation.consent_summary;
  const status = summary?.status ?? (consents.length === 0 ? 'not_started' : 'pending');

  const submit = async (decision: 'given' | 'declined') => {
    if (!name.trim()) { Alert.alert('Name required', "Enter the participant's name."); return; }
    setSaving(decision);
    try {
      await apiPost(token, `/consultations/${consultation.id}/consent`, {
        participant_name: name.trim(),
        participant_role: role.trim() || null,
        decision,
      }, newIdempotencyKey());
      setName(''); setRole('');
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not record consent', e?.message || 'Please try again.');
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
              Alert.alert('Could not continue', e?.message || 'Please try again.');
            }
            setContinuing(false);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Participant consent</Text>
      <Text style={styles.body}>
        Record whether each participant consents to this consultation being noted.
        Every required participant must grant consent before you can continue — a
        decline or no-response from any one of them blocks the consultation.
      </Text>

      {consents.length > 0 && (
        <View style={styles.list}>
          {consents.map(item => (
            <View key={item.id} style={styles.consentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.consentName}>{item.participant_name}</Text>
                {!!item.participant_role && <Text style={styles.consentRole}>{item.participant_role}</Text>}
              </View>
              <View style={[
                styles.decisionBadge,
                item.decision === 'given' && styles.decisionGiven,
                (item.decision === 'declined' || item.decision === 'withdrawn') && styles.decisionDeclined,
              ]}>
                <Text style={[
                  styles.decisionText,
                  item.decision === 'given' && styles.decisionTextGiven,
                  (item.decision === 'declined' || item.decision === 'withdrawn') && styles.decisionTextDeclined,
                ]}>
                  {item.decision === 'given' ? 'Consent given' : item.decision === 'declined' ? 'Declined' : 'Withdrawn'}
                </Text>
              </View>
            </View>
          ))}
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
        <View style={styles.actionRow}>
          <Pressable style={styles.declineBtn} onPress={() => submit('declined')} disabled={saving !== null}>
            {saving === 'declined' ? <ActivityIndicator color={c.error} size="small" /> : <Text style={styles.declineBtnText}>Record declined</Text>}
          </Pressable>
          <Pressable style={styles.giveBtn} onPress={() => submit('given')} disabled={saving !== null}>
            {saving === 'given' ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.giveBtnText}>Record consent given</Text>}
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
          <Text style={styles.noticeText}>Record at least the first participant's decision to get started.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 4 },
  heading: { fontFamily: theme.fonts.display, fontSize: 20, color: c.navy, marginBottom: 6 },
  body: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20, marginBottom: 16 },
  list: { gap: 8, marginBottom: 16 },
  consentRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface,
    borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 12,
  },
  consentName: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  consentRole: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  decisionBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.surfaceSecondary },
  decisionGiven: { backgroundColor: '#E7F1EB' },
  decisionDeclined: { backgroundColor: '#FEE4E2' },
  decisionText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: c.muted },
  decisionTextGiven: { color: '#1F6B4A' },
  decisionTextDeclined: { color: c.error },
  form: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 16 },
  fieldLabel: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.muted, marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 10, padding: 12,
    fontFamily: theme.fonts.body, fontSize: 14, color: c.ink,
  },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  declineBtn: { flex: 1, borderWidth: 1.5, borderColor: c.error, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  declineBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.error },
  giveBtn: { flex: 1.3, backgroundColor: c.navy, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  giveBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: '#fff' },
  noticeBox: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginTop: 16 },
  noticeText: { fontFamily: theme.fonts.body, fontSize: 12, color: '#92400E', lineHeight: 18 },
  blockedBox: { backgroundColor: '#FEE4E2', borderRadius: 10, padding: 12, marginTop: 16, gap: 10 },
  blockedText: { fontFamily: theme.fonts.body, fontSize: 12, color: c.error, lineHeight: 18 },
  manualOnlyBtn: { borderWidth: 1.5, borderColor: c.navy, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: c.surface },
  manualOnlyBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.navy, textAlign: 'center' },
});
