/**
 * D-42: the Google Play "prominent disclosure" for background location,
 * shown per journey, BEFORE any OS permission dialog. Play policy requires
 * an in-app disclosure that names the data, the use, and that collection
 * happens while the app is closed or not in use — shown ahead of the
 * runtime permission request. Declining falls back to the existing
 * in-app-only sharing; it never blocks the journey.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { focusRingStyle } from '@/src/a11yFocus';

const c = theme.colors;

export function BgTrackingDisclosure({ visible, onAgree, onDecline }: {
  visible: boolean;
  /** User agreed — the OS permission dialogs may now be shown. */
  onAgree: () => void;
  /** User declined — journey continues with in-app-only sharing. */
  onDecline: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="headout-bg-disclosure" accessibilityViewIsModal>
          <Ionicons name="navigate-circle-outline" size={34} color={c.navy} />
          <Text style={styles.title}>Share your live journey?</Text>
          {/* Play prominent-disclosure wording: data type, purpose, and the
              closed/not-in-use clause, in the user's own terms. */}
          <Text style={styles.body}>
            DHARA collects location data to share your live location with the
            Trusted Circle members you picked for this journey — even when the
            app is closed or not in use.
          </Text>
          <Text style={styles.bodyMuted}>
            A notification stays visible the whole time. Sharing stops on its own
            when you mark yourself safe, check in, or the journey times out — and
            you can stop it any time. This is only for this journey.
          </Text>
          <Pressable
            testID="headout-bg-disclosure-agree"
            style={(s) => [styles.agreeBtn, focusRingStyle(s)]}
            onPress={onAgree}
            accessibilityRole="button"
            accessibilityLabel="Agree — share my live location for this journey, even when the app is closed"
          >
            <Text style={styles.agreeTxt}>Agree — share for this journey</Text>
          </Pressable>
          <Pressable
            testID="headout-bg-disclosure-decline"
            style={(s) => [styles.declineBtn, focusRingStyle(s)]}
            onPress={onDecline}
            accessibilityRole="button"
            accessibilityLabel="No — only share while the app is open"
          >
            <Text style={styles.declineTxt}>No — only while the app is open</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.5)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: c.surface, borderRadius: 16, padding: 22, gap: 10, alignItems: 'center' },
  title: { fontFamily: theme.fonts.bodyBold, fontSize: 18, color: c.ink, textAlign: 'center' },
  body: { fontFamily: theme.fonts.body, fontSize: 14.5, color: c.ink, lineHeight: 21, textAlign: 'center' },
  bodyMuted: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19, textAlign: 'center' },
  agreeBtn: { alignSelf: 'stretch', backgroundColor: c.navy, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  agreeTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: '#fff' },
  declineBtn: { alignSelf: 'stretch', minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  declineTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.muted },
});
