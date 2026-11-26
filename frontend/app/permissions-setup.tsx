/**
 * First-run permission setup — shown once on a phone, right after the consent
 * page on first launch. Asks for microphone, location (while the app is open
 * only) and notifications with one "Allow" tap, explaining each first.
 * "Skip for now" is always available; every feature still asks again in
 * context if it was skipped or denied. See src/permissions/core.ts.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { SosPill112 } from '@/src/ui/kit';
import { focusRingStyle } from '@/src/a11yFocus';
import { v22SectionLabel } from '@/src/v22SectionLabel';
import { PERMISSION_ITEMS, SETUP_COPY, parseSetupNext, type PermissionKey, type PermissionOutcome } from '@/src/permissions/core';
import { checkPermission, requestPermission, markPermissionSetupDone } from '@/src/permissions/setup';

const colors = theme.colors;

export default function PermissionsSetupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = parseSetupNext(params.next);
  const { continueAsGuest } = useAuth();
  const [state, setState] = useState<Record<PermissionKey, PermissionOutcome | null>>({ microphone: null, location: null, notifications: null });
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries = await Promise.all(PERMISSION_ITEMS.map(async (p) => [p.key, await checkPermission(p.key)] as const));
      if (alive) setState(Object.fromEntries(entries) as Record<PermissionKey, PermissionOutcome>);
    })();
    return () => { alive = false; };
  }, []);

  const finish = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    await markPermissionSetupDone();
    if (next === 'home') { router.replace('/(tabs)/home'); return; }
    if (next === 'signup') { router.replace('/signup'); return; }
    if (next === 'guest') {
      try { await continueAsGuest(); router.replace('/(tabs)/home'); }
      catch { router.replace('/login'); }
      return;
    }
    router.replace('/login');
  }, [next, router, continueAsGuest]);

  const allowAll = useCallback(async () => {
    if (asking) return;
    setAsking(true);
    // One Android prompt at a time, in order. A failure on one never stops the rest.
    for (const p of PERMISSION_ITEMS) {
      const outcome = await requestPermission(p.key);
      setState((s) => ({ ...s, [p.key]: outcome }));
    }
    setAsking(false);
    setAsked(true);
  }, [asking]);

  const allGranted = PERMISSION_ITEMS.every((p) => state[p.key] === 'granted');
  const anyBlocked = PERMISSION_ITEMS.some((p) => state[p.key] === 'blocked');

  return (
    <SafeAreaView style={s.safe} testID="permissions-setup">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
        {/* 27 Nov: SOS 112 at the top, like every other screen (was the floating SOS). */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', minHeight: 48 }}>
          <SosPill112 testID="perm-sos" />
        </View>
        <Text style={s.eyebrow}>{SETUP_COPY.eyebrow}</Text>
        <Text style={s.title} accessibilityRole="header">{SETUP_COPY.title}</Text>
        <Text style={s.intro}>{SETUP_COPY.intro}</Text>

        {PERMISSION_ITEMS.map((p) => {
          const st = state[p.key];
          return (
            <View key={p.key} style={s.card} testID={`perm-${p.key}`}>
              <View style={s.iconBox}><Ionicons name={p.icon as any} size={24} color={colors.navy} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{p.title}</Text>
                <Text style={s.cardWhy}>{p.why}</Text>
                {st === 'blocked' && <Text style={s.blocked}>{SETUP_COPY.blockedHint}</Text>}
              </View>
              {st === 'granted' && (
                <Ionicons name="checkmark-circle" size={24} color={colors.success} accessibilityLabel={`${p.title} allowed`} />
              )}
            </View>
          );
        })}

        {anyBlocked && (
          <Pressable
            testID="perm-open-settings"
            accessibilityRole="button"
            onPress={() => { void Linking.openSettings().catch(() => {}); }}
            style={(st) => [s.linkBtn, focusRingStyle(st)]}
          >
            <Text style={s.link}>{SETUP_COPY.openSettings}</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={s.footer}>
        {asked || allGranted ? (
          <Pressable testID="perm-continue" accessibilityRole="button" onPress={finish}
            style={(st) => [s.primary, st.pressed && s.pressed, focusRingStyle(st)]}>
            <Text style={s.primaryText}>{SETUP_COPY.continue}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable testID="perm-allow" accessibilityRole="button" onPress={allowAll} disabled={asking}
              style={(st) => [s.primary, (st.pressed || asking) && s.pressed, focusRingStyle(st)]}>
              {asking ? <ActivityIndicator color={colors.surface} /> : <Text style={s.primaryText}>{SETUP_COPY.allow}</Text>}
            </Pressable>
            <Pressable testID="perm-skip" accessibilityRole="button" onPress={finish} disabled={asking}
              style={(st) => [s.linkBtn, focusRingStyle(st)]}>
              <Text style={s.link}>{SETUP_COPY.skip}</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  content: { padding: 16, paddingBottom: 24, width: '100%', maxWidth: 680, alignSelf: 'center' },
  eyebrow: v22SectionLabel({ fontSize: 12, fontFamily: 'InterBold', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.muted, marginBottom: 8 }),
  title: { fontFamily: theme.fonts.display, fontSize: 24, color: colors.navy, marginBottom: 10 },
  intro: { fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink, marginBottom: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontFamily: 'InterBold', color: colors.ink },
  cardWhy: { fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2 },
  blocked: { fontSize: 12, fontFamily: 'InterSemiBold', color: colors.muted, marginTop: 6 },
  footer: { padding: 16, paddingTop: 8, width: '100%', maxWidth: 680, alignSelf: 'center' },
  primary: { minHeight: 52, borderRadius: 14, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.surface, fontSize: 15, fontFamily: 'InterBold'},
  pressed: { opacity: 0.85 },
  linkBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  link: { color: colors.navy, fontSize: 14, fontFamily: 'InterSemiBold', textDecorationLine: 'underline' },
});
