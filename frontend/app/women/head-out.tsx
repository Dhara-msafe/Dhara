import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, type Contact } from '@/src/women/api';
import { DestinationPicker, type DestinationValue } from '@/src/women/DestinationPicker';
import { useAuth } from '@/src/auth';

const c = theme.colors;
const GUARDIAN_SHARE_ENABLED = process.env.EXPO_PUBLIC_GUARDIAN_SHARE === 'true';
// GO1A: DestinationPicker replaces the plain TextInput when this flag is true.
// Existing countdown behaviour is identical in both branches.
const DESTINATION_PICKER_ENABLED = process.env.EXPO_PUBLIC_DESTINATION_PICKER === 'true';

const DURATIONS = [
  { label: '30 min', mins: 30 },
  { label: '1 hour', mins: 60 },
  { label: '2 hours', mins: 120 },
  { label: '4 hours', mins: 240 },
];

const SESSION_KEY = 'ws_head_out_session';

interface HeadOutSession {
  destination: string;
  startTime: number;
  durationMins: number;
  radiusMeters?: number;   // GO1A: optional, undefined in sessions created before GO1A
  savedPlaceId?: string;   // GO1A: optional reference to a saved place
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function HeadOut() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token: authToken } = useAuth();

  const [destination, setDestination] = useState('');
  // GO1A: DestinationPicker state (used when DESTINATION_PICKER_ENABLED)
  const [destValue, setDestValue] = useState<DestinationValue>({ label: '', radiusMeters: 200 });
  const [selectedMins, setSelectedMins] = useState(60);
  const [session, setSession] = useState<HeadOutSession | null>(null);
  const [secsLeft, setSecsLeft] = useState(0);
  const [expired, setExpired] = useState(false);
  const [circle, setCircle] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load persisted session + circle on mount
  useEffect(() => {
    (async () => {
      try {
        const [raw, contacts] = await Promise.all([
          AsyncStorage.getItem(SESSION_KEY),
          getCircle(),
        ]);
        setCircle(contacts);
        if (raw) setSession(JSON.parse(raw));
      } catch {}
      setLoading(false);
    })();
  }, []);

  // Tick the countdown whenever session changes
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!session) { setSecsLeft(0); setExpired(false); return; }

    const tick = () => {
      const deadline = session.startTime + session.durationMins * 60 * 1000;
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setSecsLeft(left);
      if (left === 0) {
        setExpired(true);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [session]);

  const startSession = useCallback(async () => {
    // Resolve destination label from whichever input mode is active
    const label = DESTINATION_PICKER_ENABLED ? destValue.label.trim() : destination.trim();
    if (!label) return;
    const ses: HeadOutSession = {
      destination: label,
      startTime: Date.now(),
      durationMins: selectedMins,
      ...(DESTINATION_PICKER_ENABLED && {
        radiusMeters: destValue.radiusMeters,
        savedPlaceId: destValue.savedPlaceId,
      }),
    };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(ses)).catch(() => {});
    setSession(ses);
    setExpired(false);
  }, [destination, destValue, selectedMins]);

  const endSession = useCallback(async () => {
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    setSession(null);
    setExpired(false);
    setDestination('');
    setDestValue({ label: '', radiusMeters: 200 });
  }, []);

  const prepareAlertSMS = useCallback(() => {
    const notifyContacts = circle.filter(ct => ct.notify !== false);
    const body = `I was heading to ${session?.destination ?? 'a location'} and my check-in timer has expired. Please check on me.`;
    if (notifyContacts.length > 0) {
      const phones = notifyContacts.map(ct => ct.phone).join(',');
      Linking.openURL(`sms:${phones}?body=${encodeURIComponent(body)}`).catch(() =>
        Linking.openURL(`sms:&body=${encodeURIComponent(body)}`).catch(() => {}),
      );
    } else {
      Linking.openURL(`sms:&body=${encodeURIComponent(body)}`).catch(() => {});
    }
  }, [circle, session]);

  if (loading) return null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      testID="head-out-screen"
    >
      <ScreenHeader title="Head out safely" subtitle="Set a check-in timer — nothing is sent automatically" />

      {!session ? (
        <>
          <Text style={styles.note}>
            {'Tell DHARA where you\'re going. If you do not tap "I\'m home safely" before your timer expires, DHARA will help you prepare an SMS alert for your trusted circle. Nothing is sent without your action.'}
          </Text>

          {DESTINATION_PICKER_ENABLED ? (
            // GO1A: full DestinationPicker with saved places + radius
            <DestinationPicker
              testID="headout-destination-picker"
              value={destValue}
              onChange={setDestValue}
              authToken={authToken ?? undefined}
            />
          ) : (
            // Original plain TextInput — unchanged
            <>
              <Text style={styles.fieldLabel}>Where are you going?</Text>
              <TextInput
                testID="headout-destination"
                value={destination}
                onChangeText={setDestination}
                placeholder="e.g. Office, market, bus stop…"
                placeholderTextColor={c.muted}
                style={styles.input}
                returnKeyType="done"
                accessibilityLabel="Destination"
              />
            </>
          )}

          <Text style={styles.fieldLabel}>Expected return time</Text>
          <View style={styles.durationRow}>
            {DURATIONS.map(d => (
              <Pressable
                key={d.mins}
                testID={`headout-dur-${d.mins}`}
                style={[styles.durChip, selectedMins === d.mins && styles.durChipActive]}
                onPress={() => setSelectedMins(d.mins)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedMins === d.mins }}
                accessibilityLabel={d.label}
              >
                <Text style={[styles.durTxt, selectedMins === d.mins && styles.durTxtActive]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            testID="headout-start"
            style={[styles.button, !(DESTINATION_PICKER_ENABLED ? destValue.label.trim() : destination.trim()) && styles.buttonDisabled]}
            disabled={!(DESTINATION_PICKER_ENABLED ? destValue.label.trim() : destination.trim())}
            onPress={startSession}
            accessibilityRole="button"
            accessibilityLabel="Head out — start timer"
          >
            <Ionicons name="navigate-outline" size={18} color="#fff" />
            <Text style={styles.buttonText}>Head out — start timer</Text>
          </Pressable>

          {circle.length === 0 && (
            <View style={styles.warningCard}>
              <View style={styles.warningRow}>
                <Ionicons name="people-outline" size={18} color={c.darkGold} />
                <Text style={styles.warningTxt}>Your trusted circle is empty. Add contacts so DHARA can help prepare an alert if you miss check-in.</Text>
              </View>
              <Pressable testID="headout-add-circle" onPress={() => router.push('/women/trusted-circle')}>
                <Text style={styles.linkTxt}>Set up trusted circle →</Text>
              </Pressable>
            </View>
          )}
        </>
      ) : (
        <>
          {!expired ? (
            <View style={styles.activeCard} testID="headout-active-card">
              <View style={styles.activeHeader}>
                <Ionicons name="navigate-circle-outline" size={26} color={c.navy} />
                <Text style={styles.activeTitle}>Session active</Text>
              </View>
              <Text style={styles.destTxt}>{session.destination}</Text>
              {!!session.radiusMeters && (
                <Text style={styles.radiusTxt}>Planned area: {session.radiusMeters} m · Monitoring not active</Text>
              )}
              <Text style={styles.timerLbl}>Check-in in</Text>
              <Text testID="headout-timer" style={styles.timerDisplay}>{formatCountdown(secsLeft)}</Text>
              <Text style={styles.note}>{'Tap "I\'m home safely" when you\'re back. DHARA will help you alert your circle if this timer runs out.'}</Text>
              {GUARDIAN_SHARE_ENABLED && (
                <Pressable
                  testID="headout-notify-guardian"
                  style={[styles.button, styles.guardianBtn]}
                  onPress={() => router.push({
                    pathname: '/women/guardian-share',
                    params: {
                      destination: session.destination,
                      startTime: String(session.startTime),
                      durationMins: String(session.durationMins),
                    },
                  })}
                  accessibilityRole="button"
                  accessibilityLabel="Notify your guardian about this journey"
                >
                  <Ionicons name="people-outline" size={18} color={c.navy} />
                  <Text style={[styles.buttonText, { color: c.navy }]}>Notify your guardian</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={[styles.activeCard, styles.expiredCard]} testID="headout-expired-card">
              <Ionicons name="alert-circle-outline" size={32} color={c.emergencyRed} />
              <Text style={styles.expiredTitle}>Check-in missed</Text>
              <Text style={styles.note}>
                {'Your timer for "' + session.destination + '" has expired. You can prepare an alert for your trusted circle below, or mark yourself safe.'}
              </Text>
              <Pressable
                testID="headout-alert-circle"
                style={[styles.button, styles.alertButton]}
                onPress={prepareAlertSMS}
                accessibilityRole="button"
                accessibilityLabel="Prepare alert for trusted circle"
              >
                <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                <Text style={styles.buttonText}>Prepare alert for trusted circle</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            testID="headout-end"
            style={[styles.button, styles.safeButton]}
            onPress={endSession}
            accessibilityRole="button"
            accessibilityLabel="I'm home safely"
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
            <Text style={styles.buttonText}>{"I'm home safely"}</Text>
          </Pressable>

          <Text style={styles.disclosureNote}>
            Nothing has been sent. Your session is saved on this device only.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 16 },
  note: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21 },
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontFamily: theme.fonts.body, fontSize: 16, color: c.ink, marginBottom: 12,
  },
  durationRow: { flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  durChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface,
  },
  durChipActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  durTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
  durTxtActive: { color: c.navy },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
  safeButton: { backgroundColor: c.verifiedGreen },
  alertButton: { backgroundColor: c.emergencyRed },
  guardianBtn: { backgroundColor: c.navySoft, borderWidth: 1.5, borderColor: c.navy },
  warningCard: {
    backgroundColor: c.goldMuted, borderRadius: 14, borderWidth: 1,
    borderColor: c.goldSoft, padding: 16, gap: 10,
  },
  warningRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  warningTxt: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 19, flex: 1 },
  linkTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  activeCard: {
    backgroundColor: c.surface, borderRadius: 18, borderWidth: 1,
    borderColor: c.lines, padding: 20, gap: 8, alignItems: 'center', marginBottom: 4,
  },
  expiredCard: { borderColor: c.emergencyRed, backgroundColor: '#FFF5F5' },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  activeTitle: { fontFamily: theme.fonts.displayBold, fontSize: 20, color: c.navy },
  destTxt: {
    fontFamily: theme.fonts.bodyBold, fontSize: 17, color: c.ink,
    textAlign: 'center', paddingHorizontal: 8,
  },
  radiusTxt: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    textAlign: 'center', fontStyle: 'italic',
  },
  timerLbl: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 8 },
  timerDisplay: {
    fontFamily: theme.fonts.displayBold, fontSize: 56, color: c.navy,
    letterSpacing: -2, lineHeight: 64,
  },
  expiredTitle: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.emergencyRed },
  disclosureNote: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    textAlign: 'center', marginTop: 8,
  },
});
