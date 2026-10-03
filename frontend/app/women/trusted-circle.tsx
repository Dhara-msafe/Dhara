import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, saveCircle, type Contact } from '@/src/women/api';

const c = theme.colors;

export default function TrustedCircle() {
  const [list, setList] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => { getCircle().then(setList); }, []);

  const add = async () => {
    if (!name.trim() || phone.trim().length < 6 || list.length >= 3) return;
    const next = [...list, { id: Date.now().toString(), name: name.trim(), phone: phone.trim() }];
    setList(next); await saveCircle(next); setName(''); setPhone('');
  };
  const remove = async (id: string) => {
    const next = list.filter(x => x.id !== id); setList(next); await saveCircle(next);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Trusted circle" subtitle="Up to 3 people · stored only on this phone" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={styles.note}>These contacts are kept privately on your device. They are alerted only when you choose to send a safe-journey or silent alert.</Text>

        {list.map(ct => (
          <View key={ct.id} style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{ct.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{ct.name}</Text>
              <Text style={styles.rowPhone}>{ct.phone}</Text>
            </View>
            <Pressable onPress={() => Linking.openURL(`tel:${ct.phone}`)} style={styles.iconBtn}><Ionicons name="call-outline" size={20} color={c.navy} /></Pressable>
            <Pressable onPress={() => remove(ct.id)} style={styles.iconBtn}><Ionicons name="trash-outline" size={20} color={c.error} /></Pressable>
          </View>
        ))}

        {list.length < 3 && (
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>Add a person</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={c.muted} style={styles.input} />
            <TextInput value={phone} onChangeText={setPhone} placeholder="Phone number" placeholderTextColor={c.muted} keyboardType="phone-pad" style={styles.input} />
            <Pressable style={styles.addBtn} onPress={add}><Text style={styles.addBtnTxt}>Add to circle</Text></Pressable>
          </View>
        )}
        {list.length >= 3 && <Text style={styles.full}>Circle full (3 of 3). Remove one to add another.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  note: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 14, marginBottom: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.navy },
  rowName: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  rowPhone: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addCard: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, marginTop: 6 },
  addTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink, marginBottom: 12 },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontFamily: theme.fonts.body, fontSize: 16, color: c.ink, marginBottom: 12 },
  addBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  addBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  full: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, marginTop: 8 },
});
