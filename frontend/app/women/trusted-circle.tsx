import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, saveCircle, type Contact } from '@/src/women/api';
import { openPhone } from '@/src/women/helpActions';

const c = theme.colors;

export default function TrustedCircle() {
  const [list, setList] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(true);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => { getCircle().then(setList).catch(() => setStatus('Could not load contacts. Please reopen this screen.')).finally(() => setBusy(false)); }, []);

  const add = async () => {
    const number = phone.replace(/[\s()-]/g, '');
    if (!name.trim() || !/^\+?\d{10,15}$/.test(number)) { setStatus('Enter a name and a valid phone number (10–15 digits).'); return; }
    if (busy || list.length >= 3) return;
    if (list.some(ct => ct.phone === number)) { setStatus('This number is already in your circle.'); return; }
    const next = [...list, { id: Date.now().toString(), name: name.trim(), phone: number, notify: true }];
    setBusy(true);
    try { await saveCircle(next); setList(next); setName(''); setPhone(''); setStatus('Contact saved on this device. No message has been sent.'); }
    catch { setStatus('Could not save contact. Please try again.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return;
    const next = list.filter(x => x.id !== id); setBusy(true);
    try { await saveCircle(next); setList(next); setStatus('Contact removed.'); }
    catch { setStatus('Could not remove contact. Please try again.'); }
    finally { setBusy(false); }
  };
  const toggleNotify = async (id: string) => {
    if (busy) return;
    const next = list.map(x => x.id === id ? { ...x, notify: x.notify === false } : x);
    setBusy(true);
    try { await saveCircle(next); setList(next); setStatus('Updated. This only changes what Silent alert suggests — nothing was sent.'); }
    catch { setStatus('Could not update this contact. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} testID="trusted-circle-screen">
      <ScreenHeader title="Trusted circle" subtitle="Up to 3 people · stored only on this phone" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
        <Text testID="circle-disclosure" style={styles.note}>Contacts are saved on this device. DHARA does not automatically alert them or monitor journeys. Tap the bell to choose whether a contact is suggested in Silent alert, or kept for calling only. Use Silent alert to prepare an SMS, then press Send in your messaging app.</Text>
        {!!status && <Text testID="circle-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>}

        {list.map(ct => (
          <View key={ct.id} style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{ct.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{ct.name}</Text>
              <Text style={styles.rowPhone}>{ct.phone}</Text>
              <Text style={styles.rowNotify}>{ct.notify === false ? 'Call only' : 'Notified in Silent alert'}</Text>
            </View>
            <Pressable testID={`circle-toggle-notify-${ct.id}`} disabled={busy} onPress={() => toggleNotify(ct.id)} style={styles.iconBtn}>
              <Ionicons name={ct.notify === false ? 'notifications-off-outline' : 'notifications-outline'} size={20} color={ct.notify === false ? c.muted : c.navy} />
            </Pressable>
            <Pressable testID={`circle-call-${ct.id}`} onPress={async () => setStatus(await openPhone(ct.phone))} style={styles.iconBtn}><Ionicons name="call-outline" size={20} color={c.navy} /></Pressable>
            <Pressable testID={`circle-remove-${ct.id}`} disabled={busy} onPress={() => remove(ct.id)} style={styles.iconBtn}><Ionicons name="trash-outline" size={20} color={c.error} /></Pressable>
          </View>
        ))}

        {list.length < 3 && (
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>Add a person</Text>
            <TextInput testID="circle-name" value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={c.muted} style={styles.input} />
            <TextInput testID="circle-phone" value={phone} onChangeText={setPhone} placeholder="Phone number" placeholderTextColor={c.muted} keyboardType="phone-pad" style={styles.input} />
            <Pressable testID="circle-add" disabled={busy} style={styles.addBtn} onPress={add}><Text style={styles.addBtnTxt}>{busy ? 'Please wait…' : 'Add to circle'}</Text></Pressable>
          </View>
        )}
        {list.length >= 3 && <Text style={styles.full}>Circle full (3 of 3). Remove one to add another.</Text>}
        <Pressable testID="circle-prepare-alert" style={[styles.addBtn, { marginTop: 20 }]} onPress={() => router.dismissTo('/women/silent-alert')}><Text style={styles.addBtnTxt}>Prepare silent alert</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
  rowNotify: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addCard: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, marginTop: 6 },
  addTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink, marginBottom: 12 },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontFamily: theme.fonts.body, fontSize: 16, color: c.ink, marginBottom: 12 },
  addBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  addBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  full: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, marginTop: 8 },
});
