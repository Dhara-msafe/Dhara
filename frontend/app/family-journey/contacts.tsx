/**
 * Family Journey — contact picker + the four independent sharing permissions.
 * Route: /family-journey/contacts
 *
 * READ-ONLY on both Trusted Circle lists: no invitation, message or change is
 * ever made here. Each permission needs its own explicit confirmation and can
 * be turned on or off on its own — they are not stacked levels.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { JourneyHeader, JourneyHelpRow, PreviewBadge, ConfirmSheet, FamilyJourneyOff, fjStyles } from '@/src/familyJourney/ui';
import { loadPickableContacts, type PickableContact } from '@/src/familyJourney/contacts';
import { isLocalOnly, loadJourney, saveJourney, useFamilyJourneyEnabled, type Journey, type JourneyContact } from '@/src/familyJourney/store';
import { MODE_META, buildPreview, type PreviewMode } from '@/src/familyJourney/previewCopy';

const c = theme.colors;
const MODES: PreviewMode[] = ['arrival', 'missedCheckin', 'helpRequest'];

export default function JourneyContacts() {
  const router = useRouter();
  const { token, user } = useAuth();
  const ownerName = user?.name || 'You';

  const [journey, setJourney] = useState<Journey | null>(null);
  const [available, setAvailable] = useState<PickableContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ contactId: string; mode: PreviewMode } | null>(null);
  const { enabled, loaded: switchLoaded } = useFamilyJourneyEnabled();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadJourney().then(j => { if (alive) setJourney(j); });
      return () => { alive = false; };
    }, []),
  );

  useEffect(() => {
    let alive = true;
    loadPickableContacts(token).then(list => {
      if (!alive) return;
      setAvailable(list);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [token]);

  const persist = async (next: Journey) => {
    setJourney(next);
    await saveJourney(next);
  };

  const picked = (id: string) => journey?.contacts.find(ct => ct.id === id);

  const togglePicked = async (ct: PickableContact) => {
    if (!journey) return;
    const exists = picked(ct.id);
    const contacts = exists
      ? journey.contacts.filter(x => x.id !== ct.id)
      : [...journey.contacts, { ...ct, arrival: false, missedCheckin: false, helpRequest: false } as JourneyContact];
    await persist({ ...journey, contacts });
  };

  const setMode = async (contactId: string, mode: PreviewMode, value: boolean) => {
    if (!journey) return;
    const contacts = journey.contacts.map(ct => (ct.id === contactId ? { ...ct, [mode]: value } : ct));
    await persist({ ...journey, contacts });
  };

  const onModeSwitch = (contactId: string, mode: PreviewMode, value: boolean) => {
    if (!value) { setMode(contactId, mode, false); return; }
    setPending({ contactId, mode });           // turning ON always asks first
  };

  const pendingContact = pending ? journey?.contacts.find(ct => ct.id === pending.contactId) : null;
  const pendingPreview = pending && journey ? buildPreview(pending.mode, journey, ownerName) : null;

  if (switchLoaded && !enabled) return <FamilyJourneyOff />;

  if (!journey) {
    return (
      <View style={fjStyles.root} testID="fj-contacts-screen">
        <JourneyHeader title="Choose contacts" />
        <ScrollView contentContainerStyle={fjStyles.body}>
          <Text style={fjStyles.empty}>Plan a journey first, then come back to choose contacts.</Text>
          <Pressable style={fjStyles.primary} onPress={() => router.replace('/family-journey/new')} testID="fj-contacts-plan-first">
            <Text style={fjStyles.primaryTxt}>Plan a journey</Text>
          </Pressable>
          <JourneyHelpRow />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={fjStyles.root} testID="fj-contacts-screen">
      <JourneyHeader title="Choose contacts" subtitle={journey.destination || 'Your journey'} />
      <ScrollView contentContainerStyle={fjStyles.body} showsVerticalScrollIndicator={false}>
        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>From your Trusted Circle</Text>
          <Text style={fjStyles.cardSub}>
            This only reads the contacts you already saved. No invitation and no message is sent to anyone,
            and nothing in your Trusted Circle is changed.
          </Text>
          <PreviewBadge testID="fj-contacts-preview-badge" />
        </View>

        {loading ? (
          <ActivityIndicator color={c.navy} style={{ marginTop: 12 }} />
        ) : available.length === 0 ? (
          <View style={fjStyles.card}>
            <Text style={fjStyles.cardTitle}>No trusted contacts saved yet</Text>
            <Text style={fjStyles.cardSub}>
              You can still keep this journey local-only, or add contacts in your Trusted Circle first.
            </Text>
            <Pressable style={fjStyles.secondary} onPress={() => router.push('/women/trusted-circle')} testID="fj-open-trusted-circle">
              <Text style={fjStyles.secondaryTxt}>Open Trusted Circle</Text>
            </Pressable>
          </View>
        ) : (
          available.map(ct => {
            const sel = picked(ct.id);
            return (
              <View key={ct.id} style={fjStyles.card} testID={`fj-contact-${ct.id}`}>
                <Pressable style={styles.ctRow} onPress={() => togglePicked(ct)} testID={`fj-pick-${ct.id}`}>
                  <View style={[styles.checkbox, sel && styles.checkboxOn]}>
                    {sel ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={fjStyles.cardTitle}>{ct.name}</Text>
                    <Text style={fjStyles.cardSub}>{ct.phone}</Text>
                  </View>
                </Pressable>

                {sel ? (
                  <View style={styles.modes}>
                    <View style={fjStyles.pill}>
                      <Text style={fjStyles.pillTxt}>
                        {isLocalOnly(sel) ? 'LOCAL-ONLY — NOTHING LEAVES THIS PHONE' : 'SHARING CHOICES SAVED ON THIS PHONE'}
                      </Text>
                    </View>
                    {MODES.map(mode => (
                      <View key={mode} style={styles.modeRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modeTitle}>{MODE_META[mode].title}</Text>
                          <Text style={fjStyles.cardSub}>{MODE_META[mode].note}</Text>
                        </View>
                        <Switch
                          testID={`fj-mode-${mode}-${ct.id}`}
                          value={!!sel[mode]}
                          onValueChange={v => onModeSwitch(ct.id, mode, v)}
                          trackColor={{ true: c.navy, false: c.borderStrong }}
                          thumbColor="#fff"
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        <Pressable style={fjStyles.primary} onPress={() => router.push('/family-journey/preview')} testID="fj-contacts-continue">
          <Text style={fjStyles.primaryTxt}>See the preview</Text>
        </Pressable>
        <Text style={fjStyles.empty}>
          You can leave everything local-only. Temporary location sharing is not part of this version at all.
        </Text>

        <JourneyHelpRow />
      </ScrollView>

      <ConfirmSheet
        visible={!!pending}
        title={pending ? `Turn on ${MODE_META[pending.mode].title.toLowerCase()}?` : ''}
        body={
          pending && pendingContact && pendingPreview
            ? `If this were real, ${pendingContact.name} would see:\n\n“${pendingPreview.heading} — ${pendingPreview.body}”\n\n${MODE_META[pending.mode].note} You can turn this off again at any time.`
            : ''
        }
        confirmLabel="Turn it on"
        onConfirm={async () => {
          if (pending) await setMode(pending.contactId, pending.mode, true);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
        testID="fj-mode-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ctRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  checkbox: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: c.borderStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface,
  },
  checkboxOn: { backgroundColor: c.navy, borderColor: c.navy },
  modes: { marginTop: 10, gap: 12, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 12 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modeTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
});
