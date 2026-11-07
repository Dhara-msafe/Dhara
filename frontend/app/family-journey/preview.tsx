/**
 * Family Journey — per-contact, per-mode preview (Phase 1).
 * Route: /family-journey/preview
 *
 * Shows, on this device only, exactly what each chosen contact WOULD receive,
 * worded exactly as it would be worded for real. Nothing is sent.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { JourneyHeader, JourneyHelpRow, PreviewBadge, FamilyJourneyOff, fjStyles } from '@/src/familyJourney/ui';
import { isLocalOnly, loadJourney, saveJourney, useFamilyJourneyEnabled, type Journey } from '@/src/familyJourney/store';
import { MODE_META, buildPreview, enabledModes } from '@/src/familyJourney/previewCopy';

const c = theme.colors;

export default function JourneyPreview() {
  const router = useRouter();
  const { user } = useAuth();
  const ownerName = user?.name || 'You';
  const [journey, setJourney] = useState<Journey | null>(null);
  const { enabled, loaded: switchLoaded } = useFamilyJourneyEnabled();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadJourney().then(j => { if (alive) setJourney(j); });
      return () => { alive = false; };
    }, []),
  );

  const start = async () => {
    if (!journey) return;
    const now = Date.now();
    await saveJourney({ ...journey, status: 'active', startedAt: now, lastCheckinAt: now, endedAt: null });
    // Drop the plan/contacts/preview screens so Back from a running journey
    // never reopens the setup flow.
    try {
      router.dismissTo('/family-journey');
      router.push('/family-journey/active');
    } catch {
      router.replace('/family-journey/active');
    }
  };

  const chosen = journey?.contacts ?? [];
  const anySharing = chosen.some(ct => !isLocalOnly(ct));

  if (switchLoaded && !enabled) return <FamilyJourneyOff />;

  return (
    <View style={fjStyles.root} testID="fj-preview-screen">
      <JourneyHeader title="Preview" subtitle={journey?.destination || 'Your journey'} />
      <ScrollView contentContainerStyle={fjStyles.body} showsVerticalScrollIndicator={false}>
        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>What each contact would see</Text>
          <Text style={fjStyles.cardSub}>
            Worded exactly as it would be worded for real — shown on your phone only.
          </Text>
          <PreviewBadge testID="fj-preview-top-badge" />
        </View>

        {chosen.length === 0 ? (
          <View style={fjStyles.card}>
            <View style={fjStyles.pill}><Text style={fjStyles.pillTxt}>LOCAL-ONLY</Text></View>
            <Text style={fjStyles.cardTitle}>Nothing leaves this phone</Text>
            <Text style={fjStyles.cardSub}>
              You have not chosen any contact for this journey. Your check-ins and arrival stay on this device.
            </Text>
          </View>
        ) : !anySharing ? (
          <View style={fjStyles.card}>
            <View style={fjStyles.pill}><Text style={fjStyles.pillTxt}>LOCAL-ONLY</Text></View>
            <Text style={fjStyles.cardTitle}>No sharing turned on</Text>
            <Text style={fjStyles.cardSub}>
              {chosen.map(ct => ct.name).join(', ')} {chosen.length > 1 ? 'are' : 'is'} on this journey, but no
              sharing permission is on — so there would be nothing to show them.
            </Text>
          </View>
        ) : null}

        {chosen.filter(ct => !isLocalOnly(ct)).map(ct => (
          <View key={ct.id} style={styles.group} testID={`fj-preview-contact-${ct.id}`}>
            <Text style={styles.groupTitle}>{ct.name}</Text>
            {enabledModes(ct).map(mode => {
              const p = buildPreview(mode, journey!, ownerName);
              return (
                <View key={mode} style={styles.msgCard} testID={`fj-preview-${mode}-${ct.id}`}>
                  <Text style={styles.msgKind}>{MODE_META[mode].title.toUpperCase()}</Text>
                  <View style={styles.msgBubble}>
                    <View style={styles.msgFrom}>
                      <Ionicons name="shield-outline" size={14} color={c.navy} />
                      <Text style={styles.msgFromTxt}>DHARA</Text>
                    </View>
                    <Text style={styles.msgHeading}>{p.heading}</Text>
                    <Text style={styles.msgBody}>{p.body}</Text>
                  </View>
                  <PreviewBadge testID={`fj-preview-badge-${mode}-${ct.id}`} />
                </View>
              );
            })}
          </View>
        ))}

        <Pressable style={fjStyles.secondary} onPress={() => router.push('/family-journey/contacts')} testID="fj-preview-edit">
          <Ionicons name="create-outline" size={16} color={c.navy} />
          <Text style={fjStyles.secondaryTxt}>Change contacts or permissions</Text>
        </Pressable>

        {journey?.status === 'active' ? (
          <Pressable
            style={fjStyles.primary}
            onPress={() => {
              // Return to the running journey itself, not merely one screen back
              // (the plan/contacts screens may sit in between).
              try { router.dismissTo('/family-journey/active'); }
              catch { router.replace('/family-journey/active'); }
            }}
            testID="fj-preview-back-active"
          >
            <Text style={fjStyles.primaryTxt}>Back to journey</Text>
          </Pressable>
        ) : (
          <Pressable style={fjStyles.primary} onPress={start} disabled={!journey} testID="fj-preview-start">
            <Text style={fjStyles.primaryTxt}>Start journey</Text>
          </Pressable>
        )}

        <JourneyHelpRow />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  groupTitle: { fontFamily: theme.fonts.displayBold, fontSize: 16, color: c.ink, marginTop: 4 },
  msgCard: { backgroundColor: c.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.border, padding: 14 },
  msgKind: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.muted, letterSpacing: 0.4 },
  msgBubble: { backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.md, padding: 14, marginTop: 10, gap: 4 },
  msgFrom: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  msgFromTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.navy, letterSpacing: 0.3 },
  msgHeading: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  msgBody: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, lineHeight: 20 },
});
