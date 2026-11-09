/**
 * PrivacyCover — opaque full-screen privacy cover.
 *
 * Rendered inside a React Native <Modal> by PrivacyCoverGate (_layout.tsx) so
 * it stacks above all other views including the Evidence Locker and any open
 * modals (React Native Modal stacking is last-visible-on-top).
 *
 * WHAT THIS COVER DOES:
 *   Hides sensitive app content immediately on activation.
 *   Stays visible until the user deliberately taps "Show DHARA again".
 *
 * WHAT THIS COVER DOES NOT DO (displayed on screen):
 *   Does not lock the app, erase history, or hide notifications from
 *   the OS notification shade.
 *
 * EMERGENCY ACCESS:
 *   "Emergency 112" initiates a direct phone call.  It is not gated behind
 *   any authentication and is always tappable regardless of cover state.
 *
 * GATE: EXPO_PUBLIC_PRIVACY_COVER_V1 === 'true' (enforced by PrivacyCoverGate).
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

import { openExternal } from '@/src/outbound';
const c = theme.colors;

export interface PrivacyCoverProps {
  /** Called when the user deliberately taps "Show DHARA again". */
  onReveal: () => void;
}

export function PrivacyCover({ onReveal }: PrivacyCoverProps) {
  const insets = useSafeAreaInsets();

  const call112 = () => {
    openExternal('tel:112').catch(() => {});
  };

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) },
      ]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      {/* Icon */}
      <View style={styles.iconWrap}>
        <Ionicons name="eye-off-outline" size={44} color={c.muted} />
      </View>

      {/* Heading */}
      <Text style={styles.heading}>Sensitive content hidden</Text>

      {/* Caveat — no words: locked, protected, secure, verified, approved */}
      <Text style={styles.caveat}>
        This does not lock the app, erase your history, or hide notifications
        from the OS notification shade.
      </Text>

      {/* Restore button — deliberate user action required */}
      <Pressable
        style={styles.revealBtn}
        onPress={onReveal}
        accessibilityRole="button"
        accessibilityLabel="Show DHARA again"
        testID="privacy-cover-reveal"
      >
        <Text style={styles.revealTxt}>Show DHARA again</Text>
      </Pressable>

      <View style={{ flex: 1 }} />

      {/* Emergency access — always visible, not presented as authentication */}
      <Pressable
        style={styles.emergencyBtn}
        onPress={call112}
        accessibilityRole="button"
        accessibilityLabel="Emergency call 112"
        testID="privacy-cover-emergency"
      >
        <Ionicons name="call-outline" size={18} color="#fff" />
        <Text style={styles.emergencyTxt}>Emergency 112</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.background,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 32,
  },
  iconWrap: {
    marginTop: 48,
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: c.lines,
  },
  heading: {
    fontFamily: theme.fonts.displayBold,
    fontSize: 22,
    color: c.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  caveat: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: c.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
    maxWidth: 280,
  },
  revealBtn: {
    backgroundColor: c.navy,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
  },
  revealTxt: {
    color: '#fff',
    fontFamily: theme.fonts.bodyBold,
    fontSize: 16,
  },
  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#DC2626',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginBottom: 8,
  },
  emergencyTxt: {
    color: '#fff',
    fontFamily: theme.fonts.bodyBold,
    fontSize: 16,
  },
});
