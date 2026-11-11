/**
 * ConsentStep — rendered while a consultation is in DRAFT or CONSENT_PENDING.
 * Records per-participant consent. The backend auto-transitions the
 * consultation to READY the moment at least one 'given' consent exists.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { theme } from '@/src/theme';
import { apiPost } from '../api';
import type { Consultation, Consent } from '../api';

const c = theme.colors;

export default function ConsentStep({
  consultation, consents, token, onChanged,
}: { consultation: Consultation; consents: Consent[]; token: string; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState<'given' | 'declined' | null>(null);

  const hasGiven = consents.some(x => x.decision === 'given');

  const submit = async (decision: 'given' | 'declined') => {
    if (!name.trim()) { Alert.alert('Name required', "Enter the participant's name."); return; }
    setSaving(decision);
    try {
      await apiPost(token, `/consultations/${consultation.id}/consent`, {
        participant_name: name.trim(),
        participant_role: role.trim() || null,
        decision,
      });
      setName(''); setRole('');
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not record consent', e?.message || 'Please try again.');
    }
    setSaving(null);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Participant consent</Text>
      <Text style={styles.body}>
        Record whether each participant consents to this consultation being noted.
        At least one participant must give consent before you can continue.
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

      {!hasGiven && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>Waiting for at least one participant to give consent before you can continue.</Text>
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
});
