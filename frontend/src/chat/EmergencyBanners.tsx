/**
 * Emergency call surfaces shown inside the chat screen.
 *
 * Both dial through `openExternal` (the Outbound Guard): the USER initiates
 * the call, nothing is dialled automatically, and neither component depends on
 * an LLM response or on any remaining guest quota.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { openExternal } from '../outbound';

// ── SOS Emergency Banner ────────────────────────────────────────────────────
// Appears after a bare-distress reply (c1_sos SSE flag). Tap any number to
// dial directly. Dismissible with ×. Stays until dismissed or session clears.
const SOS_NUMBERS = [
  { label: '112', desc: 'Emergency' },
  { label: '1091', desc: 'Women' },
  { label: '100', desc: 'Police' },
] as const;

export function SosEmergencyBanner({ onDismiss, language }: { onDismiss: () => void; language: string }) {
  const headline =
    language === 'hi' ? 'तुरंत खतरा? अभी कॉल करें' :
    language === 'mr' ? 'त्वरित धोका? कॉल करा' :
    language === 'ta' ? 'உடனடி ஆபத்து? இப்போது அழைக்கவும்' :
    language === 'te' ? 'అత్యవసరం? ఇప్పుడు కాల్ చేయండి' :
    language === 'bn' ? 'জরুরি বিপদ? এখনই ফোন করুন' :
    'In immediate danger? Call now';

  return (
    <View testID="sos-emergency-banner" style={{
      backgroundColor: theme.colors.emergencyRed,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.sm + 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    }}>
      <Text style={{ fontSize: 18 }}>🆘</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12 }}>{headline}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {SOS_NUMBERS.map(({ label, desc }) => (
            <Pressable
              key={label}
              testID={`sos-call-${label}`}
              onPress={() => openExternal(`tel:${label}`)}
              style={{
                backgroundColor: theme.colors.emergencyDeep,
                borderRadius: 6,
                paddingHorizontal: 10,
                paddingVertical: 10,
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 52,
                minHeight: 44,
              }}
              accessibilityLabel={`Call ${label} — ${desc}`}
              accessibilityRole="button"
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 }}>{label}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 9, fontWeight: '500' }}>{desc}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable
        testID="sos-banner-dismiss"
        onPress={onDismiss}
        hitSlop={12}
        accessibilityLabel="Dismiss emergency banner"
        accessibilityRole="button"
        style={{ padding: 4 }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '300', lineHeight: 22 }}>✕</Text>
      </Pressable>
    </View>
  );
}

// ── Emergency Call Shortcut (quota-independent) ───────────────────────────────
// T5: always-available Call 112 / Call 181 buttons for quota-exhausted guests.
const EMERGENCY_SHORTCUT_NUMBERS = [
  { label: '112', desc: 'Emergency' },
  { label: '181', desc: 'Women Helpline' },
] as const;

export function EmergencyCallShortcut({ language }: { language: string }) {
  const title =
    language === 'hi' ? 'आपात स्थिति में कॉल करें' :
    language === 'mr' ? 'आपत्कालीन स्थितीत कॉल करा' :
    language === 'ta' ? 'அவசரத்தில் அழைக்கவும்' :
    'In an emergency, call';
  return (
    <View testID="emergency-call-shortcut" style={{ gap: 6, marginTop: theme.spacing.sm }}>
      <Text style={{ color: theme.dhara.navy, fontSize: 12, fontWeight: '600' }}>{title}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {EMERGENCY_SHORTCUT_NUMBERS.map(({ label, desc }) => (
          <Pressable
            key={label}
            testID={`emergency-call-${label}`}
            onPress={() => openExternal(`tel:${label}`)}
            accessibilityRole="button"
            accessibilityLabel={`Call ${label} — ${desc}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: theme.colors.emergencyRed,
              borderRadius: 8,
              paddingHorizontal: 14,
              minHeight: 44,
            }}
          >
            <Ionicons name="call" size={16} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>{label}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>{desc}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
