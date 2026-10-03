import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { SosPill } from '@/src/components/dhara/SosPill';

const c = theme.colors;

type Card = { icon: any; title: string; sub: string; route: string; isNew?: boolean };
type Group = { id: string; label: string; cards: Card[] };

export default function AllHelp() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useAuth();
  const lang = language.code;
  const [filter, setFilter] = useState('all');

  const groups: Group[] = useMemo(() => [
    { id: 'safety', label: tr('all.sec.safety', lang), cards: [
      { icon: 'shield-half', title: tr('j.shield', lang), sub: tr('all.shield.sub', lang), route: '/women-shield', isNew: true },
      { icon: 'people-outline', title: tr('j.missing', lang), sub: tr('all.missing.sub', lang), route: '/missing' },
      { icon: 'warning-outline', title: tr('all.emergency', lang), sub: tr('all.emergency.sub', lang), route: '/emergency' },
      { icon: 'heart-outline', title: tr('all.children', lang), sub: tr('all.children.sub', lang), route: '/action-plan' },
    ] },
    { id: 'police', label: tr('all.sec.police', lang), cards: [
      { icon: 'ribbon-outline', title: tr('j.police', lang), sub: tr('all.shield.sub', lang), route: '/fir-draft' },
      { icon: 'search-outline', title: tr('all.checkcase', lang), sub: tr('all.checkcase.sub', lang), route: '/(tabs)/lookup' },
      { icon: 'library-outline', title: tr('all.bail', lang), sub: tr('all.bail.sub', lang), route: '/action-plan' },
    ] },
    { id: 'everyday', label: tr('all.sec.everyday', lang), cards: [
      { icon: 'cart-outline', title: tr('j.consumer', lang), sub: tr('all.consumer.sub', lang), route: '/action-plan' },
      { icon: 'home-outline', title: tr('all.rent', lang), sub: tr('all.rent.sub', lang), route: '/action-plan' },
      { icon: 'briefcase-outline', title: tr('all.work', lang), sub: tr('all.work.sub', lang), route: '/action-plan' },
      { icon: 'checkbox-outline', title: tr('j.voter', lang), sub: tr('all.voter.sub', lang), route: '/(tabs)/voter-roll' },
      { icon: 'desktop-outline', title: tr('j.cyber', lang), sub: tr('all.cyber.sub', lang), route: '/fraud-checklist' },
    ] },
    { id: 'safety', label: tr('all.sec.visitor', lang), cards: [
      { icon: 'globe-outline', title: tr('all.intlvisitor', lang), sub: tr('all.intlvisitor.sub', lang), route: '/visitor' },
    ] },
  ], [lang]);

  const filtered = filter === 'all' ? groups : groups.filter(g => g.id === filter);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headRow}>
          <Text style={styles.title}>{tr('all.title', lang)} <Text style={styles.titleHi}>सारी मदद</Text></Text>
          <SosPill />
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput placeholder={tr('all.search', lang)} placeholderTextColor={c.muted} style={styles.search} />
          <Pressable style={styles.searchMic} onPress={() => router.push('/(tabs)')}>
            <Ionicons name="mic" size={18} color={c.navy} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {[['all', 'all.f.all'], ['safety', 'all.f.safety'], ['police', 'all.f.police'], ['everyday', 'all.f.everyday']].map(([id, key]) => (
            <Pressable key={id} style={[styles.filterChip, filter === id && styles.filterChipActive]} onPress={() => setFilter(id)}>
              <Text style={[styles.filterTxt, filter === id && styles.filterTxtActive]}>{tr(key, lang)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {filtered.map((g, gi) => (
          <View key={g.label + gi} style={styles.section}>
            <Text style={styles.secLabel}>{g.label}</Text>
            <View style={styles.grid}>
              {g.cards.map(card => (
                <Pressable key={card.title} style={styles.card} onPress={() => router.push(card.route as any)}>
                  {card.isNew && <View style={styles.newBadge}><Text style={styles.newTxt}>{tr('common.new', lang)}</Text></View>}
                  <Ionicons name={card.icon} size={24} color={c.navy} />
                  <Text style={styles.cardTitle} numberOfLines={2}>{card.title}</Text>
                  <Text style={styles.cardSub} numberOfLines={2}>{card.sub}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {filter === 'all' && (
          <View style={styles.section}>
            <Text style={styles.secLabel}>{tr('all.sec.soon', lang)}</Text>
            <View style={styles.grid}>
              {[['map-outline', tr('all.land', lang)], ['document-text-outline', tr('all.rti', lang)]].map(([icon, title]) => (
                <View key={title} style={[styles.card, styles.cardSoon]}>
                  <Ionicons name={icon as any} size={24} color={c.muted} />
                  <Text style={[styles.cardTitle, { color: c.muted }]}>{title}</Text>
                  <Text style={styles.cardSub}>{tr('all.soon', lang)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: theme.fonts.displayBold, fontSize: 28, color: c.ink },
  titleHi: { color: c.darkGold, fontSize: 20 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 14, paddingHorizontal: 14, height: 52, marginTop: 16 },
  search: { flex: 1, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink },
  searchMic: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 10, paddingVertical: 16 },
  filterChip: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  filterChipActive: { backgroundColor: c.navy, borderColor: c.navy },
  filterTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  filterTxtActive: { color: '#fff' },
  section: { marginTop: 10 },
  secLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.onSurfaceTertiary, letterSpacing: 1.2, marginBottom: 12, marginTop: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  card: { width: '47.5%', backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, gap: 6, minHeight: 120 },
  cardSoon: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  cardTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink, marginTop: 4 },
  cardSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  newBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.goldSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  newTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 9, color: c.darkGold, letterSpacing: 0.5 },
});
