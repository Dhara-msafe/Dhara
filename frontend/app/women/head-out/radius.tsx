/**
 * Head Out wizard — Step 2: Arrival radius.
 *
 * Reads/writes the shared wizard store (headOutWizardStore.ts) — the same
 * store destination.tsx (Step 1) and circle.tsx (Step 3) use — so this
 * step's only job is the one thing its name says: how close counts as
 * "arrived". Duration, trusted circle and reminder settings all live on
 * Step 3 now.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { UI_V22_P9, headOutBottomGutter } from '@/src/uiV22Flags';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useHeadOutWizard } from '@/src/women/headOutWizardStore';
import { RADIUS_PRESETS, isPreset, CustomRadiusModal } from '@/src/women/DestinationPicker';
import { DestinationMapPicker } from '@/src/women/DestinationMapPicker';
// NF-UI-REV-13 (Group G follow-up, DHARA UI Revision v2.2.1): visible
// keyboard-focus ring only. No radius/wizard logic changes.
import { focusRingStyle } from '@/src/a11yFocus';

const c = theme.colors;

export default function ArrivalRadius() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const draft = useHeadOutWizard((s) => s.destination);
  const setDraft = useHeadOutWizard((s) => s.setDestination);
  const [radiusMeters, setRadiusMeters] = useState(draft.radiusMeters);
  // A36: the map sits inside this scrolling page. While her finger is on
  // the map the page must not scroll, or the drag moves the page instead
  // of the pin (tester bug T1).
  const [mapActive, setMapActive] = useState(false);
  // Stable no-op for the map — destination pin was set in Step 1 and
  // cannot be changed from this screen; we show the map for radius preview only.
  const noopPositionChange = useCallback(() => {}, []);
  const [customVisible, setCustomVisible] = useState(false);

  // No destination chosen yet (e.g. this URL was opened directly, or the
  // wizard store was reset mid-flow) — send back to Step 1 instead of
  // letting the user set a radius for nothing.
  //
  // MUST be useFocusEffect, not a plain useEffect keyed on draft.label:
  // router.push keeps this screen mounted (not unmounted) underneath Step 3
  // (circle.tsx) in the stack. circle.tsx's "Start Journey" action calls
  // resetWizard() (clearing the shared store's destination back to '')
  // BEFORE navigating to the active session screen — with a plain
  // useEffect, THIS hidden, unfocused screen would see that store change,
  // its guard would fire, and its own router.replace('.../destination')
  // would race with (and silently win over) circle.tsx's navigation to the
  // active session screen, bouncing the user back to Step 1 every time.
  // Scoping this to focus means the guard only ever runs while the user is
  // actually looking at this screen.
  useFocusEffect(
    useCallback(() => {
      if (!draft.label.trim()) router.replace('/women/head-out/destination');
    }, [draft.label, router]),
  );

  if (!draft.label.trim()) return null;

  const handleNext = () => {
    setDraft({ ...draft, radiusMeters });
    router.push('/women/head-out/circle');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title={UI_V22_P9 ? 'Head out safely' : 'Head Out'} subtitle="Step 2 of 3 — Arrival area" />
      <ScrollView scrollEnabled={!mapActive} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + headOutBottomGutter(110) }]}>
        <Text style={styles.destTxt} numberOfLines={2}>{draft.label}</Text>

        <Text style={styles.fieldLabel}>Planned arrival area</Text>
        <Text style={styles.note}>
          How close to your destination counts as &ldquo;arrived&rdquo;. While your journey is
          active and location sharing is on, DHARA treats entering this area as arriving
          and will ask you to confirm.
        </Text>

        {/* Map preview — shows destination pin + arrival radius circle */}
        <View style={styles.mapSection} testID="headout-radius-map-section">
          <DestinationMapPicker
            onInteractionChange={setMapActive}
            testID="headout-radius-map"
            latitude={draft.latitude ?? null}
            longitude={draft.longitude ?? null}
            radiusMeters={radiusMeters}
            onPositionChange={noopPositionChange}
            mapHeight={240}
          />
        </View>
        <View style={styles.gpsAccuracyRow}>
          <Ionicons name="locate-outline" size={14} color={c.muted} />
          <Text style={styles.gpsAccuracyTxt}>GPS accuracy: ~10–25 metres</Text>
        </View>
        <Text style={styles.arrivalNote}>
          When you enter this area with location on, DHARA will ask you to confirm you arrived.
        </Text>

        <View style={styles.chipRow}>
          {RADIUS_PRESETS.map((p) => (
            <Pressable
              key={p.meters}
              testID={`headout-radius-${p.meters}`}
              style={(s) => [styles.chip, radiusMeters === p.meters && styles.chipActive, focusRingStyle(s)]}
              onPress={() => setRadiusMeters(p.meters)}
              accessibilityRole="radio"
              accessibilityState={{ checked: radiusMeters === p.meters }}
              aria-checked={radiusMeters === p.meters}
              accessibilityLabel={`${p.label} arrival area`}
            >
              <Text style={[styles.chipTxt, radiusMeters === p.meters && styles.chipTxtActive]}>{p.label}</Text>
            </Pressable>
          ))}
          <Pressable
            testID="headout-radius-custom"
            style={(s) => [styles.chip, !isPreset(radiusMeters) && styles.chipActive, focusRingStyle(s)]}
            onPress={() => setCustomVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={isPreset(radiusMeters) ? 'Set custom radius' : `Custom: ${radiusMeters} m`}
          >
            <Text style={[styles.chipTxt, !isPreset(radiusMeters) && styles.chipTxtActive]}>
              {isPreset(radiusMeters) ? 'Custom' : `${radiusMeters} m`}
            </Text>
          </Pressable>
        </View>

        {/* Disclaimer below the chip row */}
        <View style={styles.disclaimerRow}>
          <Ionicons name="information-circle-outline" size={14} color={c.muted} />
          <Text style={styles.disclaimerTxt}>
            Arrival zone is not a safety guarantee. You may still check in based on your situation.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable
          testID="headout-radius-next"
          style={(s) => [styles.nextBtn, focusRingStyle(s)]}
          onPress={handleNext}
          accessibilityRole="button"
          accessibilityLabel="Next — notify your trusted circle"
        >
          <Text style={styles.nextBtnTxt}>Next</Text>
        </Pressable>
      </View>

      <CustomRadiusModal
        visible={customVisible}
        initial={isPreset(radiusMeters) ? 100 : radiusMeters}
        onSave={(m) => { setRadiusMeters(m); setCustomVisible(false); }}
        onCancel={() => setCustomVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 4 },
  destTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.navy, marginBottom: 6 },
  mapSection: { borderRadius: 14, overflow: 'hidden', marginTop: 12, marginBottom: 4 },
  gpsAccuracyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  gpsAccuracyTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  arrivalNote: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy, marginTop: 6, marginBottom: 10, lineHeight: 18 },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 14, backgroundColor: c.navySoft, borderRadius: 10, padding: 10 },
  disclaimerTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.navy, flex: 1, lineHeight: 17 },
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 4, marginTop: 16 },
  note: { fontFamily: theme.fonts.body, fontSize: 12.5, color: c.muted, lineHeight: 18, marginBottom: 10 },
  chipRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface, minWidth: 64, alignItems: 'center',
  },
  chipActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  chipTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
  chipTxtActive: { color: c.navy },
  footer: {
    paddingHorizontal: 20, paddingTop: 12, backgroundColor: c.background,
    borderTopWidth: 1, borderTopColor: c.lines,
  },
  nextBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  nextBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
});
