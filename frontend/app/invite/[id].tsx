import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { getInvitation, respondInvitation, muteCircle, leaveCircle, InviteLink } from '@/src/trustedCircle/api';

const c = theme.colors;

const PERM_LABEL: Record<string, string> = {
  journey_status: 'Journey status updates',
  expected_arrival: 'Expected arrival time',
  missed_checkin: 'Missed check-in alerts',
  temp_location: 'Temporary location (only while a journey is active)',
  emergency_requests: 'Emergency help requests',
};

export default function InviteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const [link, setLink] = useState<InviteLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token || !id) return;
    setLink(await getInvitation(token, id));
    setLoading(false);
  }
  useEffect(() => { load(); }, [token, id]);

  async function respond(action: 'accept' | 'decline') {
    if (!token || !id) return;
    setBusy(true);
    try { await respondInvitation(token, id, action); await load(); } finally { setBusy(false); }
  }
  async function onMuteToggle(v: boolean) {
    if (!token || !id) return;
    await muteCircle(token, id, v);
    setLink((l) => (l ? { ...l, muted: v } : l));
  }
  async function onLeave() {
    if (!token || !id) return;
    setBusy(true);
    try { await leaveCircle(token, id); router.back(); } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Trusted Circle invitation" />
        <View style={styles.center}><ActivityIndicator color={c.navy} /></View>
      </SafeAreaView>
    );
  }
  if (!link) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Trusted Circle invitation" />
        <View style={styles.center}><Text style={styles.hint}>This invitation could not be found.</Text></View>
      </SafeAreaView>
    );
  }

  const perms = link.permissions || ({} as any);
  const accepted = link.status === 'accepted';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['bottom']}>
      <ScreenHeader title="Trusted Circle invitation" />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.banner}>
          <Ionicons name="people-circle-outline" size={28} color={c.navy} />
          <Text style={styles.bannerTxt}>{link.owner_name} wants to add you to their Trusted Circle.</Text>
        </View>

        <Text style={styles.sectionTitle}>They are requesting permission to share:</Text>
        <View style={styles.permCard}>
          {Object.entries(PERM_LABEL).map(([key, label]) => (perms as any)[key] ? (
            <View key={key} style={styles.permRow}>
              <Ionicons name="checkmark-circle" size={16} color={c.success} />
              <Text style={styles.permTxt}>{label}</Text>
            </View>
          ) : null)}
        </View>

        <Text style={styles.disclaimer}>
          Accepting is voluntary and you can leave at any time. This invitation alone does not prove this person's identity — only accept if you know them.
        </Text>

        {link.status === 'pending' && (
          <View style={styles.actionsRow}>
            <Pressable style={styles.declineBtn} onPress={() => respond('decline')} disabled={busy} testID="invite-decline">
              <Text style={styles.declineBtnTxt}>Decline</Text>
            </Pressable>
            <Pressable style={styles.acceptBtn} onPress={() => respond('accept')} disabled={busy} testID="invite-accept">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptBtnTxt}>Accept</Text>}
            </Pressable>
          </View>
        )}

        {link.status === 'declined' && <Text style={styles.statusTxt}>You declined this invitation.</Text>}
        {link.status === 'left' && <Text style={styles.statusTxt}>You left this Trusted Circle.</Text>}
        {link.status === 'revoked' && <Text style={styles.statusTxt}>{link.owner_name} has revoked this connection.</Text>}

        {accepted && (
          <View style={styles.manageCard}>
            <Text style={styles.sectionTitle}>Notification preferences</Text>
            <View style={styles.muteRow}>
              <Text style={styles.permTxt}>Mute routine journey updates</Text>
              <Switch value={link.muted} onValueChange={onMuteToggle} testID="invite-mute-switch" accessibilityLabel="Mute routine journey updates" />
            </View>
            <Pressable style={styles.leaveBtn} onPress={onLeave} disabled={busy} testID="invite-leave">
              <Text style={styles.leaveBtnTxt}>Leave this Trusted Circle</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted },
  banner: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: c.surfaceSecondary, borderRadius: 16, padding: 16, marginBottom: 20 },
  bannerTxt: { flex: 1, fontFamily: theme.fonts.bodyMedium, fontSize: 15, color: c.navy, lineHeight: 21 },
  sectionTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy, marginBottom: 8, marginTop: 4 },
  permCard: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, gap: 10, marginBottom: 16 },
  permRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  permTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, flex: 1 },
  disclaimer: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17, marginBottom: 20 },
  actionsRow: { flexDirection: 'row', gap: 12 },
  declineBtn: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: 999, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  declineBtnTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  acceptBtn: { flex: 1, backgroundColor: c.navy, borderRadius: 999, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  acceptBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  statusTxt: { fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.muted, textAlign: 'center', marginTop: 10 },
  manageCard: { marginTop: 24, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 20 },
  muteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, marginBottom: 14 },
  leaveBtn: { backgroundColor: '#FCEBE9', borderRadius: 999, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  leaveBtnTxt: { color: c.error, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
});
