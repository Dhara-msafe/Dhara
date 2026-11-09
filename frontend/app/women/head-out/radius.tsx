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
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useHeadOutWizard } from '@/src/women/headOutWizardStore';
import { RADIUS_PRESETS, isPreset, CustomRadiusModal } from '@/src/women/DestinationPicker';

const c = theme.colors;

export default function ArrivalRadius() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const draft = useHeadOutWizard((s) => s.destination);
  const setDraft = useHeadOutWizard((s) => s.setDestination);
  const [radiusMeters, setRadiusMeters] = useState(draft.radiusMeters);
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
      <ScreenHeader title="Head Out" subtitle="Step 2 of 3 — Arrival area" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}>
        <Text style={styles.destTxt} numberOfLines={2}>{draft.label}</Text>

        <Text style={styles.fieldLabel}>Planned arrival area</Text>
        <Text style={styles.note}>
          How close to your destination counts as &ldquo;arrived&rdquo;. This is for planning only — it
          does not turn on geofence monitoring.
        </Text>
        <View style={styles.chipRow}>
          {RADIUS_PRESETS.map((p) => (
            <Pressable
              key={p.meters}
              testID={`headout-radius-${p.meters}`}
              style={[styles.chip, radiusMeters === p.meters && styles.chipActive]}
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
            style={[styles.chip, !isPreset(radiusMeters) && styles.chipActive]}
            onPress={() => setCustomVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={isPreset(radiusMeters) ? 'Set custom radius' : `Custom: ${radiusMeters} m`}
          >
            <Text style={[styles.chipTxt, !isPreset(radiusMeters) && styles.chipTxtActive]}>
              {isPreset(radiusMeters) ? 'Custom' : `${radiusMeters} m`}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable
          testID="headout-radius-next"
          style={styles.nextBtn}
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
