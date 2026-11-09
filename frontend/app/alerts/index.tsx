import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { listAlerts, listInvitations, SafetyAlert, InviteLink } from '@/src/trustedCircle/api';

const c = theme.colors;

type Row = { kind: 'alert'; data: SafetyAlert } | { kind: 'invite'; data: InviteLink };

const TABS = ['all', 'active', 'completed', 'invitations'] as const;
const TAB_LABEL: Record<string, string> = { all: 'All', active: 'Active', completed: 'Completed', invitations: 'Invitations' };

const URGENT_TYPES = ['missed_checkin', 'route_deviation', 'help_requested', 'location_unavailable'];
const DONE_TYPES = ['arrival_confirmed', 'journey_completed', 'sharing_ended'];

function iconFor(type: string): any {
  switch (type) {
    case 'missed_checkin': return 'alert-circle';
    case 'route_deviation': return 'navigate-outline';
    case 'help_requested': return 'warning';
    case 'journey_started': return 'navigate';
    case 'journey_completed': return 'checkmark-circle';
    case 'arrival_confirmed': return 'checkmark-circle';
    case 'location_unavailable': return 'cloud-offline';
    case 'sharing_ended': return 'stop-circle';
    default: return 'notifications';
  }
}
function colorFor(type: string): string {
  if (URGENT_TYPES.includes(type)) return c.error;
  if (DONE_TYPES.includes(type)) return c.success;
  return c.navy;
}
function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AlertsInbox() {
  const { token } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<typeof TABS[number]>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (tab === 'invitations') {
        const invites = await listInvitations(token, 'received');
        setRows(invites.filter(i => i.status === 'pending').map(data => ({ kind: 'invite', data } as Row)));
      } else {
        const filter = tab === 'all' ? 'all' : tab;
        const alerts = await listAlerts(token, filter as any);
        let r: Row[] = alerts.map(data => ({ kind: 'alert', data } as Row));
        if (tab === 'all') {
          const invites = await listInvitations(token, 'received');
          r = [...r, ...invites.filter(i => i.status === 'pending').map(data => ({ kind: 'invite', data } as Row))];
        }
        r.sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());
        setRows(r);
      }
    } finally {
      setLoading(false);
    }
  }, [token, tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['bottom']}>
      <ScreenHeader title="Safety alerts" subtitle="Updates from people who added you to their Trusted Circle" />
      <View style={styles.tabs}>
        {TABS.map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} testID={`alerts-tab-${t}`}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{TAB_LABEL[t]}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.data.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        ListEmptyComponent={!loading ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={36} color={c.muted} />
            <Text style={styles.emptyTxt}>Nothing here yet.</Text>
          </View>
        ) : null}
        renderItem={({ item }) => {
          const isInvite = item.kind === 'invite';
          const unread = isInvite ? true : !item.data.read_at;
          const type = isInvite ? 'invitation' : (item.data as SafetyAlert).type;
          return (
            <Pressable
              style={styles.card}
              testID={isInvite ? `alerts-row-invite-${item.data.id}` : `alerts-row-${item.data.id}`}
              onPress={() => router.push(isInvite ? `/invite/${item.data.id}` as any : `/alerts/${item.data.id}` as any)}
            >
              <View style={[styles.iconWrap, { backgroundColor: colorFor(type) + '1A' }]}>
                <Ionicons name={isInvite ? 'person-add' : iconFor(type)} size={20} color={colorFor(type)} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {isInvite ? 'Trusted Circle invitation' : (item.data as SafetyAlert).title}
                </Text>
                <Text style={styles.cardSub} numberOfLines={1}>
                  {isInvite ? `From ${(item.data as InviteLink).owner_name}` : `From ${(item.data as SafetyAlert).owner_name}`}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.time}>{relTime(item.data.created_at)}</Text>
                {unread && <View style={styles.dot} />}
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: c.surfaceSecondary },
  tabBtnActive: { backgroundColor: c.navy },
  tabTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  tabTxtActive: { color: '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border, minHeight: 64 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.ink },
  cardSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  time: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.error, marginTop: 6 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 10 },
  emptyTxt: { fontFamily: theme.fonts.body, color: c.muted, fontSize: 14 },
});