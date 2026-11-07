import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Platform, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import {
  getStoredPhrase,
  storePhrase,
  getHidePhrase,
  setHidePhrase as storeHidePhrase,
  clearHidePhrase,
  phrasesConflict,
  normalizePhrase,
} from '@/src/women/codePhraseStore';
import { useAuth } from '@/src/auth';

const c = theme.colors;
const PRIVACY_COVER_ENABLED = process.env.EXPO_PUBLIC_PRIVACY_COVER_V1 === 'true';

// SOS phrase suggestions (emergency trigger)
const SUGGESTIONS = [
  'Can you bring the blue umbrella?',
  'Did you feed the cat today?',
  'Is grandma\u2019s recipe ready?',
];

// Discreet-screen phrase suggestions (privacy trigger — different from SOS)
const HIDE_SUGGESTIONS = [
  'Has anyone called from home today?',
  'What time is the doctor\u2019s appointment?',
  'Can you check on the kids?',
];

export default function CodePhrase() {
  const { user } = useAuth();
  // scope is used only for the AsyncStorage discreet-active flag (session flag,
  // not sensitive). All phrase storage goes through codePhraseStore.
  const scope = user?.id || 'device';

  // ── SOS phrase (Phase 1 — triggers emergency sequence) ──────────────────────
  const [phrase, setPhrase] = useState('');
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState<boolean | null>(null);
  /** True when the SOS input (not yet saved) conflicts with the persisted hide phrase. */
  const [sosConflictsWithHide, setSosConflictsWithHide] = useState(false);

  // ── Discreet-screen phrase state ────────────────────────────────────────────
  const [hidePhrase, setHidePhrase] = useState('');
  const [hideSaved, setHideSaved] = useState(false);
  const [hideArmed, setHideArmed] = useState<boolean | null>(null);
  const [hideStorageError, setHideStorageError] = useState(false);
  /** Set when the store's persisted-value conflict check rejects a hide save. */
  const [hidePersistedConflict, setHidePersistedConflict] = useState(false);

  // Shake opt-in (PRIVACY_COVER_V1 gate)
  const [shakeOptIn, setShakeOptIn] = useState(false);
  const shakeKey = `ws_shake_opt_in_${user?.id ?? 'device'}`;

  /**
   * Real-time UI hint: both in-state phrases are identical after normalisation.
   * Gives immediate visual feedback while the user is still typing.
   * The actual save path uses persisted-value checks (codePhraseStore) as the
   * authoritative gate, so this hint never needs to be 100% accurate.
   */
  const hideConflictsWithSOS =
    hidePhrase.trim().length > 0 &&
    phrase.trim().length > 0 &&
    phrasesConflict(hidePhrase, phrase);

  // Load SOS phrase on mount
  useEffect(() => {
    getStoredPhrase().then(p => {
      setPhrase(p);
      setArmed(p.trim().length > 0);
    });
  }, []);

  // Load hide phrase from codePhraseStore (SecureStore for auth, in-memory for guests).
  // Depends on `scope` so we re-load when the user logs in/out/switches accounts.
  useEffect(() => {
    getHidePhrase().then(p => {
      setHidePhrase(p);
      setHideArmed(p.trim().length > 0);
    });
    // Load shake opt-in preference
    if (PRIVACY_COVER_ENABLED) {
      AsyncStorage.getItem(shakeKey).then(v => setShakeOptIn(v === 'true')).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // ── SOS phrase actions ───────────────────────────────────────────────────────
  const [saveStorageError, setSaveStorageError] = useState<string | null>(null);

  const save = async () => {
    // Web: double-guard — the Save button is replaced on web, but defend here too.
    if (Platform.OS === 'web') return;
    const trimmedPhrase = phrase.trim();
    // Reverse bidirectional guard: compare the new SOS input against the
    // PERSISTED hide phrase (not the in-state hidePhrase, which may be unsaved).
    // Mirrors saveHide()'s Amendment 1 check: rejects an exact match AND a
    // containment overlap in either direction (a string always "contains"
    // itself, so this also covers the plain-equality case in one check).
    if (trimmedPhrase) {
      const persistedHide = await getHidePhrase();
      if (persistedHide) {
        const nSOS = normalizePhrase(trimmedPhrase);
        const nHide = normalizePhrase(persistedHide);
        if (nHide.length > 0 && (nSOS.includes(nHide) || nHide.includes(nSOS))) {
          setSosConflictsWithHide(true);
          return;
        }
      }
    }
    setSosConflictsWithHide(false);
    setSaveStorageError(null);

    const result = await storePhrase(trimmedPhrase);

    switch (result.outcome) {
      case 'saved':
        // Only set ARMED after the store confirms the phrase was written AND
        // verified via immediate readback. Never set ARMED on any other outcome.
        setArmed(trimmedPhrase.length > 0);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        return;

      case 'unsupported_platform':
        // Should not reach here (web guard above), but be defensive.
        return;

      case 'no_identity':
        setSaveStorageError('Sign in to save your phrase securely on this device.');
        return;

      case 'storage_failure':
        setSaveStorageError('Could not save. Please check available storage and try again.');
        return;

      case 'verification_failure':
        setSaveStorageError('Phrase saved but readback failed — please try again.');
        return;
    }
  };

  const clear = async () => {
    if (Platform.OS === 'web') return;
    const previousPhrase = phrase;
    setSaveStorageError(null);
    setSosConflictsWithHide(false);
    const result = await storePhrase('');

    if (result.outcome === 'saved') {
      // Confirmed removed — safe to show OFF and clear the input.
      setPhrase('');
      setArmed(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    // Removal did NOT succeed — the phrase is still stored and still live.
    // Never show OFF (or an empty input) when the underlying store still
    // holds the old value; that would tell the user the trigger is disabled
    // when it isn't. Restore the displayed phrase and surface a clear error,
    // the same way save() does for every one of its own failure outcomes.
    setPhrase(previousPhrase);
    switch (result.outcome) {
      case 'no_identity':
        setSaveStorageError('Sign in to manage your phrase securely on this device.');
        break;
      case 'verification_failure':
        setSaveStorageError('Removal could not be verified — your phrase is still saved. Please try again.');
        break;
      case 'storage_failure':
      default:
        setSaveStorageError('Could not remove the phrase — it is still saved. Please check available storage and try again.');
        break;
    }
  };

  // ── Discreet-screen phrase actions ──────────────────────────────────────────
  const saveHide = async () => {
    setHidePersistedConflict(false);
    // Fast in-state gate (covers the common case, gives instant UI feedback).
    if (hideConflictsWithSOS) return;
    // Amendment 1: also reject if hide phrase CONTAINS the SOS phrase or vice versa.
    const trimmedHide = hidePhrase.trim();
    if (trimmedHide) {
      try {
        const persistedSOS = await getStoredPhrase();
        if (persistedSOS) {
          const nHide = normalizePhrase(trimmedHide);
          const nSOS  = normalizePhrase(persistedSOS);
          if (nSOS.length > 0 && (nHide.includes(nSOS) || nSOS.includes(nHide))) {
            setHidePersistedConflict(true);
            return;
          }
        }
      } catch {}
    }
    // Delegate to store — it reads PERSISTED SOS for the authoritative check.
    const result = await storeHidePhrase(hidePhrase);
    if (result.conflict) {
      setHidePersistedConflict(true);
      return;
    }
    if (result.storageError) {
      setHideStorageError(true);
      return;
    }
    setHideStorageError(false);
    setHideArmed(result.armed ?? false);
    setHideSaved(true);
    setTimeout(() => setHideSaved(false), 2000);
  };

  const clearHide = async () => {
    const result = await clearHidePhrase();
    if (!result.cleared) {
      setHideStorageError(true);
      return;
    }
    // Also clear the AsyncStorage discreet-active flag so the privacy cover lifts.
    // This flag is a session signal (not sensitive); it intentionally lives in
    // AsyncStorage so the privacy cover component can read it without SecureStore.
    try {
      await AsyncStorage.removeItem(`ws_discreet_active_v1_${scope}`);
    } catch {}
    setHidePhrase('');
    setHideArmed(false);
    setHideStorageError(false);
    setHidePersistedConflict(false);
    setHideSaved(true);
    setTimeout(() => setHideSaved(false), 2000);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Safety phrases" subtitle="Hidden trigger phrases — stored only on this device" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>

        {/* ── SECTION A: SOS phrase ────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>SOS PHRASE</Text>

        {armed !== null && (
          <View style={[styles.statusBadge, armed ? styles.statusArmed : styles.statusOff]}>
            <Ionicons
              name={armed ? 'shield-checkmark' : 'shield-outline'}
              size={16}
              color={armed ? c.verifiedGreen : c.muted}
            />
            <Text style={[styles.statusText, armed ? styles.statusArmedText : styles.statusOffText]}>
              {armed ? 'ARMED \u2713 \u2014 phrase saved securely on this device' : 'OFF \u2014 no phrase saved yet'}
            </Text>
          </View>
        )}

        <Text style={styles.note}>
          Choose a normal-sounding sentence. When you type it in Ask DHARA, it will
          request microphone permission if not already granted, then immediately begin
          local recording {'—'} and prepare your Silent Alert without anyone noticing.
          Stored only on this phone, encrypted.
        </Text>

        {Platform.OS === 'web' && (
          <View style={styles.webNotice}>
            <Ionicons name="phone-portrait-outline" size={16} color={c.muted} />
            <Text style={styles.webNoticeTxt}>
              Secure on-device phrase storage is only available in the DHARA mobile app.
              The phrase cannot be saved or activated from a web browser.
            </Text>
          </View>
        )}

        {/* SOS ↔ Hide conflict notice */}
        {sosConflictsWithHide && (
          <View style={styles.conflictNotice}>
            <Ionicons name="alert-circle-outline" size={16} color="#b45309" />
            <Text style={styles.conflictNoticeTxt}>
              This phrase is the same as, or too close to, your Privacy phrase. Use a different
              sentence so DHARA can tell the two apart.
            </Text>
          </View>
        )}

        {/* Storage error notice */}
        {saveStorageError && (
          <View style={[styles.conflictNotice, { borderColor: c.emergencyRed }]}>
            <Ionicons name="warning-outline" size={16} color={c.emergencyRed} />
            <Text style={[styles.conflictNoticeTxt, { color: c.emergencyRed }]}>{saveStorageError}</Text>
          </View>
        )}

        <TextInput
          value={phrase}
          onChangeText={v => { if (Platform.OS !== 'web') { setPhrase(v); setSosConflictsWithHide(false); setSaveStorageError(null); } }}
          placeholder={Platform.OS === 'web' ? 'Phrase input unavailable on web' : 'Type your code phrase'}
          placeholderTextColor={c.muted}
          style={[styles.input, sosConflictsWithHide && styles.inputConflict, Platform.OS === 'web' && { opacity: 0.45 }]}
          multiline
          editable={Platform.OS !== 'web'}
        />

        {/* On web: replace Save with a capability notice — do NOT show ARMED */}
        {Platform.OS === 'web' ? (
          <View style={styles.webSaveReplace}>
            <Ionicons name="phone-portrait-outline" size={16} color={c.muted} />
            <Text style={styles.webSaveReplaceTxt}>Available in the DHARA mobile app</Text>
          </View>
        ) : (
          <Pressable style={styles.saveBtn} onPress={save}>
            <Ionicons name={saved ? 'checkmark-circle' : 'lock-closed-outline'} size={18} color="#fff" />
            <Text style={styles.saveTxt}>{saved ? 'Saved' : 'Save code phrase'}</Text>
          </Pressable>
        )}

        {/* Remove phrase — only shown when truly armed (storage confirmed) and on native */}
        {armed && Platform.OS !== 'web' && (
          <Pressable style={styles.clearBtn} onPress={clear}>
            <Ionicons name="trash-outline" size={16} color={c.emergencyRed} />
            <Text style={styles.clearTxt}>Remove code phrase</Text>
          </Pressable>
        )}

        <Text style={styles.sugTitle}>Suggestions</Text>
        {SUGGESTIONS.map(s => (
          <Pressable key={s} style={styles.sug} onPress={() => { setPhrase(s); setSosConflictsWithHide(false); }}>
            <Ionicons name="bulb-outline" size={16} color={c.darkGold} />
            <Text style={styles.sugTxt}>{s}</Text>
          </Pressable>
        ))}

        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={18} color={c.navy} />
          <Text style={styles.tipTxt}>
            Type your exact phrase in Ask DHARA to test it. Live voice detection activates on a full app build only.
          </Text>
        </View>

        {/* ── SECTION DIVIDER ──────────────────────────────────────────── */}
        <View style={styles.sectionDivider}>
          <View style={styles.sectionDividerLine} />
        </View>

        {/* ── SECTION B: Privacy / discreet-screen phrase (D1-V) ───────── */}
        <Text style={styles.sectionLabel}>PRIVACY PHRASE</Text>

        {hideArmed !== null && (
          <View style={[styles.statusBadge, hideArmed ? styles.statusHideArmed : styles.statusOff]}>
            <Ionicons
              name={hideArmed ? 'eye-off' : 'eye-off-outline'}
              size={16}
              color={hideArmed ? c.onBrandPrimary : c.muted}
            />
            <Text style={[styles.statusText, hideArmed ? styles.statusHideArmedText : styles.statusOffText]}>
              {hideArmed ? 'ARMED \u2713 \u2014 screen hides on phrase match' : 'OFF \u2014 no privacy phrase saved'}
            </Text>
          </View>
        )}

        <Text style={styles.note}>
          A normal-sounding sentence. When you type it in Ask DHARA, the screen instantly switches
          to private view {'—'} hiding any sensitive content. Nothing is sent to the chat or legal
          engine.
        </Text>

        {Platform.OS === 'web' && (
          <View style={styles.webNotice}>
            <Ionicons name="phone-portrait-outline" size={16} color={c.muted} />
            <Text style={styles.webNoticeTxt}>
              Privacy phrase storage requires the DHARA mobile app. It cannot be saved from a web browser.
            </Text>
          </View>
        )}

        {/* Storage error */}
        {hideStorageError && (
          <View style={styles.errorNotice}>
            <Ionicons name="warning-outline" size={16} color={c.emergencyRed} />
            <Text style={styles.errorNoticeTxt}>
              Could not save to device storage. Please check available space and try again.
            </Text>
          </View>
        )}

        {/* Conflict notice — shown for both real-time in-state check and persisted-value gate */}
        {(hideConflictsWithSOS || hidePersistedConflict) && (
          <View style={styles.conflictNotice}>
            <Ionicons name="alert-circle-outline" size={16} color="#b45309" />
            <Text style={styles.conflictNoticeTxt}>
              This phrase is the same as, or too close to, your SOS phrase. Use a different
              sentence so DHARA can tell the two apart.
            </Text>
          </View>
        )}

        <TextInput
          value={hidePhrase}
          onChangeText={v => { setHidePhrase(v); setHideStorageError(false); setHidePersistedConflict(false); }}
          placeholder="Type your privacy phrase"
          placeholderTextColor={c.muted}
          style={[styles.input, (hideConflictsWithSOS || hidePersistedConflict) && styles.inputConflict]}
          multiline
        />
        <Pressable
          style={[styles.hideSaveBtn, hideConflictsWithSOS && styles.btnDisabled]}
          onPress={saveHide}
          disabled={hideConflictsWithSOS}
        >
          <Ionicons name={hideSaved ? 'checkmark-circle' : 'eye-off-outline'} size={18} color="#fff" />
          <Text style={styles.saveTxt}>{hideSaved ? 'Saved' : 'Save privacy phrase'}</Text>
        </Pressable>
        {hideArmed && (
          <Pressable style={styles.clearBtn} onPress={clearHide}>
            <Ionicons name="trash-outline" size={16} color={c.emergencyRed} />
            <Text style={styles.clearTxt}>Remove privacy phrase</Text>
          </Pressable>
        )}

        <Text style={styles.sugTitle}>Suggestions</Text>
        {HIDE_SUGGESTIONS.map(s => (
          <Pressable key={s} style={styles.sug} onPress={() => setHidePhrase(s)}>
            <Ionicons name="bulb-outline" size={16} color={c.darkGold} />
            <Text style={styles.sugTxt}>{s}</Text>
          </Pressable>
        ))}

        <View style={[styles.tip, styles.tipPrivacy]}>
          <Ionicons name="lock-closed-outline" size={18} color={c.onBrandPrimary} />
          <Text style={[styles.tipTxt, { color: c.onBrandPrimary }]}>
            Stored in OS-protected device storage (authenticated users) or device memory only (guest).
            Phrase matching happens entirely on this phone {'—'} never logged, never sent to any server.
          </Text>
        </View>

        {/* ── Shake opt-in (gated behind PRIVACY_COVER_V1) ── */}
        {PRIVACY_COVER_ENABLED && (
          <View style={styles.shakeSection}>
            <View style={styles.shakeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.shakeLabel}>Shake to hide</Text>
                <Text style={styles.shakeSub}>Shake the device to show the privacy cover. Off by default.</Text>
              </View>
              <Switch
                value={shakeOptIn}
                onValueChange={async v => {
                  setShakeOptIn(v);
                  try { await AsyncStorage.setItem(shakeKey, v ? 'true' : 'false'); } catch {}
                }}
                testID="shake-opt-in-switch"
                accessibilityLabel="Shake to hide toggle"
              />
            </View>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  // Section labels
  sectionLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.muted, letterSpacing: 1.4, marginBottom: 12 },
  note: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginBottom: 18 },
  // Web / error / conflict notices
  webNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 12, marginBottom: 14 },
  webNoticeTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },
  webSaveReplace: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingVertical: 15, marginTop: 14 },
  webSaveReplaceTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted },
  errorNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 12, marginBottom: 14 },
  errorNoticeTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.emergencyRed, lineHeight: 17 },
  conflictNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 12, padding: 12, marginBottom: 14 },
  conflictNoticeTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: '#b45309', lineHeight: 17 },
  // Status badges
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16, borderWidth: 1 },
  statusArmed:     { backgroundColor: '#f0faf4', borderColor: '#b6e8c8' },
  statusHideArmed: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' },
  statusOff:       { backgroundColor: c.surface, borderColor: c.lines },
  statusText:     { fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  statusArmedText:     { color: c.verifiedGreen },
  statusHideArmedText: { color: c.onBrandPrimary },
  statusOffText:       { color: c.muted },
  // Input
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 14, padding: 16, fontFamily: theme.fonts.body, fontSize: 17, color: c.ink, minHeight: 70, textAlignVertical: 'top' },
  inputConflict: { borderColor: '#fcd34d', backgroundColor: '#fffbeb' },
  // Buttons
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 15, marginTop: 14 },
  hideSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.onBrandPrimary, borderRadius: 12, paddingVertical: 15, marginTop: 14 },
  btnDisabled: { opacity: 0.4 },
  saveTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: '#fecaca' },
  clearTxt: { color: c.emergencyRed, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  // Suggestions
  sugTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.onSurfaceTertiary, letterSpacing: 1, marginTop: 26, marginBottom: 10 },
  sug: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14, marginBottom: 10 },
  sugTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink },
  // Tips
  tip: { flexDirection: 'row', gap: 10, backgroundColor: c.navySoft, borderRadius: 12, padding: 14, marginTop: 16 },
  tipPrivacy: { backgroundColor: '#eef2ff' },
  tipTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },
  // Section divider
  sectionDivider: { alignItems: 'center', marginVertical: 32 },
  shakeSection: { marginHorizontal: 20, marginBottom: 28, padding: 16, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines },
  shakeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shakeLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink, marginBottom: 2 },
  shakeSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 18 },
  sectionDividerLine: { width: '100%', height: 1, backgroundColor: c.lines },
});
