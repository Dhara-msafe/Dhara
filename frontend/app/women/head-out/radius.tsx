/**
 * Head Out wizard — Step 2: Set Arrival Radius.
 *
 * Reads the destination picked in Step 1 from headOutWizardStore, lets the
 * user pick (or fine-tune) a planned arrival-area radius on a large map, and
 * writes the chosen radius back to the same draft before moving on.
 *
 * COPY NOTE: the original design for this screen implies automatic arrival
 * detection ("we will consider you arrived when you enter this area"). That
 * geofencing logic now exists (GO1C, app/women/head-out.tsx) but is gated
 * behind EXPO_PUBLIC_GO1C_LIVE_ROUTE — OFF by default. The disclosure text
 * below reflects whichever is actually true at runtime rather than always
 * asserting the no-detection version, which would become false the moment an
 * operator turns GO1C on.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { DestinationMapPicker } from '@/src/women/DestinationMapPicker';
import { useHeadOutWizard } from '@/src/women/headOutWizardStore';

const c = theme.colors;
const GO1C_LIVE_ROUTE_ENABLED = process.env.EXPO_PUBLIC_GO1C_LIVE_ROUTE === 'true';

const RADIUS_PRESETS = [
  { label: '100 m', meters: 100 },
  { label: '200 m', meters: 200 },
  { label: '300 m', meters: 300 },
];

export default function SetArrivalRadius() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const draft = useHeadOutWizard(s => s.destination);
  const setDraft = useHeadOutWizard(s => s.setDestination);

  const [radiusMeters, setRadiusMeters] = useState(draft.radiusMeters);
  const [latitude, setLatitude] = useState(draft.latitude ?? null);
  const [longitude, setLongitude] = useState(draft.longitude ?? null);

  const movePin = useCallback((lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
  }, []);

  const handleNext = useCallback(() => {
    setDraft({ ...draft, radiusMeters, latitude, longitude });
    router.push('/women/head-out/circle');
  }, [draft, radiusMeters, latitude, longitude, setDraft, router]);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Set arrival radius" subtitle={draft.label || 'Step 2 of 3'} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}>

        <DestinationMapPicker
          testID="headout-radius-map"
          latitude={latitude}
          longitude={longitude}
          radiusMeters={radiusMeters}
          onPositionChange={movePin}
          mapHeight={320}
        />

        <Text style={styles.fieldLabel}>Arrival radius (around destination)</Text>
        <View style={styles.radiusRow}>
          {RADIUS_PRESETS.map(p => (
            <Pressable
              key={p.meters}
              testID={`headout-radius-${p.meters}`}
              style={[styles.radiusChip, radiusMeters === p.meters && styles.radiusChipActive]}
              onPress={() => setRadiusMeters(p.meters)}
              accessibilityRole="radio"
              accessibilityState={{ checked: radiusMeters === p.meters }}
              aria-checked={radiusMeters === p.meters}
              accessibilityLabel={`${p.label} arrival area`}
            >
              <Text style={[styles.radiusTxt, radiusMeters === p.meters && styles.radiusTxtActive]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.noteRow}>
          <Ionicons name="navigate-outline" size={16} color={c.muted} />
          <Text style={styles.noteTxt}>
            GPS accuracy varies by device and surroundings — typically 10–25 m outdoors, less reliable indoors or in dense areas.
          </Text>
        </View>

        <View style={styles.disclosureBox} testID="headout-radius-disclosure">
          <Ionicons name="information-circle-outline" size={16} color={c.muted} />
          <Text style={styles.disclosureTxt}>
            {GO1C_LIVE_ROUTE_ENABLED
              ? "DHARA will let you know when you enter this area so you can confirm you're safe — it never alerts your trusted circle automatically just for arriving. You stay in control of when to check in or ask for help."
              : 'This sets your planned arrival area only — DHARA does not automatically detect when you arrive, and no one is alerted automatically. You stay in control of when to check in or ask for help.'}
          </Text>
        </View>

      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable
          testID="headout-radius-next"
          style={styles.nextBtn}
          onPress={handleNext}
          accessibilityRole="button"
          accessibilityLabel="Next — choose your trusted circle"
        >
          <Text style={styles.nextBtnTxt}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 4 },
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 8, marginTop: 16 },
  radiusRow: { flexDirection: 'row', gap: 10 },
  radiusChip: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface, alignItems: 'center',
  },
  radiusChipActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  radiusTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.muted },
  radiusTxtActive: { color: c.navy },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 18 },
  noteTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12.5, color: c.muted, lineHeight: 18 },
  disclosureBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: c.goldMuted, borderRadius: 10, borderWidth: 1,
    borderColor: c.goldSoft, padding: 12, marginTop: 14,
  },
  disclosureTxt: { fontFamily: theme.fonts.body, fontSize: 12.5, color: c.ink, flex: 1, lineHeight: 18 },
  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: c.background, borderTopWidth: 1, borderTopColor: c.lines,
  },
  nextBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  nextBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
});
