import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCodePhrase, saveCodePhrase } from '@/src/women/api';

const c = theme.colors;
const SUGGESTIONS = ['Can you bring the blue umbrella?', 'Did you feed the cat today?', 'Is grandma\u2019s recipe ready?'];

export default function CodePhrase() {
  const [phrase, setPhrase] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { getCodePhrase().then(setPhrase); }, []);

  const save = async () => { await saveCodePhrase(phrase.trim()); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Code phrase" subtitle="An ordinary sentence that quietly opens help" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={styles.note}>Choose a normal-sounding sentence. When you say or type it, DHARA can quietly open the Emergency screen without anyone noticing. It is stored only on this phone.</Text>

        <TextInput value={phrase} onChangeText={setPhrase} placeholder="Type your code phrase" placeholderTextColor={c.muted} style={styles.input} multiline />
        <Pressable style={styles.saveBtn} onPress={save}>
          <Ionicons name={saved ? 'checkmark-circle' : 'lock-closed-outline'} size={18} color="#fff" />
          <Text style={styles.saveTxt}>{saved ? 'Saved' : 'Save code phrase'}</Text>
        </Pressable>

        <Text style={styles.sugTitle}>Suggestions</Text>
        {SUGGESTIONS.map(s => (
          <Pressable key={s} style={styles.sug} onPress={() => setPhrase(s)}>
            <Ionicons name="bulb-outline" size={16} color={c.darkGold} />
            <Text style={styles.sugTxt}>{s}</Text>
          </Pressable>
        ))}

        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={18} color={c.navy} />
          <Text style={styles.tipTxt}>Live voice detection of your phrase activates on a full app build. In Expo Go you can test it from the Ask screen by typing the phrase.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  note: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginBottom: 18 },
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 14, padding: 16, fontFamily: theme.fonts.body, fontSize: 17, color: c.ink, minHeight: 70, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 15, marginTop: 14 },
  saveTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  sugTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.onSurfaceTertiary, letterSpacing: 1, marginTop: 26, marginBottom: 10 },
  sug: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14, marginBottom: 10 },
  sugTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink },
  tip: { flexDirection: 'row', gap: 10, backgroundColor: c.navySoft, borderRadius: 12, padding: 14, marginTop: 16 },
  tipTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },
});
