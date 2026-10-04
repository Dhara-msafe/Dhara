import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, type Contact } from '@/src/women/api';
import { composeAlert } from '@/src/women/helpActions';
import { theme } from '@/src/theme';

const c = theme.colors;
const message = 'I need help. Please contact me and help me reach safety. If I am in immediate danger, contact emergency services.';
export default function SilentAlert() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    getCircle().then(list => { if (active) setContacts(list); }).catch(() => { if (active) setStatus('Could not load your circle. Open Manage circle to try again.'); });
    return () => { active = false; request.current++; setBusy(false); };
  }, []));
  const addLocation = async () => {
    const id = ++request.current;
    setBusy(true); setStatus('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Location permission was not granted. You can still prepare a message without it.');
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (request.current !== id) return;
      setLocation(`My location at ${new Date(point.timestamp).toLocaleString()}: https://maps.google.com/?q=${point.coords.latitude},${point.coords.longitude}`);
    } catch (e: any) { if (request.current === id) setStatus(e.message || 'Location unavailable. Continue without location.'); }
    finally { if (request.current === id) setBusy(false); }
  };
  const body = `${message}${location ? `\n${location}` : ''}`;
  return (
    <View style={styles.root} testID="silent-alert-screen">
      <ScreenHeader title="Silent alert" subtitle="Prepare a message · you choose when to send" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="silent-alert-disclosure" style={styles.note}>This opens your SMS app, not an automatic emergency alert. Review the message and press Send there, separately for each person. SMS service may be required. Your phone or their phone may make sounds; DHARA cannot guarantee silence or delivery.</Text>
        <Text testID="silent-alert-message" selectable style={styles.message}>{body}</Text>
        <Pressable testID="alert-add-location" style={styles.button} disabled={busy} onPress={addLocation}>{busy ? <ActivityIndicator color={c.onBrandPrimary} /> : <Text style={styles.buttonText}>{location ? 'Update location (optional)' : 'Add my location (optional)'}</Text>}</Pressable>
        {(!!location || busy) && <Pressable testID="alert-remove-location" style={styles.secondary} onPress={() => { request.current++; setBusy(false); setLocation(''); }}><Text style={styles.label}>{busy ? 'Continue without location' : 'Remove location'}</Text></Pressable>}
        {contacts.length === 0 && <Text testID="alert-no-contacts" style={styles.note}>No trusted contacts saved. Add a person below, or copy this message to send yourself.</Text>}
        {contacts.map(contact => <Pressable key={contact.id} testID={`alert-contact-${contact.id}`} style={styles.secondary} onPress={async () => setStatus(await composeAlert(contact.phone, body))}><Text style={styles.label}>Prepare SMS to {contact.name}</Text><Text style={styles.note}>{contact.phone}</Text></Pressable>)}
        <Pressable testID="alert-copy-message" style={styles.secondary} onPress={async () => { try { await Clipboard.setStringAsync(body); setStatus('Message copied. No alert has been sent.'); } catch { setStatus('Copy unavailable. Select the message text to copy it.'); } }}><Text style={styles.label}>Copy message</Text></Pressable>
        <Pressable testID="alert-manage-circle" style={styles.secondary} onPress={() => router.push('/women/trusted-circle')}><Text style={styles.label}>Manage trusted circle</Text></Pressable>
        {!!status && <Text testID="silent-alert-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background }, content: { padding: 20, gap: 18 },
  note: { fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 23, color: c.muted },
  message: { padding: 18, backgroundColor: c.surface, borderRadius: 14, fontFamily: theme.fonts.body, fontSize: 16, lineHeight: 24, color: c.ink },
  button: { padding: 16, minHeight: 52, borderRadius: 14, backgroundColor: c.navy, alignItems: 'center' },
  buttonText: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.onBrandPrimary },
  secondary: { padding: 16, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: c.lines, backgroundColor: c.surface },
  label: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.navy },
});