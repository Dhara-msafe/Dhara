/**
 * S3 — Guardian Journey Engine (SMS + status page)
 *
 * Feature flag: EXPO_PUBLIC_GUARDIAN_SHARE=true
 *
 * Phase 2 addition:
 *   Before sending SMS, creates a backend journey record that returns a
 *   short public URL ({host}/api/journey/status/{token}). The URL is
 *   appended to the SMS so the guardian can check real-time status in any
 *   browser without the app.
 *
 * Nothing is sent automatically; the user always controls every send.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  Linking, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useAuth } from '@/src/auth';
import { API_BASE } from '@/src/apiBase';
import { getCircle, type Contact } from '@/src/women/api';

const c = theme.colors;

function formatDeadline(startTime: number, durationMins: number): string {
  const deadline = new Date(startTime + durationMins * 60 * 1000);
  return deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function GuardianShare() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { token: authToken } = useAuth();

  const params = useLocalSearchParams<{
    destination?: string;
    startTime?: string;
    durationMins?: string;
    journeyToken?: string;    // GO1B: pre-created token from head-out.tsx (when GPS is active)
  }>();

  const destination  = params.destination ?? '';
  const startTime    = parseInt(params.startTime   ?? '0',  10);
  const durationMins = parseInt(params.durationMins ?? '60', 10);
  // If a journey was already created in head-out.tsx (GO1B GPS on), reuse it
  const preCreatedToken = params.journeyToken || null;

  const [circle,       setCircle]       = useState<Contact[]>([]);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [sent,         setSent]         = useState(false);
  const [loading,      setLoading]      = useState(true);

  // Phase 2 state — seed with pre-created token from GPS session if available
  const [statusUrl,    setStatusUrl]    = useState<string | null>(null);
  const [journeyToken, setJourneyToken] = useState<string | null>(preCreatedToken);
  const [creating,     setCreating]     = useState(false);
  const [markingSafe,  setMarkingSafe]  = useState(false);
  const [markedSafe,   setMarkedSafe]   = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);
  // Guardian-link revocation follow-up: owner can withdraw sharing without
  // claiming arrival — distinct action/state from "mark safe" above.
  const [revoking,     setRevoking]     = useState(false);
  const [revoked,      setRevoked]      = useState(false);

  const checkInBy = startTime > 0 ? formatDeadline(startTime, durationMins) : `${durationMins} min`;

  useEffect(() => {
    getCircle()
      .then(contacts => {
        setCircle(contacts);
        setSelected(new Set(contacts.filter(ct => ct.notify !== false).map(ct => ct.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // If journey was pre-created in head-out.tsx, build the status URL immediately
    if (preCreatedToken) {
      setStatusUrl(`${API_BASE}/api/journey/status/${preCreatedToken}`);
    }
  }, [preCreatedToken]);

  const toggleContact = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /** Create journey record on backend → get public status URL (skipped if already created) */
  const createJourneyRecord = useCallback(async (): Promise<string | null> => {
    // Reuse existing token (pre-created from head-out GPS session)
    if (statusUrl) return statusUrl;
    if (!authToken || !destination) return null;
    try {
      setCreating(true);
      setCreateError(null);
      const r = await fetch(`${API_BASE}/api/journey/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          destination: destination || 'a location',
          duration_mins: durationMins || 60,
        }),
      });
      if (!r.ok) throw new Error('Could not create status page');
      const data = await r.json();
      const url = `${API_BASE}${data.status_url}`;
      setStatusUrl(url);
      setJourneyToken(data.token);
      return url;
    } catch {
      setCreateError('Status link unavailable — SMS will be sent without it.');
      return null;
    } finally {
      setCreating(false);
    }
  }, [authToken, destination, durationMins]);

  const buildMessage = useCallback((pageUrl?: string | null) => {
    const dest = destination || 'a location';
    const link = pageUrl
      ? `\n\nTrack my journey live: ${pageUrl}`
      : '';
    return (
      `Hi, I'm heading to ${dest}. I plan to check in by ${checkInBy}.${link}\n\n` +
      `If you don't hear from me by then, please call me to confirm I'm safe.\n\n` +
      `(Sent via DHARA legal aid app)`
    );
  }, [destination, checkInBy]);

  const sendSMS = useCallback(async () => {
    const phones = circle
      .filter(ct => selected.has(ct.id))
      .map(ct => ct.phone)
      .join(',');
    if (!phones) return;

    // Phase 2: create backend record first (or reuse existing)
    const pageUrl = statusUrl ?? await createJourneyRecord();
    const body = buildMessage(pageUrl);

    Linking.openURL(`sms:${phones}?body=${encodeURIComponent(body)}`).catch(() =>
      Linking.openURL(`sms:&body=${encodeURIComponent(body)}`).catch(() => {}),
    );
    setSent(true);
  }, [circle, selected, statusUrl, createJourneyRecord, buildMessage]);

  const markSafe = useCallback(async () => {
    if (!journeyToken || !authToken) return;
    setMarkingSafe(true);
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/safe`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (r.ok) setMarkedSafe(true);
    } catch {
      // non-critical — silently fail
    } finally {
      setMarkingSafe(false);
    }
  }, [journeyToken, authToken]);

  /** Owner withdraws sharing — distinct from markSafe: no claim of arrival,
   * just "stop showing anyone anything new from this link". Takes effect
   * immediately for every holder of the status link (direct or forwarded)
   * since the backend strips location on every page read once this is set. */
  const revokeSharing = useCallback(async () => {
    if (!journeyToken || !authToken) return;
    setRevoking(true);
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (r.ok) setRevoked(true);
    } catch {
      // non-critical — silently fail
    } finally {
      setRevoking(false);
    }
  }, [journeyToken, authToken]);

  const selectedCount = selected.size;
  const canSend = selectedCount > 0 && !loading && !creating;

  if (loading) return null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      testID="guardian-share-screen"
    >
      <ScreenHeader
        title="Notify your guardian"
        subtitle="Send a journey update — nothing is sent automatically"
      />

      {/* Journey preview card */}
      <View style={styles.journeyCard}>
        <View style={styles.journeyRow}>
          <Ionicons name="navigate-circle-outline" size={20} color={c.navy} />
          <Text style={styles.journeyTxt}>{destination || 'Destination not set'}</Text>
        </View>
        <View style={styles.journeyRow}>
          <Ionicons name="time-outline" size={20} color={c.navy} />
          <Text style={styles.journeyTxt}>Check-in by {checkInBy}</Text>
        </View>
        {statusUrl && (
          <View style={styles.journeyRow}>
            <Ionicons name="link-outline" size={20} color={c.verifiedGreen ?? '#16a34a'} />
            <Text style={[styles.journeyTxt, { color: c.verifiedGreen ?? '#16a34a', fontSize: 12 }]}>
              Status page ready — link added to SMS
            </Text>
          </View>
        )}
      </View>

      {/* Contact selector */}
      <Text style={styles.sectionLabel}>Choose who to notify</Text>

      {circle.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="people-outline" size={28} color={c.muted} />
          <Text style={styles.emptyTxt}>Your trusted circle is empty. Add contacts first.</Text>
          <Pressable
            testID="guardian-add-circle"
            onPress={() => router.push('/women/trusted-circle')}
            accessibilityRole="button"
            accessibilityLabel="Set up trusted circle"
          >
            <Text style={styles.linkTxt}>Set up trusted circle →</Text>
          </Pressable>
        </View>
      ) : (
        circle.map(ct => (
          <Pressable
            key={ct.id}
            style={[styles.contactRow, selected.has(ct.id) && styles.contactRowSelected]}
            onPress={() => toggleContact(ct.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected.has(ct.id) }}
            accessibilityLabel={`${ct.name}, ${ct.phone}`}
            testID={`guardian-contact-${ct.id}`}
          >
            <View style={[styles.avatar, selected.has(ct.id) && styles.avatarSelected]}>
              {selected.has(ct.id)
                ? <Ionicons name="checkmark" size={16} color="#fff" />
                : <Text style={styles.avatarTxt}>{ct.name.charAt(0).toUpperCase()}</Text>
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>{ct.name}</Text>
              <Text style={styles.contactPhone}>{ct.phone}</Text>
            </View>
          </Pressable>
        ))
      )}

      {/* Message preview */}
      <View style={styles.messagePreview}>
        <Text style={styles.previewLabel}>Message preview</Text>
        <Text style={styles.previewBody}>
          {buildMessage(statusUrl ?? '[status link will be added]')}
        </Text>
      </View>

      {createError && (
        <Text style={styles.errorTxt}>{createError}</Text>
      )}

      {/* Send button */}
      <Pressable
        testID="guardian-send"
        style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
        disabled={!canSend}
        onPress={sendSMS}
        accessibilityRole="button"
        accessibilityLabel={`Send journey update to ${selectedCount} contact${selectedCount === 1 ? '' : 's'}`}
      >
        {creating
          ? <ActivityIndicator color="#fff" size="small" />
          : <Ionicons name="chatbubble-outline" size={18} color="#fff" />
        }
        <Text style={styles.sendBtnTxt}>
          {creating ? 'Preparing…' : sent ? 'Send again' : `Send to ${selectedCount} contact${selectedCount === 1 ? '' : 's'}`}
        </Text>
      </Pressable>

      {sent && (
        <View style={styles.sentBanner} testID="guardian-sent-banner">
          <Ionicons name="checkmark-circle-outline" size={18} color={c.verifiedGreen} />
          <Text style={styles.sentTxt}>SMS app opened — your guardian has been notified.</Text>
        </View>
      )}

      {/* Mark safe — shown after SMS is sent. Deliberately available even
          after "Withdraw sharing" was already used: revoking never claimed
          anything about arrival, so there is nothing to protect by hiding
          this — see journey_router.py::mark_safe() for the matching
          backend-side independence. */}
      {sent && journeyToken && !markedSafe && (
        <Pressable
          testID="guardian-mark-safe"
          style={styles.safeBtn}
          onPress={markSafe}
          disabled={markingSafe}
          accessibilityRole="button"
          accessibilityLabel="I have arrived safely"
        >
          {markingSafe
            ? <ActivityIndicator color={c.navy} size="small" />
            : <Ionicons name="shield-checkmark-outline" size={18} color={c.navy} />
          }
          <Text style={styles.safeBtnTxt}>
            {markingSafe ? 'Updating\u2026' : 'I have arrived safely \u2014 update my guardian'}
          </Text>
        </Pressable>
      )}

      {markedSafe && revoked && (
        <View style={styles.safeBanner} testID="guardian-safe-banner">
          <Ionicons name="shield-checkmark" size={18} color="#16a34a" />
          <Text style={styles.safeBannerTxt}>
            {'Status page updated \u2014 arrived safely. Sharing had already been turned off, so no location was shown for this update.'}
          </Text>
        </View>
      )}
      {markedSafe && !revoked && (
        <View style={styles.safeBanner} testID="guardian-safe-banner">
          <Ionicons name="shield-checkmark" size={18} color="#16a34a" />
          <Text style={styles.safeBannerTxt}>
            {'Status page updated \u2014 your guardian can see you are safe.'}
          </Text>
        </View>
      )}

      {/* Withdraw sharing — shown after SMS is sent, available independently
          of "I have arrived safely"; hidden once used (can't revoke twice)
          or once already marked safe (location is already hidden by then,
          so revoking adds nothing). The warning below is required reading
          BEFORE tapping — withdrawing also turns off the missed-check-in
          safety escalation tied to this same link (see journey_router.py's
          report_missed_checkin() docstring for why that is intentional). */}
      {sent && journeyToken && !markedSafe && !revoked && (
        <View style={styles.revokeSection}>
          <Text style={styles.revokeWarningTxt}>
            Note: if you withdraw sharing, your guardian will NOT be notified even if you miss your check-in — the missed-check-in alert is tied to this same link.
          </Text>
          <Pressable
            testID="guardian-revoke-sharing"
            style={styles.revokeSharingBtn}
            onPress={revokeSharing}
            disabled={revoking}
            accessibilityRole="button"
            accessibilityLabel="Withdraw location sharing for this link"
          >
            {revoking
              ? <ActivityIndicator color={c.error ?? '#dc2626'} size="small" />
              : <Ionicons name="lock-closed-outline" size={18} color={c.error ?? '#dc2626'} />
            }
            <Text style={styles.revokeSharingBtnTxt}>
              {revoking ? 'Withdrawing\u2026' : 'Withdraw sharing for this link'}
            </Text>
          </Pressable>
        </View>
      )}

      {revoked && (
        <View style={styles.revokedBanner} testID="guardian-revoked-banner">
          <Ionicons name="lock-closed" size={18} color={c.error ?? '#dc2626'} />
          <Text style={styles.revokedBannerTxt}>
            Sharing withdrawn — the status link no longer shows your location to anyone, including anyone it was forwarded to. Missed-check-in alerts for this link are also off now; you can still tap &ldquo;I have arrived safely&rdquo; below at any time.
          </Text>
        </View>
      )}

      <Text style={styles.disclosureNote}>
        Nothing is sent automatically. DHARA opens your SMS app with a pre-filled message; you control every send. Status pages expire after 24 hours.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 16 },
  journeyCard: {
    backgroundColor: c.surface, borderRadius: 14, borderWidth: 1,
    borderColor: c.lines, padding: 16, gap: 10,
  },
  journeyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  journeyTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  sectionLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginTop: 4 },
  emptyCard: {
    backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines,
    padding: 20, gap: 10, alignItems: 'center',
  },
  emptyTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, textAlign: 'center' },
  linkTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: c.surface, borderRadius: 14, borderWidth: 1.5, borderColor: c.lines,
  },
  contactRowSelected: { borderColor: c.navy, backgroundColor: c.navySoft },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: c.navySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSelected: { backgroundColor: c.navy },
  avatarTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  contactName: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  contactPhone: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2 },
  messagePreview: {
    backgroundColor: c.surfaceTertiary ?? '#F4F4F6', borderRadius: 12,
    borderWidth: 1, borderColor: c.lines, padding: 14, gap: 6,
  },
  previewLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  previewBody: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 20 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
  sentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F0FFF4', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: c.verifiedGreen,
  },
  sentTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, flex: 1 },
  safeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.navySoft, borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: c.navy,
  },
  safeBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  safeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F0FFF4', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#16a34a',
  },
  safeBannerTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, flex: 1 },
  revokeSection: { gap: 8 },
  revokeWarningTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17, paddingHorizontal: 4 },
  revokeSharingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FCEBE9', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: c.error ?? '#dc2626',
  },
  revokeSharingBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.error ?? '#dc2626' },
  revokedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FCEBE9', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: c.error ?? '#dc2626',
  },
  revokedBannerTxt: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, flex: 1, lineHeight: 19 },
  errorTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: '#dc2626', textAlign: 'center' },
  disclosureNote: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    textAlign: 'center', lineHeight: 18,
  },
});
