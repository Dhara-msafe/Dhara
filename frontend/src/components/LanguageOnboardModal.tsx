/**
 * LanguageOnboardModal
 * --------------------
 * Shows once per user, right after their first successful login / registration.
 * Two interaction modes — exactly as requested:
 *   1. Voice  — TTS auto-plays "Choose your language" prompt, with a replay icon.
 *   2. Visual — Tappable language-chip grid (top 10 Indian languages + "More").
 *
 * Key persisted in AsyncStorage: `lang_onboarded_v1_<userId>` (or `_guest`).
 * Not shown on consent / language / login / register / state-selection screens.
 *
 * P0 fix (consent-overlay bug): the eligibility check used to be a true
 * one-shot (`checkedRef.current`, set forever on first non-excluded route)
 * with no logic to ever close the modal again. Signup briefly passes through
 * /state?onboarding=1 (NOT in the exclusion list) before ConsentGuard
 * redirects to /consent — the modal opened there and then had no mechanism
 * to close itself once the route became /consent, silently intercepting
 * every tap on the real consent checkboxes underneath. Fixed by: (1) adding
 * /state to EXCLUDED_PATHS, (2) making exclusion checking REACTIVE (closes
 * the modal immediately if navigation ever lands on an excluded route,
 * regardless of any earlier decision), (3) scoping the one-shot check
 * per-ACCOUNT instead of forever, resetting `visible` on every account
 * change, and (4) guarding the async AsyncStorage read against a stale
 * route/account by the time it resolves.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth, type Language } from '@/src/auth';
import { useScreenSpeech } from '@/src/hooks/useScreenSpeech';
import { theme } from '@/src/theme';
import { trackEvent } from '@/src/analytics';

const c = theme.colors;

// ── Language data (top 10 by speaker population + English) ───────────────────
const TOP_LANGUAGES: Language[] = [
  { code: 'en',  name: 'English',   native: 'English',    tts: 'en-IN'  },
  { code: 'hi',  name: 'Hindi',     native: 'हिन्दी',     tts: 'hi-IN'  },
  { code: 'bn',  name: 'Bengali',   native: 'বাংলা',      tts: 'bn-IN'  },
  { code: 'ta',  name: 'Tamil',     native: 'தமிழ்',       tts: 'ta-IN'  },
  { code: 'te',  name: 'Telugu',    native: 'తెలుగు',     tts: 'te-IN'  },
  { code: 'mr',  name: 'Marathi',   native: 'मराठी',      tts: 'mr-IN'  },
  { code: 'gu',  name: 'Gujarati',  native: 'ગુજરાતી',    tts: 'gu-IN'  },
  { code: 'kn',  name: 'Kannada',   native: 'ಕನ್ನಡ',     tts: 'kn-IN'  },
  { code: 'ml',  name: 'Malayalam', native: 'മലയാളം',    tts: 'ml-IN'  },
  { code: 'pa',  name: 'Punjabi',   native: 'ਪੰਜਾਬੀ',    tts: 'pa-IN'  },
];

// Screens where the modal must NOT appear. '/state' added (P0 fix) — signup
// briefly passes through /state?onboarding=1 before ConsentGuard redirects
// to /consent; without this, the modal could open there and persist.
const EXCLUDED_PATHS = ['/consent', '/language', '/login', '/register', '/welcome', '/state'];

const STORAGE_KEY = (uid: string) => `lang_onboarded_v1_${uid}`;

// TTS prompt — kept very short so it loads in ~1.5 s
const VOICE_PROMPT = 'Choose your language for DHARA.';

// ── Component ─────────────────────────────────────────────────────────────────

export function LanguageOnboardModal() {
  const { user, language, setLanguage } = useAuth();
  const { listen, stop, speaking } = useScreenSpeech();
  const router   = useRouter();
  const pathname = usePathname();
  const insets   = useSafeAreaInsets();

  const [visible,  setVisible]  = useState(false);
  const [selected, setSelected] = useState<Language>(language);
  const [saving,   setSaving]   = useState(false);
  // One-shot PER ACCOUNT (not forever) — tracks which user id the eligibility
  // check has already been decided for. A different uid (including null, on
  // sign-out) means "decide fresh"; the same uid means "don't re-check".
  const checkedForUidRef = useRef<string | null>(null);
  // Mirrors the live pathname so the async AsyncStorage callback below can
  // check the CURRENT route at resolution time, not the one captured in the
  // effect's closure when the check started.
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // ── Decide whether to show the modal — reactive to BOTH account changes
  // and route changes, so the modal can never stay latched across either. ──
  useEffect(() => {
    const uid = user ? (user.is_guest ? 'guest' : user.id) : null;

    // Account changed (including sign-out, uid -> null) since our last
    // decision: never let a different account's modal state leak across a
    // switch. This also re-arms the one-shot check for the new account.
    if (checkedForUidRef.current !== uid) {
      setVisible(false);
    }

    const onExcludedRoute = EXCLUDED_PATHS.some(p => pathname?.startsWith(p));
    if (onExcludedRoute) {
      // Never open here, and close immediately if we land here while open —
      // regardless of any decision made earlier on a different route.
      setVisible(false);
      return;
    }
    if (!user) return;
    if (checkedForUidRef.current === uid) return; // already decided for this account
    checkedForUidRef.current = uid;

    const key = STORAGE_KEY(uid as string);
    AsyncStorage.getItem(key).then(v => {
      // Race guard: only honour this async result if, by the time it
      // resolves, we're still on a non-excluded route for this SAME account.
      if (EXCLUDED_PATHS.some(p => pathnameRef.current?.startsWith(p))) return;
      if (checkedForUidRef.current !== uid) return;
      if (!v) setVisible(true);
    }).catch(() => {});
  }, [user, pathname]);

  // ── Auto-speak when modal opens ───────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    // Small delay so the modal animation finishes before audio starts
    const t = setTimeout(() => { listen(VOICE_PROMPT); }, 600);
    return () => { clearTimeout(t); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const replay = useCallback(() => {
    stop();
    setTimeout(() => listen(VOICE_PROMPT), 150);
  }, [listen, stop]);

  const onConfirm = useCallback(async () => {
    setSaving(true);
    try {
      stop();
      await setLanguage(selected);
      const key = STORAGE_KEY(user?.is_guest ? 'guest' : (user?.id ?? 'guest'));
      await AsyncStorage.setItem(key, '1');
      trackEvent('lang_onboard_selected', { lang: selected.code });
      setVisible(false);
    } finally {
      setSaving(false);
    }
  }, [selected, setLanguage, stop, user]);

  const openFullList = useCallback(() => {
    stop();
    // Dismiss first, then navigate so back returns here
    setVisible(false);
    setTimeout(() => router.push({ pathname: '/language', params: { from: 'home' } }), 200);
  }, [router, stop]);

  // ── Render chip ───────────────────────────────────────────────────────────
  const renderChip = useCallback(({ item }: { item: Language }) => {
    const active = item.code === selected.code;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={item.name}
        accessibilityState={{ checked: active }}
        style={[styles.chip, active && styles.chipActive]}
        onPress={() => setSelected(item)}
      >
        <Text style={[styles.chipNative, active && styles.chipNativeActive]}>
          {item.native}
        </Text>
        <Text style={[styles.chipName, active && styles.chipNameActive]}>
          {item.name}
        </Text>
      </Pressable>
    );
  }, [selected.code]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => { /* intentionally non-dismissible */ }}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>

          {/* Header row */}
          <View style={styles.headerRow}>
            <Pressable
              accessibilityLabel="Replay language prompt"
              accessibilityRole="button"
              style={styles.speakerBtn}
              onPress={replay}
              hitSlop={12}
            >
              {speaking
                ? <ActivityIndicator size="small" color={c.primary} />
                : <Ionicons name="volume-high" size={22} color={c.primary} />}
            </Pressable>

            <View style={styles.titleBlock}>
              <Text style={styles.title}>Choose your language</Text>
              <Text style={styles.sub}>
                अपनी भाषा चुनें · ভাষা বেছে নিন · மொழி தேர்வு
              </Text>
            </View>
          </View>

          <Text style={styles.hint}>
            DHARA will speak and respond in your chosen language.
          </Text>

          {/* Language chip grid */}
          <FlatList
            data={TOP_LANGUAGES}
            renderItem={renderChip}
            keyExtractor={i => i.code}
            numColumns={2}
            scrollEnabled={false}
            columnWrapperStyle={styles.chipRow}
            style={styles.chipGrid}
            accessibilityLabel="Language list"
          />

          {/* More languages */}
          <Pressable
            accessibilityRole="button"
            style={styles.moreBtn}
            onPress={openFullList}
          >
            <Text style={styles.moreTxt}>More languages</Text>
            <Ionicons name="chevron-forward" size={14} color={c.primary} />
          </Pressable>

          {/* Continue button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Continue with ${selected.name}`}
            style={[styles.continueBtn, saving && styles.continueBtnDisabled]}
            onPress={onConfirm}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.continueTxt}>Continue in {selected.native}</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
    // Defensive stacking fix: on web (react-native-web), a custom-styled
    // bottom tab bar can occasionally share the same stacking context as a
    // portaled Modal, letting a tap land on the tab bar underneath instead
    // of this sheet. Pin this overlay unambiguously above everything,
    // including the tab bar, on every platform.
    zIndex: 9999,
    elevation: 24,
  },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    // Android elevation
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  speakerBtn: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: `${c.primary}12`,
    borderRadius: 22,
    marginTop: 2,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 20,
    color: c.ink,
    marginBottom: 2,
  },
  sub: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: c.muted,
    lineHeight: 17,
  },
  hint: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: c.muted,
    marginBottom: 16,
  },
  chipGrid: {
    marginBottom: 4,
  },
  chipRow: {
    gap: 10,
    marginBottom: 10,
  },
  chip: {
    flex: 1,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: c.primary,
    backgroundColor: `${c.primary}10`,
  },
  chipNative: {
    fontFamily: theme.fonts.bodySemiBold,
    fontSize: 15,
    color: c.ink,
  },
  chipNativeActive: {
    color: c.primary,
  },
  chipName: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: c.muted,
    marginTop: 2,
  },
  chipNameActive: {
    color: c.primary,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    marginBottom: 4,
  },
  moreTxt: {
    fontFamily: theme.fonts.bodySemiBold,
    fontSize: 14,
    color: c.primary,
  },
  continueBtn: {
    backgroundColor: c.primary,
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  continueBtnDisabled: {
    opacity: 0.6,
  },
  continueTxt: {
    fontFamily: theme.fonts.display,
    fontSize: 17,
    color: '#fff',
  },
});
