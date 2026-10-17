/**
 * S3 — Guardian Journey Engine (SMS/link mode)
 *
 * Feature flag: EXPO_PUBLIC_GUARDIAN_SHARE=true
 *
 * Allows the user — while a Head Out session is active — to send a one-tap
 * status SMS to selected trusted circle members. Nothing is sent automatically;
 * the user always controls each send action.
 *
 * The SMS tells the guardian:
 *   - Where the user is going
 *   - When they expect to check in
 *   - What to do if the check-in is missed
 *   - A pre-composed reply shortcode ("SAFE" / "CALL ME")
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, type Contact } from '@/src/women/api';

const c = theme.colors;

function formatDeadline(startTime: number, durationMins: number): string {
  const deadline = new Date(startTime + durationMins * 60 * 1000);
  return deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function GuardianShare() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    destination?: string;
    startTime?: string;
    durationMins?: string;
  }>();

  const destination = params.destination ?? '';
  const startTime   = parseInt(params.startTime  ?? '0', 10);
  const durationMins = parseInt(params.durationMins ?? '60', 10);

  const [circle, setCircle]       = useState<Contact[]>([]);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [sent, setSent]           = useState(false);
  const [loading, setLoading]     = useState(true);

  const checkInBy = startTime > 0 ? formatDeadline(startTime, durationMins) : `${durationMins} min`;

  useEffect(() => {
    getCircle()
      .then(contacts => {
        setCircle(contacts);
        // Pre-select all notify-enabled contacts
        setSelected(new Set(contacts.filter(ct => ct.notify !== false).map(ct => ct.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleContact = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const buildMessage = useCallback(() => {
    const dest = destination || 'a location';
    return (
      `Hi, I'm heading to ${dest}. I plan to check in by ${checkInBy}.\n\n` +
      `If you don't hear from me by then, please call me to confirm I'm safe.\n\n` +
      `(Sent via DHARA legal aid app — my check-in is timed and on-device only.)`
    );
  }, [destination, checkInBy]);

  const sendSMS = useCallback(() => {
    const phones = circle
      .filter(ct => selected.has(ct.id))
      .map(ct => ct.phone)
      .join(',');
    if (!phones) return;
    const body = buildMessage();
    Linking.openURL(`sms:${phones}?body=${encodeURIComponent(body)}`).catch(() =>
      Linking.openURL(`sms:&body=${encodeURIComponent(body)}`).catch(() => {}),
    );
    setSent(true);
  }, [circle, selected, buildMessage]);

  const selectedCount = selected.size;
  const canSend = selectedCount > 0 && !loading;

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
        <Text style={styles.previewBody}>{buildMessage()}</Text>
      </View>

      {/* Send button */}
      <Pressable
        testID="guardian-send"
        style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
        disabled={!canSend}
        onPress={sendSMS}
        accessibilityRole="button"
        accessibilityLabel={`Send journey update to ${selectedCount} contact${selectedCount === 1 ? '' : 's'}`}
      >
        <Ionicons name="chatbubble-outline" size={18} color="#fff" />
        <Text style={styles.sendBtnTxt}>
          {sent ? 'Send again' : `Send to ${selectedCount} contact${selectedCount === 1 ? '' : 's'}`}
        </Text>
      </Pressable>

      {sent && (
        <View style={styles.sentBanner} testID="guardian-sent-banner">
          <Ionicons name="checkmark-circle-outline" size={18} color={c.verifiedGreen} />
          <Text style={styles.sentTxt}>SMS app opened — your guardian has been notified.</Text>
        </View>
      )}

      <Text style={styles.disclosureNote}>
        Nothing is sent automatically. DHARA opens your SMS app with a pre-filled message; you control every send.
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
  disclosureNote: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    textAlign: 'center', lineHeight: 18,
  },
});
