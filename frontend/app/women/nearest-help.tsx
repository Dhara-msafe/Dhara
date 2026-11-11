import { useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { theme } from '@/src/theme';
import { fetchNearbyPlaces, fetchPlacesTextSearch, type NearbyPlace } from '@/src/women/api';
import { openPhone } from '@/src/women/helpActions';
import { useAuth } from '@/src/auth';

import { openExternal } from '@/src/outbound';
const c = theme.colors;

type Category = 'police' | 'hospital' | 'osc';
const places: { id: Category; name: string; query: string }[] = [
  { id: 'police', name: 'Police station', query: 'police station near me' },
  { id: 'hospital', name: 'Hospital emergency department', query: 'hospital emergency department near me' },
  { id: 'osc', name: 'One Stop Centre (Sakhi)', query: 'Sakhi One Stop Centre women near me' },
];

function formatDistance(m: number | null): string | null {
  if (m == null) return null;
  return m < 1000 ? `${m} m away` : `${(m / 1000).toFixed(1)} km away`;
}

export default function NearestHelp() {
  const [status, setStatus] = useState('');
  const [loadingId, setLoadingId] = useState<Category | null>(null);
  const [results, setResults] = useState<NearbyPlace[] | null>(null);
  const [activePlace, setActivePlace] = useState<{ id: Category; name: string } | null>(null);
  const insets = useSafeAreaInsets();
  const { token: authToken } = useAuth();
  // One-shot device location, requested lazily on first in-app search and
  // cached for the rest of this screen visit — never read continuously,
  // never used for anything but biasing/ranking these search results.
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);

  const openMap = async (query: string) => {
    try {
      await openExternal(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
      setStatus('Continue in Maps. Allow location there or enter your area. Check opening hours and call the service before travelling.');
    } catch { setStatus('Maps could not open. Open your map app and search for the service near your area, or call 112 in an emergency.'); }
  };

  const openResultInMap = async (r: NearbyPlace) => {
    try {
      await openExternal(`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}&query_place_id=${encodeURIComponent(r.place_id)}`);
    } catch { setStatus('Maps could not open. Open your map app and search for this place.'); }
  };

  const ensureLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    if (locationRef.current) return locationRef.current;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return null;
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      locationRef.current = { lat: point.coords.latitude, lng: point.coords.longitude };
      return locationRef.current;
    } catch { return null; }
  };

  const handleSelect = async (place: typeof places[number]) => {
    setStatus('');
    setResults(null);
    setActivePlace(null);
    setLoadingId(place.id);
    try {
      const loc = await ensureLocation();
      let found: NearbyPlace[] = [];
      // N-02: /api/geo/nearby and /api/geo/search-text now require an
      // authenticated session — without one, skip straight to the external
      // Maps fallback below rather than sending a bogus "Bearer null" header.
      if (authToken) {
        if (place.id === 'osc') {
          found = await fetchPlacesTextSearch('Sakhi One Stop Centre women', authToken, loc?.lat, loc?.lng);
        } else if (loc) {
          found = await fetchNearbyPlaces(place.id, loc.lat, loc.lng, authToken);
        }
      }
      // Fail closed to the pre-existing external-Maps action whenever in-app
      // search isn't usable — no location, no session, feature off
      // server-side (503), network error, or zero results. Never a dead end.
      if (found.length === 0) {
        await openMap(place.query);
        return;
      }
      setResults(found);
      setActivePlace({ id: place.id, name: place.name });
    } catch {
      await openMap(place.query);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <View style={styles.root} testID="nearest-help-screen">
      <ScreenHeader title="Nearest help" subtitle="Search services near your area" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="nearest-help-guidance" style={styles.note}>
          Choose a service to search nearby. Results come from Google — DHARA does not verify or maintain this directory, so confirm details and call ahead before travelling.
        </Text>

        {!activePlace && places.map(place => (
          <Pressable
            key={place.id}
            testID={`nearest-${place.id}`}
            style={styles.card}
            disabled={loadingId !== null}
            onPress={() => handleSelect(place)}
          >
            <Ionicons name="location-outline" size={24} color={c.navy} />
            <Text style={styles.label}>{place.name}</Text>
            {loadingId === place.id
              ? <ActivityIndicator size="small" color={c.navy} />
              : <Ionicons name="chevron-forward-outline" size={20} color={c.navy} />}
          </Pressable>
        ))}

        {activePlace && results && (
          <View testID="nearest-help-results">
            <Pressable
              style={styles.backRow}
              onPress={() => { setActivePlace(null); setResults(null); }}
              accessibilityRole="button"
              accessibilityLabel="Back to service list"
              testID="nearest-help-back"
            >
              <Ionicons name="arrow-back-outline" size={18} color={c.navy} />
              <Text style={styles.backTxt}>{activePlace.name}</Text>
            </Pressable>

            {results.map(r => (
              <View key={r.place_id} style={styles.resultCard} testID={`nearest-result-${r.place_id}`}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultName} numberOfLines={2}>{r.name}</Text>
                  {formatDistance(r.distance_meters) && (
                    <Text style={styles.resultDistance}>{formatDistance(r.distance_meters)}</Text>
                  )}
                </View>
                {!!r.address && <Text style={styles.resultAddress} numberOfLines={2}>{r.address}</Text>}
                <View style={styles.resultActions}>
                  {!!r.phone && (
                    <Pressable
                      style={styles.resultBtn}
                      onPress={() => openPhone(r.phone!).then(msg => setStatus(msg))}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${r.name}`}
                      testID={`nearest-result-call-${r.place_id}`}
                    >
                      <Ionicons name="call-outline" size={16} color={c.navy} />
                      <Text style={styles.resultBtnTxt}>Call</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={styles.resultBtn}
                    onPress={() => openResultInMap(r)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${r.name} in Maps`}
                    testID={`nearest-result-maps-${r.place_id}`}
                  >
                    <Ionicons name="open-outline" size={16} color={c.navy} />
                    <Text style={styles.resultBtnTxt}>Open in Maps</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            <Pressable
              style={styles.manualSearchLink}
              onPress={() => openMap(places.find(p => p.id === activePlace.id)!.query)}
              accessibilityRole="button"
              accessibilityLabel="Search in Maps instead"
              testID="nearest-help-manual-search"
            >
              <Text style={styles.manualSearchTxt}>Not finding it? Search in Maps instead</Text>
            </Pressable>
          </View>
        )}

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
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, marginBottom: 4 },
  backTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  resultCard: { borderWidth: 1, borderColor: c.lines, backgroundColor: c.surface, padding: 16, borderRadius: 14, marginBottom: 10 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  resultName: { flex: 1, fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  resultDistance: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  resultAddress: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 4, lineHeight: 18 },
  resultActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  resultBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.navy, backgroundColor: c.navySoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  resultBtnTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  manualSearchLink: { paddingVertical: 10, alignItems: 'center' },
  manualSearchTxt: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, textDecorationLine: 'underline' },
});
