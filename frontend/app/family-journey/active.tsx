/**
 * Family Journey — journey in progress (Phase 1: Preview).
 * Route: /family-journey/active
 *
 * All controls are instant, local and need no reason. Reminders live in this
 * screen only: Phase 1 schedules no notification of any kind, on any device.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { JourneyHeader, JourneyHelpRow, PreviewBadge, ConfirmSheet, FamilyJourneyOff, fjStyles } from '@/src/familyJourney/ui';
import { isLocalOnly, loadJourney, saveJourney, clearJourney, nextCheckinDueAt, useFamilyJourneyEnabled, type Journey } from '@/src/familyJourney/store';
import { buildPreview, MODE_META, type PreviewMode } from '@/src/familyJourney/previewCopy';

const c = theme.colors;

function clockLabel(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ActiveJourney() {
  const router = useRouter();
  const { user } = useAuth();
  const ownerName = user?.name || 'You';

  const [journey, setJourney] = useState<Journey | null>(null);
  const [now, setNow] = useState(Date.now());
  const [askHelp, setAskHelp] = useState(false);
  const [askStop, setAskStop] = useState(false);
  const [shownPreview, setShownPreview] = useState<PreviewMode | null>(null);
  const { enabled, loaded: switchLoaded } = useFamilyJourneyEnabled();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadJourney().then(j => { if (alive) setJourney(j); });
      return () => { alive = false; };
    }, []),
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const persist = async (patch: Partial<Journey>) => {
    if (!journey) return;
    const next = { ...journey, ...patch };
    setJourney(next);
    await saveJourney(next);
  };

  if (switchLoaded && !enabled) return <FamilyJourneyOff />;

  if (!journey || journey.status !== 'active') {
    return (
      <View style={fjStyles.root} testID="fj-active-screen">
        <JourneyHeader title="Journey" />
        <ScrollView contentContainerStyle={fjStyles.body}>
          <Text style={fjStyles.empty}>No journey is running right now.</Text>
          <Pressable style={fjStyles.primary} onPress={() => router.replace('/family-journey')} testID="fj-active-home">
            <Text style={fjStyles.primaryTxt}>Back to Family Journey</Text>
          </Pressable>
          <JourneyHelpRow />
        </ScrollView>
      </View>
    );
  }

  const dueAt = nextCheckinDueAt(journey);
  const overdue = dueAt != null && now > dueAt;
  const sharingContacts = journey.contacts.filter(ct => !isLocalOnly(ct));
  const contactsFor = (mode: PreviewMode) => journey.contacts.filter(ct => ct[mode]);

  const previewOf = shownPreview ? buildPreview(shownPreview, journey, ownerName) : null;

  return (
    <View style={fjStyles.root} testID="fj-active-screen">
      <JourneyHeader title="Journey in progress" subtitle={journey.destination || 'Your journey'} />
      <ScrollView contentContainerStyle={fjStyles.body} showsVerticalScrollIndicator={false}>
        <View style={fjStyles.card}>
          <View style={fjStyles.pill}><Text style={fjStyles.pillTxt}>ON THIS PHONE ONLY</Text></View>
          <Text style={fjStyles.cardTitle}>{journey.destination || 'Your journey'}</Text>
          {journey.departAt ? <Text style={fjStyles.cardSub}>Leaving around {journey.departAt}</Text> : null}
          {journey.arriveAt ? <Text style={fjStyles.cardSub}>Expected arrival {journey.arriveAt}</Text> : null}
          {journey.returnAt ? <Text style={fjStyles.cardSub}>Expected back {journey.returnAt}</Text> : null}
          {journey.arrivedAt ? (
            <Text style={styles.calmOk}>You marked that you arrived at {clockLabel(journey.arrivedAt)}.</Text>
          ) : journey.lastCheckinAt ? (
            <Text style={fjStyles.cardSub}>Last check-in {clockLabel(journey.lastCheckinAt)}</Text>
          ) : null}
          <PreviewBadge testID="fj-active-badge" />
        </View>

        {/* Check-in reminder — calm, never a red alarm or a countdown. */}
        {journey.checkinMins && !journey.arrivedAt ? (
          <View style={[fjStyles.card, overdue && styles.calmCard]} testID="fj-checkin-card">
            <Text style={fjStyles.cardTitle}>
              {overdue ? 'Check-in not received' : `Next check-in around ${dueAt ? clockLabel(dueAt) : ''}`}
            </Text>
            <Text style={fjStyles.cardSub}>
              {overdue
                ? 'Nothing has been sent and nothing says whether you are safe or at risk. Check in whenever you like, or ignore this.'
                : 'A reminder for you only. There is no deadline and nothing happens if you skip it.'}
            </Text>
            {overdue && contactsFor('missedCheckin').length > 0 ? (
              <Pressable style={fjStyles.secondary} onPress={() => setShownPreview('missedCheckin')} testID="fj-show-missed-preview">
                <Ionicons name="eye-outline" size={16} color={c.navy} />
                <Text style={fjStyles.secondaryTxt}>See what this would look like</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Journey controls</Text>
          <Pressable
            style={[fjStyles.primary, { marginTop: 6 }]}
            onPress={() => persist({ lastCheckinAt: Date.now() })}
            testID="fj-checkin-now"
          >
            <Text style={fjStyles.primaryTxt}>Check in now</Text>
          </Pressable>
          <Pressable
            style={fjStyles.secondary}
            onPress={async () => {
              await persist({ arrivedAt: Date.now() });
              if (contactsFor('arrival').length > 0) setShownPreview('arrival');
            }}
            testID="fj-arrived"
          >
            <Ionicons name="flag-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>I&rsquo;ve arrived</Text>
          </Pressable>
          <Pressable style={fjStyles.secondary} onPress={() => router.push('/family-journey/new')} testID="fj-change-plan">
            <Ionicons name="create-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>Change the plan</Text>
          </Pressable>
          <Pressable style={fjStyles.secondary} onPress={() => router.push('/family-journey/preview')} testID="fj-open-previews">
            <Ionicons name="eye-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>See all previews</Text>
          </Pressable>
          <Pressable style={fjStyles.secondary} onPress={() => setAskStop(true)} testID="fj-stop">
            <Ionicons name="stop-circle-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>Stop journey</Text>
          </Pressable>
        </View>

        {/* Student-initiated help request — deliberate, never automatic. */}
        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Ask a contact for help</Text>
          <Text style={fjStyles.cardSub}>{MODE_META.helpRequest.note}</Text>
          <Pressable style={fjStyles.secondary} onPress={() => setAskHelp(true)} testID="fj-help-request">
            <Ionicons name="hand-left-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>Ask for help</Text>
          </Pressable>
          {journey.helpRequestedAt ? (
            <Text style={fjStyles.cardSub}>
              You previewed a help request at {clockLabel(journey.helpRequestedAt)}. Nothing was sent.
            </Text>
          ) : null}
          <Text style={fjStyles.empty}>
            For an emergency, use Emergency help below — it works without any subscription.
          </Text>
        </View>

        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>On this journey</Text>
          {journey.contacts.length === 0 ? (
            <Text style={fjStyles.cardSub}>Local-only — no contact is attached to this journey.</Text>
          ) : (
            journey.contacts.map(ct => (
              <Text key={ct.id} style={fjStyles.cardSub} testID={`fj-active-contact-${ct.id}`}>
                {ct.name} — {isLocalOnly(ct)
                  ? 'local-only'
                  : [ct.arrival && 'arrival', ct.missedCheckin && 'missed check-in', ct.helpRequest && 'help request']
                      .filter(Boolean).join(', ')}
              </Text>
            ))
          )}
          {sharingContacts.length > 0 ? (
            <Text style={fjStyles.empty}>These choices are saved on this phone. No contact has been told anything.</Text>
          ) : null}
        </View>

        <JourneyHelpRow />
      </ScrollView>

      {/* Help-request confirmation → shows the preview, sends nothing. */}
      <ConfirmSheet
        visible={askHelp}
        title="Ask for help?"
        body={
          contactsFor('helpRequest').length > 0
            ? `In a later version this would reach ${contactsFor('helpRequest').map(ct => ct.name).join(', ')}. In this version you will only see what it would look like.`
            : 'No contact has the help-request permission turned on, so you will only see what it would look like.'
        }
        confirmLabel="Show me the preview"
        onConfirm={async () => {
          setAskHelp(false);
          await persist({ helpRequestedAt: Date.now() });
          setShownPreview('helpRequest');
        }}
        onCancel={() => setAskHelp(false)}
        testID="fj-help-confirm"
      />

      {/* Stop journey — one tap, no reason required. */}
      <ConfirmSheet
        visible={askStop}
        title="Stop this journey?"
        body="The journey ends on this phone and the plan is removed. Nothing was shared with anyone, so no contact needs to be told."
        confirmLabel="Stop journey"
        onConfirm={async () => {
          setAskStop(false);
          await clearJourney();
          setJourney(null);
          // Drop the journey screens from the stack so Back can never reopen a
          // plan for a journey that no longer exists.
          try { router.dismissTo('/family-journey'); } catch { router.replace('/family-journey'); }
        }}
        onCancel={() => setAskStop(false)}
        testID="fj-stop-confirm"
      />

      {/* Single-message preview sheet (missed check-in / arrival / help). */}
      <ConfirmSheet
        visible={!!shownPreview && !!previewOf}
        title={shownPreview ? MODE_META[shownPreview].title : ''}
        body={previewOf ? `“${previewOf.heading} — ${previewOf.body}”` : ''}
        confirmLabel="Close"
        onConfirm={() => setShownPreview(null)}
        onCancel={() => setShownPreview(null)}
        hideCancel
        testID="fj-message-preview"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  calmCard: { backgroundColor: c.surfaceSecondary, borderColor: c.borderStrong },
  calmOk: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.success },
});
