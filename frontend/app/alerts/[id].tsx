import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { AlertLocationMap } from '@/src/components/dhara/AlertLocationMap';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { getAlert, markAlertRead, ackAlert, SafetyAlert } from '@/src/trustedCircle/api';

import { openExternal } from '@/src/outbound';
const c = theme.colors;

const PRIMARY_MSG: Record<string, (owner: string) => string> = {
  missed_checkin:       (n) => `${n} hasn't responded to a scheduled check-in.`,
  help_requested:        (n) => `${n} asked for help during their journey.`,
  journey_started:       (n) => `${n} started a journey and shared it with you.`,
  journey_completed:     (n) => `${n} completed their journey safely.`,
  arrival_confirmed:     (n) => `${n} confirmed they arrived.`,
  location_unavailable:  (n) => `${n}'s location is temporarily unavailable.`,
  sharing_ended:         (n) => `${n} has stopped sharing this journey with you.`,
  journey_status:        (n) => `Update on ${n}'s journey.`,
};

export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [alert, setAlert] = useState<SafetyAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token || !id) return;
      const a = await getAlert(token, id);
      setAlert(a);
      setLoading(false);
      if (a) await markAlertRead(token, id);
    })();
  }, [token, id]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Journey safety alert" />
        <View style={styles.center}><ActivityIndicator color={c.navy} /></View>
      </SafeAreaView>
    );
  }
  if (!alert) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Journey safety alert" />
        <View style={styles.center}><Text style={styles.hint}>This alert could not be found.</Text></View>
      </SafeAreaView>
    );
  }

  const perms: Partial<NonNullable<SafetyAlert['permissions']>> = alert.permissions || {};
  const loc = alert.payload?.last_location;
  const revoked = alert.access_revoked;
  const locationShared = !revoked && perms.temp_location && loc && loc.area;

  async function onCall() {
    const phone = (alert as any).owner_phone;
    if (phone) openExternal(`tel:${phone}`);
  }
  async function onMessage() {
    const phone = (alert as any).owner_phone;
    if (phone) openExternal(`sms:${phone}`);
  }
  function onOpenMaps() {
    if (!loc?.lat || !loc?.lng) return;
    openExternal(`https://maps.google.com/?q=${loc.lat},${loc.lng}`);
  }
  async function onAck() {
    if (!token) return;
    setAcking(true);
    try { await ackAlert(token, id as string); setAlert(alert && { ...alert, state: 'ACKNOWLEDGED', acknowledged_at: new Date().toISOString() }); } finally { setAcking(false); }
  }

  const msgFn = PRIMARY_MSG[alert.type] || PRIMARY_MSG.journey_status;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['bottom']}>
      <ScreenHeader title="Journey safety alert" />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={[styles.banner, URGENT_SET.has(alert.type) ? styles.bannerUrgent : styles.bannerNeutral]}>
          <Text style={styles.bannerTitle}>{alert.title}</Text>
          <Text style={styles.bannerBody}>{msgFn(alert.owner_name)}</Text>
        </View>

        {alert.type === 'missed_checkin' && (
          <View style={styles.noteBox}>
            <Ionicons name="information-circle-outline" size={16} color={c.navy} />
            <Text style={styles.noteTxt}>This doesn't necessarily mean the person is in danger. You can try contacting them.</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Journey status</Text>
          <Text style={styles.cardVal}>{revoked ? 'No longer shared with you' : (alert.payload?.journey_status || '—')}</Text>
          {!!alert.payload?.destination && !revoked && (
            <>
              <Text style={styles.cardLabel}>Destination</Text>
              <Text style={styles.cardVal}>{alert.payload.destination}</Text>
            </>
          )}
          <Text style={styles.cardLabel}>Last update</Text>
          <Text style={styles.cardVal}>{new Date(alert.created_at).toLocaleString()}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Location</Text>
          {revoked ? (
            <Text style={styles.cardVal}>Location sharing has ended.</Text>
          ) : locationShared ? (
            <>
              <Text style={styles.cardVal}>{loc.area}</Text>
              <Text style={styles.hint}>Last known location — not necessarily current. Accuracy: {loc.accuracy || 'unknown'} · {loc.age_minutes != null ? `${loc.age_minutes} min ago` : ''}</Text>
              {!!(loc.lat && loc.lng) && (
                <AlertLocationMap lat={loc.lat} lng={loc.lng} accuracyMeters={loc.accuracy} />
              )}
              {!!(loc.lat && loc.lng) && (
                <Pressable onPress={onOpenMaps} style={styles.linkRow} testID="alert-open-maps">
                  <Ionicons name="map-outline" size={16} color={c.navy} />
                  <Text style={styles.linkTxt}>Open in Maps</Text>
                </Pressable>
              )}
            </>
          ) : alert.payload && Object.keys(alert.payload).length ? (
            <Text style={styles.cardVal}>Location not shared — only journey status was authorized.</Text>
          ) : (
            <Text style={styles.cardVal}>Location temporarily unavailable.</Text>
          )}
        </View>

        <View style={styles.actionsCol}>
          <Pressable style={styles.actionBtn} onPress={onCall} disabled={!(alert as any).owner_phone} testID="alert-call">
            <Ionicons name="call-outline" size={18} color="#fff" />
            <Text style={styles.actionBtnTxt}>Call {alert.owner_name}</Text>
          </Pressable>
          <Pressable style={styles.actionBtnSecondary} onPress={onMessage} disabled={!(alert as any).owner_phone} testID="alert-message">
            <Ionicons name="chatbubble-outline" size={18} color={c.navy} />
            <Text style={styles.actionBtnSecondaryTxt}>Send message</Text>
          </Pressable>
          <Pressable style={styles.actionBtnSecondary} onPress={onAck} disabled={acking || !!alert.acknowledged_at} testID="alert-ack">
            <Ionicons name="checkmark-done-outline" size={18} color={c.navy} />
            <Text style={styles.actionBtnSecondaryTxt}>{alert.acknowledged_at ? 'Acknowledged' : 'Acknowledge alert'}</Text>
          </Pressable>
          <Text style={styles.disclaimer}>Acknowledging only records that you saw this — it doesn't confirm {alert.owner_name} is safe.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const URGENT_SET = new Set(['missed_checkin', 'help_requested', 'location_unavailable']);

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 6, lineHeight: 17 },
  banner: { borderRadius: 16, padding: 16, marginBottom: 16 },
  bannerUrgent: { backgroundColor: '#FCEBE9' },
  bannerNeutral: { backgroundColor: c.surfaceSecondary },
  bannerTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.navy, marginBottom: 4 },
  bannerBody: { fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.ink },
  noteBox: { flexDirection: 'row', gap: 8, backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 12, marginBottom: 16 },
  noteTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.navy, lineHeight: 17 },
  card: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 14 },
  cardLabel: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: c.muted, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  cardVal: { fontFamily: theme.fonts.bodyMedium, fontSize: 15, color: c.ink, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  linkTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  actionsCol: { gap: 10, marginTop: 4 },
  actionBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.navy, borderRadius: 999, minHeight: 48 },
  actionBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  actionBtnSecondary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceSecondary, borderRadius: 999, minHeight: 48 },
  actionBtnSecondaryTxt: { color: c.navy, fontFamily: theme.fonts.bodySemiBold, fontSize: 15 },
  disclaimer: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, textAlign: 'center', marginTop: 4, lineHeight: 15 },
});
