/**
 * Family Journey — create / change the plan (Phase 1: Preview).
 * Route: /family-journey/new
 *
 * Plain text timings on purpose: Phase 1 runs no timers on any server and
 * collects no location, so nothing here needs a precise timestamp.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { theme } from '@/src/theme';
import { JourneyHeader, JourneyHelpRow, PreviewBadge, FamilyJourneyOff, fjStyles } from '@/src/familyJourney/ui';
import { CHECKIN_OPTIONS, emptyJourney, loadJourney, saveJourney, useFamilyJourneyEnabled, type Journey } from '@/src/familyJourney/store';

const c = theme.colors;

export default function NewJourney() {
  const router = useRouter();
  const [j, setJ] = useState<Journey>(emptyJourney());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const { enabled, loaded: switchLoaded } = useFamilyJourneyEnabled();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadJourney().then(existing => {
        if (!alive) return;
        if (existing) setJ(existing);
        setReady(true);
      });
      return () => { alive = false; };
    }, []),
  );

  const set = (patch: Partial<Journey>) => setJ(prev => ({ ...prev, ...patch }));

  const onContinue = async () => {
    if (!j.destination.trim()) {
      setError('Add a destination label so you can tell this journey apart.');
      return;
    }
    setError('');
    await saveJourney(j);
    router.push('/family-journey/contacts');
  };

  if (switchLoaded && !enabled) return <FamilyJourneyOff />;

  return (
    <View style={fjStyles.root} testID="fj-new-screen">      <JourneyHeader title={j.status === 'active' ? 'Change the plan' : 'Plan a journey'} subtitle="Saved on this phone only" />
      <KeyboardAwareScrollView
        contentContainerStyle={fjStyles.body}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Where are you going?</Text>
          <Text style={fjStyles.label}>Destination label</Text>
          <TextInput
            testID="fj-destination"
            style={fjStyles.input}
            value={j.destination}
            onChangeText={t => { set({ destination: t }); if (error) setError(''); }}
            placeholder="e.g. Library, friend's place, hostel"
            placeholderTextColor={c.onSurfaceTertiary}
            maxLength={80}
          />
          <Text style={fjStyles.cardSub}>A label only. No map, pin or location is used in this version.</Text>
        </View>

        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Timings you expect</Text>
          <Text style={fjStyles.label}>Leaving around</Text>
          <TextInput
            testID="fj-depart"
            style={fjStyles.input}
            value={j.departAt}
            onChangeText={t => set({ departAt: t })}
            placeholder="e.g. 7:30 pm today"
            placeholderTextColor={c.onSurfaceTertiary}
            maxLength={60}
          />
          <Text style={fjStyles.label}>Expect to arrive around</Text>
          <TextInput
            testID="fj-arrive"
            style={fjStyles.input}
            value={j.arriveAt}
            onChangeText={t => set({ arriveAt: t })}
            placeholder="e.g. 8:15 pm"
            placeholderTextColor={c.onSurfaceTertiary}
            maxLength={60}
          />
          <Text style={fjStyles.label}>Expect to be back around (optional)</Text>
          <TextInput
            testID="fj-return"
            style={fjStyles.input}
            value={j.returnAt}
            onChangeText={t => set({ returnAt: t })}
            placeholder="e.g. 11 pm"
            placeholderTextColor={c.onSurfaceTertiary}
            maxLength={60}
          />
        </View>

        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Check-in reminder</Text>
          <Text style={fjStyles.cardSub}>
            A gentle reminder for you, shown inside this screen while the journey is on. It is not a deadline
            and nothing happens if you skip it.
          </Text>
          <View style={styles.chips}>
            {CHECKIN_OPTIONS.map(opt => {
              const on = j.checkinMins === opt.mins;
              return (
                <Pressable
                  key={opt.label}
                  testID={`fj-checkin-${opt.mins ?? 'none'}`}
                  onPress={() => set({ checkinMins: opt.mins })}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <PreviewBadge testID="fj-new-preview-badge" />
        </View>

        {error ? <Text style={styles.error} testID="fj-new-error">{error}</Text> : null}

        <Pressable style={fjStyles.primary} onPress={onContinue} disabled={!ready} testID="fj-new-continue">
          <Text style={fjStyles.primaryTxt}>Choose contacts</Text>
        </Pressable>

        <JourneyHelpRow />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface,
  },
  chipOn: { backgroundColor: c.navy, borderColor: c.navy },
  chipTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  chipTxtOn: { color: '#fff' },
  error: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.warning },
});
