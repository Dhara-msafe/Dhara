/**
 * Family Journey — hub (Phase 1: Preview).
 * Route: /family-journey
 *
 * Separate from Women's Shield, Guardian Journey, SOS and Trusted Circle:
 * it only READS the trusted-contact lists and writes nothing but its own
 * on-device journey record.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import {
  JourneyHeader, JourneyHelpRow, PhaseNotice, PhaseBadge, ConfirmSheet, fjStyles,
} from '@/src/familyJourney/ui';
import { loadJourney, clearJourney, useFamilyJourneyEnabled, type Journey } from '@/src/familyJourney/store';
import { FJ_SEND_ENABLED } from '@/src/familyJourney/flags';

const c = theme.colors;

export default function FamilyJourneyHub() {
  const router = useRouter();
  const { enabled, loaded, setEnabled } = useFamilyJourneyEnabled();
  const [journey, setJourney] = useState<Journey | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadJourney().then(j => { if (alive) setJourney(j); });
      return () => { alive = false; };
    }, []),
  );

  const active = journey && journey.status === 'active';
  const draft = journey && journey.status === 'draft';

  return (
    <View style={fjStyles.root} testID="family-journey-hub">
      <JourneyHeader title="Family Journey" subtitle="Plan a trip · decide who could be told" />
      <ScrollView contentContainerStyle={fjStyles.body} showsVerticalScrollIndicator={false}>
        <View style={[fjStyles.card, styles.toggleCard]}>
          <View style={{ flex: 1 }}>
            <Text style={fjStyles.cardTitle}>Family Journey</Text>
            <Text style={fjStyles.cardSub}>
              {enabled
                ? (FJ_SEND_ENABLED
                  ? 'On — you can plan journeys, choose who can be told, and send each message yourself.'
                  : 'On — you can plan journeys and preview what a contact would see.')
                : 'Off — the feature is hidden everywhere in DHARA. No new message is prepared for anyone; it simply stays unused.'}
            </Text>
          </View>
          <Switch
            testID="fj-master-toggle"
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ true: c.navy, false: c.borderStrong }}
            thumbColor="#fff"
          />
        </View>

        {!loaded ? null : !enabled ? (
          <Text style={fjStyles.empty}>
            Turn Family Journey back on above whenever you want it. Emergency help and legal help below stay
            available either way.
          </Text>
        ) : (
          <>
            <PhaseNotice />

            {active ? (
              <Pressable style={fjStyles.card} onPress={() => router.navigate('/family-journey/active')} testID="fj-resume-active">
                <View style={fjStyles.pill}><Text style={fjStyles.pillTxt}>JOURNEY IN PROGRESS</Text></View>
                <Text style={fjStyles.cardTitle}>{journey!.destination || 'Your journey'}</Text>
                <Text style={fjStyles.cardSub}>Check in, mark that you have arrived, change the plan or stop — any time.</Text>
                <View style={[fjStyles.primary, { marginTop: 8 }]}><Text style={fjStyles.primaryTxt}>Open journey</Text></View>
              </Pressable>
            ) : draft ? (
              <View style={fjStyles.card}>
                <View style={fjStyles.pill}><Text style={fjStyles.pillTxt}>DRAFT SAVED ON THIS PHONE</Text></View>
                <Text style={fjStyles.cardTitle}>{journey!.destination || 'Untitled journey'}</Text>
                <Text style={fjStyles.cardSub}>You have a journey you have not started yet.</Text>
                <Pressable style={[fjStyles.primary, { marginTop: 8 }]} onPress={() => router.push('/family-journey/contacts')} testID="fj-continue-draft">
                  <Text style={fjStyles.primaryTxt}>Continue setup</Text>
                </Pressable>
                <Pressable style={fjStyles.secondary} onPress={() => setAskDiscard(true)} testID="fj-discard-draft">
                  <Text style={fjStyles.secondaryTxt}>Discard draft</Text>
                </Pressable>
              </View>
            ) : (
              <View style={fjStyles.card}>
                <Text style={fjStyles.cardTitle}>Plan a journey</Text>
                <Text style={fjStyles.cardSub}>
                  Give it a destination label and the timings you expect. Then choose which trusted contacts
                  could be told, and exactly what they would see.
                </Text>
                <PhaseBadge testID="fj-hub-preview-badge" />
                <Pressable style={[fjStyles.primary, { marginTop: 10 }]} onPress={() => router.push('/family-journey/new')} testID="fj-start-plan">
                  <Text style={fjStyles.primaryTxt}>Plan a journey</Text>
                </Pressable>
              </View>
            )}

            <View style={fjStyles.card}>
              <Text style={fjStyles.cardTitle}>What this version does not do</Text>
              {(FJ_SEND_ENABLED
                ? [
                  'Nothing is ever sent on its own — your SMS app opens and you press Send.',
                  'No location is collected, stored or shared — not even a last-known point.',
                  'No school, employer, hostel or any institution receives anything.',
                  'Nothing here changes Women\u2019s Shield, Guardian Journey, SOS or your Trusted Circle.',
                ]
                : [
                  'No message, notification or email reaches any contact.',
                  'No location is collected, stored or shown — not even a last-known point.',
                  'No school, employer, hostel or any institution receives anything.',
                  'Nothing here changes Women\u2019s Shield, Guardian Journey, SOS or your Trusted Circle.',
                ]
              ).map(line => (
                <View key={line} style={styles.bullet}>
                  <Ionicons name="ellipse" size={6} color={c.borderStrong} style={{ marginTop: 7 }} />
                  <Text style={[fjStyles.cardSub, { flex: 1 }]}>{line}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <JourneyHelpRow />
      </ScrollView>

      <ConfirmSheet
        visible={askDiscard}
        title="Discard this draft?"
        body="The journey you saved on this phone will be removed. No contact is messaged either way."
        confirmLabel="Discard draft"
        badge="none"
        onConfirm={async () => { await clearJourney(); setJourney(null); setAskDiscard(false); }}
        onCancel={() => setAskDiscard(false)}
        testID="fj-discard-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggleCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
