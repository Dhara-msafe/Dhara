import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { SOSButton } from '@/src/components/SOSButton';
import { INTERESTS, useUserProfile, type ProfileInterest } from '@/src/userProfile';
import { getPhotoViewToken } from '@/src/trustedCircle/api';
import { API_BASE } from '@/src/apiBase';

const c = theme.colors;

export default function Me() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token, language, logout } = useAuth();
  const lang = language.code;
  const name = user?.name || tr('me.guest', lang);
  const { interests, saveInterests, loaded } = useUserProfile();
  const [selected, setSelected] = useState<ProfileInterest[]>([]);
  const [viewToken, setViewToken] = useState<string | null>(null);
  useEffect(() => { if (loaded) setSelected(interests); }, [loaded, interests]);
  useEffect(() => { if (token && user?.photo_url) getPhotoViewToken(token).then(setViewToken); }, [token, user?.photo_url]);
  const photoSrc = user?.photo_url && viewToken ? `${API_BASE}${user.photo_url}&token=${viewToken}` : null;

  const rows: { icon: any; key: string; value?: string; route?: string; action?: () => void }[] = [
    { icon: 'person-outline', key: 'me.editProfile', route: '/edit-profile' },
    { icon: 'people-outline', key: 'me.trustedCircle', route: '/women/trusted-circle' },
    { icon: 'notifications-outline', key: 'me.notifications', route: '/(tabs)/settings' },
    { icon: 'shield-checkmark-outline', key: 'me.privacy', route: '/settings/data-privacy' },
    { icon: 'globe-outline', key: 'me.language', value: language.native, route: '/language' },
    { icon: 'help-buoy-outline', key: 'me.help', route: '/(tabs)/settings' },
    { icon: 'location-outline', key: 'me.state', value: user?.state_name || '—', route: '/state' },
    { icon: 'chatbubbles-outline', key: 'me.history', route: '/(tabs)/history' },
    { icon: 'bookmark-outline', key: 'me.saved', route: '/(tabs)/saved' },
    { icon: 'briefcase-outline', key: 'me.advocate', route: '/(tabs)/advocate' },
    { icon: 'settings-outline', key: 'me.settings', route: '/(tabs)/settings' },
  ];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{tr('me.title', lang)}</Text>

        <View style={styles.profile}>
          <Pressable onPress={() => router.push('/edit-profile')} testID="me-avatar">
            {photoSrc ? (
              <Image source={{ uri: photoSrc }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{name.charAt(0).toUpperCase()}</Text></View>
            )}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{user?.email || tr('me.guest', lang)}</Text>
          </View>
          {user?.is_pro && <View style={styles.proPill}><Ionicons name="star" size={13} color={c.navy} /><Text style={styles.proTxt}>PRO</Text></View>}
        </View>

        {/* Emergency / SOS — moved here from Home so Home stays calm. */}
        <Pressable
          style={styles.emergencyCard}
          onPress={() => router.push('/emergency')}
          testID="me-emergency-card"
        >
          <View style={styles.emergencyIcon}>
            <Ionicons name="alert-circle" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emergencyTitle}>Emergency Help</Text>
            <Text style={styles.emergencySub}>Helplines, SOS numbers, what to do next</Text>
          </View>
          <SOSButton variant="chip" />
        </Pressable>

        <View style={styles.card}>
          {rows.map((r, i) => (
            <Pressable key={r.key} style={[styles.row, i < rows.length - 1 && styles.rowBorder]} onPress={() => r.route && router.push(r.route as any)} testID={`me-${r.key}`}>
              <View style={styles.rowIcon}><Ionicons name={r.icon} size={20} color={c.navy} /></View>
              <Text style={styles.rowLabel}>{tr(r.key, lang)}</Text>
              {r.value && <Text style={styles.rowValue} numberOfLines={1}>{r.value}</Text>}
              <Ionicons name="chevron-forward" size={18} color={c.onSurfaceTertiary} />
            </Pressable>
          ))}
        </View>

        {/* ── What matters to you? — interest picker ─────────────────── */}
        <View style={styles.interestCard} testID="interest-picker">
          <View style={styles.interestHeader}>
            <Ionicons name="sparkles" size={17} color="#F59E0B" />
            <Text style={styles.interestTitle}>Personalize your DHARA</Text>
          </View>
          <Text style={styles.interestSub}>
            Select up to {3} topics — home, suggestions &amp; rights adapt
          </Text>
          <View style={styles.interestGrid}>
            {INTERESTS.map(interest => {
              const isOn = selected.includes(interest.key);
              const canPick = isOn || selected.length < 3;
              return (
                <Pressable
                  key={interest.key}
                  testID={`interest-chip-${interest.key}`}
                  style={[
                    styles.interestChip,
                    isOn && { backgroundColor: interest.bgColor, borderColor: interest.color },
                    !canPick && { opacity: 0.38 },
                  ]}
                  onPress={() => {
                    let next: ProfileInterest[];
                    if (isOn) {
                      next = selected.filter(k => k !== interest.key);
                    } else if (canPick) {
                      next = [...selected, interest.key];
                    } else {
                      return;
                    }
                    setSelected(next);
                    void saveInterests(next);
                  }}
                >
                  <Text style={styles.chipEmoji}>{interest.emoji}</Text>
                  <Text
                    style={[styles.chipLabel, isOn && { color: interest.color }]}
                    numberOfLines={2}
                  >
                    {interest.label}
                  </Text>
                  {isOn && (
                    <View style={[styles.chipCheck, { backgroundColor: interest.color }]}>
                      <Ionicons name="checkmark" size={9} color="#fff" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
          {selected.length > 0 ? (
            <Text style={styles.interestSaved}>
              ✓ Saved · your home is now personalized
            </Text>
          ) : (
            <Text style={styles.interestHint}>
              No selection · showing general questions
            </Text>
          )}
        </View>

        <Pressable style={styles.signout} onPress={async () => { await logout(); router.replace('/login'); }} testID="me-signout">
          <Ionicons name="log-out-outline" size={20} color={c.error} />
          <Text style={styles.signoutTxt}>{tr('me.signout', lang)}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  title: { fontFamily: theme.fonts.displayBold, fontSize: 28, color: c.ink, marginBottom: 18 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.navy, borderRadius: 18, padding: 18 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: c.gold },
  avatarTxt: { fontFamily: theme.fonts.displayBold, fontSize: 26, color: c.navy },
  name: { fontFamily: theme.fonts.displayBold, fontSize: 20, color: '#fff' },
  email: { fontFamily: theme.fonts.body, fontSize: 13, color: c.onNavyMuted, marginTop: 2 },
  proPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.gold, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  proTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.navy },
  emergencyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.errorSoft || '#FEE2E2', borderRadius: 16, borderWidth: 1, borderColor: c.error, padding: 14, marginTop: 14 },
  emergencyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.error, alignItems: 'center', justifyContent: 'center' },
  emergencyTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  emergencySub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 1 },
  card: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines, paddingHorizontal: 16, marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: c.divider },
  rowIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: c.ink },
  rowValue: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, maxWidth: 120 },
  // ── Interest picker ────────────────────────────────────────────────
  interestCard: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines, padding: 18, marginTop: 18 },
  interestHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  interestTitle: { fontFamily: theme.fonts.displayBold, fontSize: 16, color: c.ink },
  interestSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginBottom: 16, lineHeight: 18 },
  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  interestChip: { width: '47%', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: c.lines, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: c.background },
  chipEmoji: { fontSize: 18 },
  chipLabel: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink, lineHeight: 17 },
  chipCheck: { width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  interestSaved: { fontFamily: theme.fonts.body, fontSize: 12, color: '#059669', marginTop: 14, textAlign: 'center' },
  interestHint: { fontFamily: theme.fonts.body, fontSize: 12, color: c.onSurfaceTertiary, marginTop: 14, textAlign: 'center' },
  signout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, paddingVertical: 16, marginTop: 20 },
  signoutTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.error },
});
