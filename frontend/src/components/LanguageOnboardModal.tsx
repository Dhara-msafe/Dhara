/**
 * LanguageOnboardModal
 * --------------------
 * Shows once per user, right after their first successful login / registration.
 * Two interaction modes — exactly as requested:
 *   1. Voice  — TTS auto-plays "Choose your language" prompt, with a replay icon.
 *   2. Visual — Tappable language-chip grid (top 10 Indian languages + "More").
 *
 * Key persisted in AsyncStorage: `lang_onboarded_v1_<userId>` (or `_guest`).
 * Not shown on consent / language / login / register screens.
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

// Screens where the modal must NOT appear
const EXCLUDED_PATHS = ['/consent', '/language', '/login', '/register', '/welcome'];

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
  const checkedRef = useRef(false);

  // ── Check once whether to show the modal ─────────────────────────────────
  useEffect(() => {
    if (!user || checkedRef.current) return;
    // Don't interrupt sensitive screens
    if (EXCLUDED_PATHS.some(p => pathname?.startsWith(p))) return;
    checkedRef.current = true;

    const key = STORAGE_KEY(user.is_guest ? 'guest' : user.id);
    AsyncStorage.getItem(key).then(v => {
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
    fontFamily: theme.fonts.heading,
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
    fontFamily: theme.fonts.heading,
    fontSize: 17,
    color: '#fff',
  },
});
