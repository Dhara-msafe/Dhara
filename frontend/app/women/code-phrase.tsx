import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getStoredPhrase, storePhrase } from '@/src/women/codePhraseStore';

const c = theme.colors;
const SUGGESTIONS = ['Can you bring the blue umbrella?', 'Did you feed the cat today?', 'Is grandma\u2019s recipe ready?'];

export default function CodePhrase() {
  const [phrase, setPhrase] = useState('');
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    getStoredPhrase().then(p => {
      setPhrase(p);
      setArmed(p.trim().length > 0);
    });
  }, []);

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

  return (
    <View style={styles.root}>
      <ScreenHeader title="Code phrase" subtitle="An ordinary sentence that quietly opens help" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

        {/* Status badge */}
        {armed !== null && (
          <View style={[styles.statusBadge, armed ? styles.statusArmed : styles.statusOff]}>
            <Ionicons
              name={armed ? 'shield-checkmark' : 'shield-outline'}
              size={16}
              color={armed ? c.verifiedGreen : c.muted}
            />
            <Text style={[styles.statusText, armed ? styles.statusArmedText : styles.statusOffText]}>
              {armed ? 'ARMED \u2713 — phrase saved securely on this device' : 'OFF — no phrase saved yet'}
            </Text>
          </View>
        )}

        <Text style={styles.note}>Choose a normal-sounding sentence. When you type it in Ask DHARA, it can quietly start the Evidence Recorder and prepare your Silent Alert — without anyone noticing. It is stored only on this phone, encrypted.</Text>

        {Platform.OS === 'web' && (
          <View style={styles.webNotice}>
            <Ionicons name="phone-portrait-outline" size={16} color={c.muted} />
            <Text style={styles.webNoticeTxt}>
              Secure on-device storage for the code phrase needs the DHARA mobile app — it cannot be saved from this web preview.
            </Text>
          </View>
        )}

        <TextInput value={phrase} onChangeText={setPhrase} placeholder="Type your code phrase" placeholderTextColor={c.muted} style={styles.input} multiline />
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
          <Text style={styles.tipTxt}>Type your exact phrase in Ask DHARA to test it. Live voice detection activates on a full app build only.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  note: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginBottom: 18 },
  webNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 12, marginBottom: 14 },
  webNoticeTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16, borderWidth: 1 },
  statusArmed: { backgroundColor: '#f0faf4', borderColor: '#b6e8c8' },
  statusOff:   { backgroundColor: c.surface, borderColor: c.lines },
  statusText:  { fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  statusArmedText: { color: c.verifiedGreen },
  statusOffText:   { color: c.muted },
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 14, padding: 16, fontFamily: theme.fonts.body, fontSize: 17, color: c.ink, minHeight: 70, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 15, marginTop: 14 },
  saveTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: '#fecaca' },
  clearTxt: { color: c.emergencyRed, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  sugTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.onSurfaceTertiary, letterSpacing: 1, marginTop: 26, marginBottom: 10 },
  sug: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14, marginBottom: 10 },
  sugTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink },
  tip: { flexDirection: 'row', gap: 10, backgroundColor: c.navySoft, borderRadius: 12, padding: 14, marginTop: 16 },
  tipTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },
});
