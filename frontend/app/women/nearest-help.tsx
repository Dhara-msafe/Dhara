import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { theme } from '@/src/theme';
import { openPhone } from '@/src/women/helpActions';

import { openExternal } from '@/src/outbound';
const c = theme.colors;
const places = [
  { id: 'police', name: 'Police station', query: 'police station near me' },
  { id: 'hospital', name: 'Hospital emergency department', query: 'hospital emergency department near me' },
  { id: 'osc', name: 'One Stop Centre (Sakhi)', query: 'Sakhi One Stop Centre women near me' },
];

export default function NearestHelp() {
  const [status, setStatus] = useState('');
  const insets = useSafeAreaInsets();
  const openMap = async (query: string) => {
    try {
      await openExternal(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
      setStatus('Continue in Maps. Allow location there or enter your area. Check opening hours and call the service before travelling.');
    } catch { setStatus('Maps could not open. Open your map app and search for the service near your area, or call 112 in an emergency.'); }
  };
  return (
    <View style={styles.root} testID="nearest-help-screen">
      <ScreenHeader title="Nearest help" subtitle="Search services near your area" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="nearest-help-guidance" style={styles.note}>Choose a service to search in Maps. DHARA does not have live distances or a verified local directory. Map results, availability and routes are supplied by the map provider.</Text>
        {places.map(place => <Pressable key={place.id} testID={`nearest-${place.id}`} style={styles.card} onPress={() => openMap(place.query)}>
          <Ionicons name="location-outline" size={24} color={c.navy} />
          <Text style={styles.label}>{place.name}</Text><Ionicons name="open-outline" size={20} color={c.navy} />
        </Pressable>)}
        {!!status && <Text testID="nearest-help-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>}
        <Pressable testID="nearest-call-112" style={styles.card} onPress={async () => setStatus(await openPhone('112'))}><Text style={styles.label}>Immediate danger? Call 112</Text></Pressable>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 18 },
  note: { fontFamily: theme.fonts.body, fontSize: 16, lineHeight: 24, color: c.muted },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.lines, backgroundColor: c.surface, padding: 20, borderRadius: 14, minHeight: 60 },
  label: { flex: 1, fontFamily: theme.fonts.bodyBold, fontSize: 17, color: c.navy },
});