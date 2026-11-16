/**
 * Screen 4 — Consultation workspace. A single screen whose body swaps
 * between step components based on the backend state machine
 * (DRAFT → CONSENT_PENDING → READY → … → NOTE_DRAFT → APPROVED).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet, Modal } from 'react-native';
import { useFocusEffect, useLocalSearchParams, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useAuth, API_BASE } from '@/src/auth';
import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiGet, apiPatch } from '@/src/notetaker/api';
import { ScreenHeader, StatusPill, ProgressSteps, getStages, getStageIndex } from '@/src/notetaker/ui';
import type { Consultation, Consent } from '@/src/notetaker/api';

import ConsentStep from '@/src/notetaker/steps/ConsentStep';
import InputStep from '@/src/notetaker/steps/InputStep';
import AudioStep from '@/src/notetaker/steps/AudioStep';
import TranscriptStep from '@/src/notetaker/steps/TranscriptStep';
import NoteDraftStep from '@/src/notetaker/steps/NoteDraftStep';
import ApprovedStep from '@/src/notetaker/steps/ApprovedStep';

const c = theme.colors;

export default function ConsultationScreen() {
  // B-87: Advocate Consultation Notetaker is not scoped/hidden for Wave 1 --
  // same gate as B-97's advocate/lawyer screens.
  if (!ADVOCATE_MODE_ENABLED) return <Redirect href="/(tabs)/home" />;

  const { id } = useLocalSearchParams<{ id: string }>();
  const consultationId = String(id);
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [consentModalOpen, setConsentModalOpen] = useState(false);
  // Founder decision (BATCH N1): AI drafting, note approval and export are
  // blocked for advocates whose Bar Council verification is still pending.
  // Defaults to false (most restrictive) until the profile check resolves.
  const [advocateVerified, setAdvocateVerified] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!token || !consultationId) return;
    if (!silent) setLoading(true);
    try {
      const cdata = await apiGet<Consultation>(token, `/consultations/${consultationId}`);
      setConsultation(cdata);
      const consentsData = await apiGet<Consent[]>(token, `/consultations/${consultationId}/consent`);
      setConsents(consentsData);
    } catch {
      // keep any previously-loaded state visible on a transient error
    }
    setLoading(false);
  }, [token, consultationId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !token) return;
      try {
        const r = await fetch(`${API_BASE}/api/advocate/profile/${user.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && r.ok) {
          const profile = await r.json();
          setAdvocateVerified(!!profile?.verified);
        }
      } catch {
        // keep the restrictive default on a transient error
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, token]);

  // Poll while Whisper transcription runs in the background.
  useEffect(() => {
    if (consultation?.state !== 'PROCESSING') return;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [consultation?.state, load]);

  const hideActions = !!consultation && ['APPROVED', 'CANCELLED', 'FAILED', 'INTERRUPTED', 'CONSENT_WITHDRAWN'].includes(consultation.state);
  // A separate "Manage consent" entry point (on top of the main ConsentStep
  // body shown for DRAFT/CONSENT_PENDING) lets the advocate return to
  // consent at any later active stage — e.g. to add a late-joining
  // participant, whose fresh decision the backend re-checks against
  // readiness automatically. Not shown once APPROVED (consent isn't
  // re-opened retroactively there) or in a terminal state.
  const canManageConsent = !!consultation
    && !['DRAFT', 'CONSENT_PENDING', 'APPROVED', 'CANCELLED', 'FAILED', 'INTERRUPTED', 'CONSENT_WITHDRAWN'].includes(consultation.state);

  const confirmCancel = () => {
    if (!consultation || !token) return;
    crossAlert(
      'Cancel this consultation?',
      'This stops the current workflow. It cannot be resumed afterwards.',
      [
        { text: 'Keep working', style: 'cancel' },
        {
          text: 'Cancel consultation', style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await apiPatch(token, `/consultations/${consultation.id}/cancel`);
              await load(true);
            } catch (e: any) {
              crossAlert('Could not cancel', e?.message || 'Please try again.');
            }
            setCancelling(false);
          },
        },
      ],
    );
  };

  if (loading && !consultation) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Consultation" />
        <View style={styles.center}><ActivityIndicator color={c.navy} size="large" /></View>
      </View>
    );
  }

  if (!consultation || !token) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScreenHeader title="Consultation" />
        <View style={styles.center}>
          <Text style={styles.errorText}>Could not load this consultation.</Text>
        </View>
      </View>
    );
  }

  const stages = getStages(consultation.input_method);
  const activeIndex = getStageIndex(consultation.state, consultation.input_method);

  let body: React.ReactNode = null;
  switch (consultation.state) {
    case 'DRAFT':
    case 'CONSENT_PENDING':
      body = <ConsentStep consultation={consultation} consents={consents} token={token} onChanged={() => load(true)} />;
      break;
    case 'READY':
      body = <InputStep consultation={consultation} token={token} onChanged={() => load(true)} />;
      break;
    case 'IMPORTING':
      body = (
        <View style={styles.statusWrap}>
          <ActivityIndicator color={c.navy} size="large" />
          <Text style={styles.statusText}>Uploading audio…</Text>
        </View>
      );
      break;
    case 'AUDIO_REVIEW':
      body = <AudioStep consultation={consultation} token={token} onChanged={() => load(true)} />;
      break;
    case 'PROCESSING':
      body = (
        <View style={styles.statusWrap}>
          <ActivityIndicator color={c.navy} size="large" />
          <Text style={styles.statusText}>Transcribing audio…</Text>
          <Text style={styles.statusSub}>This can take a minute depending on the recording length.</Text>
        </View>
      );
      break;
    case 'TRANSCRIPT_REVIEW':
      body = <TranscriptStep consultation={consultation} token={token} onChanged={() => load(true)} />;
      break;
    case 'NOTE_DRAFT':
      body = <NoteDraftStep consultation={consultation} token={token} advocateVerified={advocateVerified} onChanged={() => load(true)} />;
      break;
    case 'APPROVED':
      body = <ApprovedStep consultation={consultation} token={token} advocateVerified={advocateVerified} onChanged={() => load(true)} />;
      break;
    case 'CONSENT_WITHDRAWN':
      body = (
        <View style={styles.statusWrap}>
          <Text style={styles.statusIcon}>🛑</Text>
          <Text style={styles.statusText}>Consent withdrawn</Text>
          <Text style={styles.statusSub}>
            A participant withdrew consent, so this consultation is closed. Recording, upload and AI
            drafting are switched off. Retention policy is not configured — any material already
            captured has not been deleted or modified.
          </Text>
        </View>
      );
      break;
    case 'FAILED':
      body = (
        <View style={styles.statusWrap}>
          <Text style={styles.statusIcon}>⚠️</Text>
          <Text style={styles.statusText}>Something went wrong</Text>
          <Text style={styles.statusSub}>{consultation.processing_error || 'An unexpected error occurred.'}</Text>
          <Pressable style={styles.cancelInlineBtn} onPress={confirmCancel}>
            <Text style={styles.cancelInlineBtnText}>Cancel this consultation</Text>
          </Pressable>
        </View>
      );
      break;
    case 'CANCELLED':
      body = (
        <View style={styles.statusWrap}>
          <Text style={styles.statusIcon}>🚫</Text>
          <Text style={styles.statusText}>Consultation cancelled</Text>
        </View>
      );
      break;
    case 'INTERRUPTED':
      body = (
        <View style={styles.statusWrap}>
          <Text style={styles.statusIcon}>⏸️</Text>
          <Text style={styles.statusText}>Transcription was interrupted</Text>
          <Pressable style={styles.cancelInlineBtn} onPress={confirmCancel}>
            <Text style={styles.cancelInlineBtnText}>Cancel this consultation</Text>
          </Pressable>
        </View>
      );
      break;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title={consultation.title}
        subtitle={consultation.date}
        right={(
          <View style={styles.headerActions}>
            {canManageConsent && (
              <Pressable onPress={() => setConsentModalOpen(true)} style={styles.consentBtn} accessibilityLabel="Manage consent">
                <Text style={styles.consentBtnText}>Consent</Text>
              </Pressable>
            )}
            {!hideActions && (
              <Pressable onPress={confirmCancel} style={styles.cancelBtn} disabled={cancelling} accessibilityLabel="Cancel consultation">
                {cancelling ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.cancelBtnText}>Cancel</Text>}
              </Pressable>
            )}
          </View>
        )}
      />
      <View style={styles.statusRow}>
        <StatusPill state={consultation.state} />
        {!!consultation.legacy_consent_incomplete && (
          <View style={styles.legacyPill}>
            <Text style={styles.legacyPillText}>Consent incomplete (legacy)</Text>
          </View>
        )}
      </View>
      {!hideActions && <ProgressSteps labels={stages} activeIndex={activeIndex} />}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>

      <Modal visible={consentModalOpen} animationType="slide" onRequestClose={() => setConsentModalOpen(false)}>
        <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <ScreenHeader
            title="Manage consent"
            subtitle={consultation.title}
            right={(
              <Pressable onPress={() => setConsentModalOpen(false)} style={styles.consentBtn} accessibilityLabel="Done">
                <Text style={styles.consentBtnText}>Done</Text>
              </Pressable>
            )}
          />
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <ConsentStep consultation={consultation} consents={consents} token={token} onChanged={() => load(true)} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: c.error, fontFamily: theme.fonts.body, fontSize: 15 },
  statusRow: { paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  legacyPill: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  legacyPillText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: '#92400E' },
  statusWrap: { alignItems: 'center', padding: 40, gap: 10 },
  statusIcon: { fontSize: 40 },
  statusText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 17, color: c.navy, textAlign: 'center' },
  statusSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, textAlign: 'center', lineHeight: 19 },
  cancelBtn: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  cancelBtnText: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  headerActions: { flexDirection: 'row', gap: 8 },
  consentBtn: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  consentBtnText: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  cancelInlineBtn: { marginTop: 10, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: c.error },
  cancelInlineBtnText: { color: c.error, fontFamily: theme.fonts.bodySemiBold, fontSize: 14 },
});
