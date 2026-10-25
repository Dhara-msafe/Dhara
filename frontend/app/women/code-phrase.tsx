import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getStoredPhrase, storePhrase } from '@/src/women/codePhraseStore';
import { useAuth } from '@/src/auth';

const c = theme.colors;

// SOS phrase suggestions (emergency trigger)
const SUGGESTIONS = ['Can you bring the blue umbrella?', 'Did you feed the cat today?', 'Is grandma\u2019s recipe ready?'];

// Discreet-screen phrase suggestions (privacy trigger — different from SOS)
const HIDE_SUGGESTIONS = [
  'Has anyone called from home today?',
  'What time is the doctor\u2019s appointment?',
  'Can you check on the kids?',
];

export default function CodePhrase() {
  const { user } = useAuth();
  const scope = user?.id || 'device';

  // ── SOS phrase (Phase 1 — triggers emergency sequence) ──────────────────────
  const [phrase, setPhrase] = useState('');
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState<boolean | null>(null);

  // ── Discreet-screen phrase state ────────────────────────────────────────────
  const [hidePhrase, setHidePhrase] = useState('');
  const [hideSaved, setHideSaved] = useState(false);
  const [hideArmed, setHideArmed] = useState<boolean | null>(null);
  const [hideStorageError, setHideStorageError] = useState(false);

  /** True when both phrases are identical (ambiguous duplicate). */
  const hideConflictsWithSOS =
    hidePhrase.trim().length > 0 &&
    phrase.trim().length > 0 &&
    hidePhrase.trim().toLowerCase() === phrase.trim().toLowerCase();

  // Load SOS phrase
  useEffect(() => {
    getStoredPhrase().then(p => {
      setPhrase(p);
      setArmed(p.trim().length > 0);
    });
  }, []);

  // Load discreet-screen phrase
  useEffect(() => {
    AsyncStorage.getItem(`ws_hide_screen_v1_${scope}`).then(p => {
      const v = p ?? '';
      setHidePhrase(v);
      setHideArmed(v.trim().length > 0);
    });
  }, [scope]);

  // ── SOS phrase actions ───────────────────────────────────────────────────────
  const save = async () => {
    await storePhrase(phrase.trim());
    const nowArmed = phrase.trim().length > 0;
    setArmed(nowArmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clear = async () => {
    setPhrase('');
    await storePhrase('');
    setArmed(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Discreet-screen phrase actions ──────────────────────────────────────────
  const saveHide = async () => {
    if (hideConflictsWithSOS) return;   // blocked — user must resolve conflict first
    const v = hidePhrase.trim();
    try {
      if (v) {
        await AsyncStorage.setItem(`ws_hide_screen_v1_${scope}`, v);
      } else {
        await AsyncStorage.removeItem(`ws_hide_screen_v1_${scope}`);
      }
      setHideStorageError(false);
      setHideArmed(v.length > 0);
      setHideSaved(true);
      setTimeout(() => setHideSaved(false), 2000);
    } catch {
      setHideStorageError(true);
    }
  };

  const clearHide = async () => {
    try {
      await AsyncStorage.removeItem(`ws_hide_screen_v1_${scope}`);
      // Also clear the active flag so the privacy cover does not persist
      await AsyncStorage.removeItem(`ws_discreet_active_v1_${scope}`);
      setHidePhrase('');
      setHideArmed(false);
      setHideStorageError(false);
      setHideSaved(true);
      setTimeout(() => setHideSaved(false), 2000);
    } catch {
      setHideStorageError(true);
    }
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
          Choose a normal-sounding sentence. When you type it in Ask DHARA, it can quietly start
          the Evidence Recorder and prepare your Silent Alert \u2014 without anyone noticing.
          Stored only on this phone, encrypted.
        </Text>

        {Platform.OS === 'web' && (
          <View style={styles.webNotice}>
            <Ionicons name="phone-portrait-outline" size={16} color={c.muted} />
            <Text style={styles.webNoticeTxt}>
              Secure on-device storage for the code phrase needs the DHARA mobile app \u2014 it cannot be saved from this web preview.
            </Text>
          </View>
        )}

        <TextInput
          value={phrase}
          onChangeText={setPhrase}
          placeholder="Type your code phrase"
          placeholderTextColor={c.muted}
          style={styles.input}
          multiline
        />
        <Pressable style={styles.saveBtn} onPress={save}>
          <Ionicons name={saved ? 'checkmark-circle' : 'lock-closed-outline'} size={18} color="#fff" />
          <Text style={styles.saveTxt}>{saved ? 'Saved' : 'Save code phrase'}</Text>
        </Pressable>
        {armed && (
          <Pressable style={styles.clearBtn} onPress={clear}>
            <Ionicons name="trash-outline" size={16} color={c.emergencyRed} />
            <Text style={styles.clearTxt}>Remove code phrase</Text>
          </Pressable>
        )}

        <Text style={styles.sugTitle}>Suggestions</Text>
        {SUGGESTIONS.map(s => (
          <Pressable key={s} style={styles.sug} onPress={() => setPhrase(s)}>
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
          to private view \u2014 hiding any sensitive content. Nothing is sent to the chat or legal
          engine.
        </Text>

        {Platform.OS === 'web' && (
          <View style={styles.webNotice}>
            <Ionicons name="phone-portrait-outline" size={16} color={c.muted} />
            <Text style={styles.webNoticeTxt}>
              Privacy phrase storage requires the DHARA mobile app \u2014 it cannot be saved from this web preview.
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

        {/* Duplicate-phrase conflict warning */}
        {hideConflictsWithSOS && (
          <View style={styles.conflictNotice}>
            <Ionicons name="alert-circle-outline" size={16} color="#b45309" />
            <Text style={styles.conflictNoticeTxt}>
              This phrase is identical to your SOS phrase. Use a different sentence so DHARA
              can tell the two apart.
            </Text>
          </View>
        )}

        <TextInput
          value={hidePhrase}
          onChangeText={v => { setHidePhrase(v); setHideStorageError(false); }}
          placeholder="Type your privacy phrase"
          placeholderTextColor={c.muted}
          style={[styles.input, hideConflictsWithSOS && styles.inputConflict]}
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
            Stored in device memory only. Phrase matching happens entirely on this phone \u2014
            never logged, never sent to any server.
          </Text>
        </View>

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
  sectionDividerLine: { width: '100%', height: 1, backgroundColor: c.lines },
});
