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
import { JourneyHeader, JourneyHelpRow, PhaseBadge, ConfirmSheet, FamilyJourneyOff, fjStyles } from '@/src/familyJourney/ui';
import { isLocalOnly, loadJourney, saveJourney, clearJourney, nextCheckinDueAt, withSent, useFamilyJourneyEnabled, type Journey } from '@/src/familyJourney/store';
import { buildPreview, MODE_META, modeNote, type PreviewMode } from '@/src/familyJourney/previewCopy';
import { SendSheet } from '@/src/familyJourney/SendSheet';
import { FJ_SEND_ENABLED } from '@/src/familyJourney/flags';
// NF-UI-REV-07 (Group G, DHARA UI Revision v2.2.1): visible keyboard-focus
// ring + missing a11y labels only. No journey/send logic changes.
import { focusRingStyle } from '@/src/a11yFocus';

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
  const [sendMode, setSendMode] = useState<PreviewMode | null>(null);
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
          <Pressable style={(s) => [fjStyles.primary, focusRingStyle(s)]} onPress={() => router.replace('/family-journey')} testID="fj-active-home" accessibilityRole="button" accessibilityLabel="Back to Family Journey">
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

  /** Phase 2 opens the per-contact send sheet; Phase 1 shows the preview only. */
  const openEvent = (mode: PreviewMode) => {
    if (FJ_SEND_ENABLED) setSendMode(mode);
    else setShownPreview(mode);
  };

  /** Contacts whose SMS app was actually opened for a help request, and when. */
  const helpOpenedTimes = Object.values(journey.sent ?? {}).map(m => m.helpRequest).filter(Boolean) as number[];
  const helpOpenedCount = helpOpenedTimes.length;
  const helpOpenedAt = helpOpenedCount > 0 ? Math.max(...helpOpenedTimes) : null;

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
          <PhaseBadge testID="fj-active-badge" />
        </View>

        {/* Check-in reminder — calm, never a red alarm or a countdown. */}
        {journey.checkinMins && !journey.arrivedAt ? (
          <View style={[fjStyles.card, overdue && styles.calmCard]} testID="fj-checkin-card">
            <Text style={fjStyles.cardTitle}>
              {overdue ? 'Check-in not received' : `Next check-in around ${dueAt ? clockLabel(dueAt) : ''}`}
            </Text>
            <Text style={fjStyles.cardSub}>
              {overdue
                ? (FJ_SEND_ENABLED
                  ? 'This says nothing about whether you are safe or at risk. Check in whenever you like, ignore this, or tell a contact yourself.'
                  : 'Nothing has been sent and nothing says whether you are safe or at risk. Check in whenever you like, or ignore this.')
                : 'A reminder for you only. There is no deadline and nothing happens if you skip it.'}
            </Text>
            {overdue && contactsFor('missedCheckin').length > 0 ? (
              <Pressable style={(s) => [fjStyles.secondary, focusRingStyle(s)]} onPress={() => openEvent('missedCheckin')} testID="fj-show-missed-preview" accessibilityRole="button" accessibilityLabel={FJ_SEND_ENABLED ? 'Tell a contact my check-in is late' : 'See what this would look like'}>
                <Ionicons name={FJ_SEND_ENABLED ? 'chatbubble-ellipses-outline' : 'eye-outline'} size={16} color={c.navy} />
                <Text style={fjStyles.secondaryTxt}>
                  {FJ_SEND_ENABLED ? 'Tell a contact my check-in is late' : 'See what this would look like'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Journey controls</Text>
          <Pressable
            style={(s) => [fjStyles.primary, { marginTop: 6 }, focusRingStyle(s)]}
            onPress={() => persist({ lastCheckinAt: Date.now() })}
            testID="fj-checkin-now"
            accessibilityRole="button"
            accessibilityLabel="Check in now"
          >
            <Text style={fjStyles.primaryTxt}>Check in now</Text>
          </Pressable>
          <Pressable
            style={(s) => [fjStyles.secondary, focusRingStyle(s)]}
            onPress={async () => {
              await persist({ arrivedAt: Date.now() });
              if (contactsFor('arrival').length > 0) openEvent('arrival');
            }}
            testID="fj-arrived"
            accessibilityRole="button"
            accessibilityLabel="I've arrived"
          >
            <Ionicons name="flag-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>I&rsquo;ve arrived</Text>
          </Pressable>
          <Pressable style={(s) => [fjStyles.secondary, focusRingStyle(s)]} onPress={() => router.push('/family-journey/new')} testID="fj-change-plan" accessibilityRole="button" accessibilityLabel="Change the plan">
            <Ionicons name="create-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>Change the plan</Text>
          </Pressable>
          <Pressable style={(s) => [fjStyles.secondary, focusRingStyle(s)]} onPress={() => router.push('/family-journey/preview')} testID="fj-open-previews" accessibilityRole="button" accessibilityLabel="See all previews">
            <Ionicons name="eye-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>See all previews</Text>
          </Pressable>
          <Pressable style={(s) => [fjStyles.secondary, focusRingStyle(s)]} onPress={() => setAskStop(true)} testID="fj-stop" accessibilityRole="button" accessibilityLabel="Stop journey">
            <Ionicons name="stop-circle-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>Stop journey</Text>
          </Pressable>
        </View>

        {/* Student-initiated help request — deliberate, never automatic. */}
        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Ask a contact for help</Text>
          <Text style={fjStyles.cardSub}>{modeNote('helpRequest')}</Text>
          <Pressable style={(s) => [fjStyles.secondary, focusRingStyle(s)]} onPress={() => setAskHelp(true)} testID="fj-help-request" accessibilityRole="button" accessibilityLabel="Ask for help">
            <Ionicons name="hand-left-outline" size={16} color={c.navy} />
            <Text style={fjStyles.secondaryTxt}>Ask for help</Text>
          </Pressable>
          {journey.helpRequestedAt && (!FJ_SEND_ENABLED || helpOpenedCount > 0) ? (
            <Text style={fjStyles.cardSub}>
              {FJ_SEND_ENABLED
                ? `You opened your SMS app for ${helpOpenedCount} ${helpOpenedCount === 1 ? 'contact' : 'contacts'} at ${clockLabel(helpOpenedAt!)}. Only the ones where you pressed Send received it.`
                : `You previewed a help request at ${clockLabel(journey.helpRequestedAt)}. Nothing was sent.`}
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
            <Text style={fjStyles.empty}>
              {FJ_SEND_ENABLED
                ? 'These choices are saved on this phone. A contact only hears from you when you press Send in your SMS app.'
                : 'These choices are saved on this phone. No contact has been told anything.'}
            </Text>
          ) : null}
        </View>

        <JourneyHelpRow />
      </ScrollView>

      {/* Help-request confirmation → Phase 2 opens the SMS app per contact. */}
      <ConfirmSheet
        visible={askHelp}
        title="Ask for help?"
        body={
          FJ_SEND_ENABLED
            ? (contactsFor('helpRequest').length > 0
              ? `Your SMS app will open for ${contactsFor('helpRequest').map(ct => ct.name).join(', ')}, one at a time. You press Send each time — DHARA sends nothing by itself.`
              : 'No contact has the help-request permission turned on, so there is nobody to message yet. For an emergency use Emergency help instead.')
            : (contactsFor('helpRequest').length > 0
              ? `In a later version this would reach ${contactsFor('helpRequest').map(ct => ct.name).join(', ')}. In this version you will only see what it would look like.`
              : 'No contact has the help-request permission turned on, so you will only see what it would look like.')
        }
        confirmLabel={FJ_SEND_ENABLED ? 'Continue' : 'Show me the preview'}
        onConfirm={async () => {
          setAskHelp(false);
          await persist({ helpRequestedAt: Date.now() });
          openEvent('helpRequest');
        }}
        onCancel={() => setAskHelp(false)}
        testID="fj-help-confirm"
      />

      {/* Stop journey — one tap, no reason required. */}
      <ConfirmSheet
        visible={askStop}
        title="Stop this journey?"
        body={
          FJ_SEND_ENABLED
            ? 'The journey ends on this phone and the plan is removed. No contact is messaged about this.'
            : 'The journey ends on this phone and the plan is removed. Nothing was shared with anyone, so no contact needs to be told.'
        }
        confirmLabel="Stop journey"
        badge="none"
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
        badge="preview"
        onConfirm={() => setShownPreview(null)}
        onCancel={() => setShownPreview(null)}
        hideCancel
        testID="fj-message-preview"
      />

      {/* Phase 2 — one contact per tap, the student presses Send. */}
      <SendSheet
        visible={!!sendMode}
        mode={sendMode}
        journey={journey}
        contacts={sendMode ? contactsFor(sendMode) : []}
        onSent={(contactId, mode) => {
          // Functional update: several contacts can be messaged in one sheet.
          setJourney(prev => {
            if (!prev) return prev;
            const next = withSent(prev, contactId, mode);
            void saveJourney(next);
            return next;
          });
        }}
        onClose={() => setSendMode(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  calmCard: { backgroundColor: c.surfaceSecondary, borderColor: c.borderStrong },
  calmOk: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.success },
});
