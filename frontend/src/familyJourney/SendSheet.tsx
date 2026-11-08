/**
 * Family Journey — Phase 2 send sheet.
 *
 * Lists every contact that holds the permission for this event and opens the
 * student's SMS app for one contact per tap. The sheet never claims delivery:
 * it only reports that the SMS app opened, because the app cannot know whether
 * the student pressed Send.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { fjStyles } from './ui';
import { MODE_META, smsBody, type PreviewMode } from './previewCopy';
import { sendToContact, type SendOutcome } from './send';
import type { Journey, JourneyContact } from './store';

const c = theme.colors;

export function SendSheet({
  visible, mode, journey, contacts, onSent, onClose,
}: {
  visible: boolean;
  mode: PreviewMode | null;
  journey: Journey;
  contacts: JourneyContact[];
  onSent: (contactId: string, mode: PreviewMode) => void;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, SendOutcome>>({});

  if (!mode) return null;

  const run = async (ct: JourneyContact) => {
    setBusyId(ct.id);
    const outcome = await sendToContact(ct, mode, journey);
    setOutcomes(prev => ({ ...prev, [ct.id]: outcome }));
    setBusyId(null);
    if (outcome === 'composer') onSent(ct.id, mode);
  };

  const close = () => { setOutcomes({}); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="fj-send-sheet">
          <ScrollView bounces={false} contentContainerStyle={{ gap: 12 }}>
            <Text style={styles.title}>{MODE_META[mode].title}</Text>
            <Text style={styles.body}>
              DHARA cannot send a message by itself. For each contact below your SMS app opens with this
              text ready — you press Send there.
            </Text>

            <View style={styles.bubble}>
              <Text style={styles.bubbleTxt} selectable>{smsBody(mode, journey)}</Text>
            </View>

            {contacts.length === 0 ? (
              <Text style={fjStyles.empty}>
                No contact has this permission turned on, so there is nobody to message. You can turn it on
                in “Change contacts or permissions”.
              </Text>
            ) : (
              contacts.map(ct => {
                const outcome = outcomes[ct.id];
                return (
                  <View key={ct.id} style={styles.row} testID={`fj-send-row-${ct.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{ct.name}</Text>
                      <Text style={fjStyles.cardSub}>{ct.phone}</Text>
                      {outcome === 'composer' ? (
                        <Text style={styles.ok}>SMS app opened — press Send there to deliver it.</Text>
                      ) : outcome === 'blocked' ? (
                        <Text style={styles.bad}>Nothing was opened — see the notice shown just now for the reason.</Text>
                      ) : outcome === 'failed' ? (
                        <Text style={styles.bad}>Your SMS app could not be opened. You can copy the text above and send it yourself.</Text>
                      ) : null}
                    </View>
                    <Pressable
                      style={[fjStyles.secondary, styles.btn]}
                      onPress={() => run(ct)}
                      disabled={busyId === ct.id}
                      testID={`fj-send-${ct.id}`}
                    >
                      {busyId === ct.id ? (
                        <ActivityIndicator color={c.navy} size="small" />
                      ) : (
                        <>
                          <Ionicons name="chatbubble-ellipses-outline" size={16} color={c.navy} />
                          <Text style={fjStyles.secondaryTxt}>{outcome === 'composer' ? 'Open again' : 'Open SMS'}</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>

          <Pressable style={fjStyles.primary} onPress={close} testID="fj-send-close">
            <Text style={fjStyles.primaryTxt}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(14,39,64,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
    padding: 20, paddingBottom: 28, gap: 14, maxHeight: '85%',
  },
  title: { fontFamily: theme.fonts.displayBold, fontSize: 19, color: c.ink },
  body: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20 },
  bubble: { backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.border, padding: 14 },
  bubbleTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 12 },
  name: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.ink },
  btn: { paddingHorizontal: 14, minWidth: 128 },
  ok: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.success, marginTop: 4, lineHeight: 17 },
  bad: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.error, marginTop: 4, lineHeight: 17 },
});
