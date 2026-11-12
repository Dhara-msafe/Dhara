import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Redirect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { INTAKE_TEMPLATES, IntakeTemplate } from '@/src/intakeTemplates';
import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';

import { shareExternal } from '@/src/outbound';
const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;

type Intake = {
  id: string;
  intake_token: string;
  intake_url: string;
  client_name: string;
  template_title?: string;
  status: 'pending' | 'complete' | 'expired';
  created_at: string;
};

function StatusChip({ status }: { status: Intake['status'] }) {
  const map = {
    pending:  { bg: '#F3F4F6', text: '#6B7280', label: 'Pending' },
    complete: { bg: '#FEF9EC', text: NAVY,       label: 'Complete' },
    expired:  { bg: '#FEF2F2', text: '#DC2626',  label: 'Expired' },
  };
  const c = map[status];
  return (
    <View style={[ic.chip, { backgroundColor: c.bg }]}>
      <Text style={[ic.chipText, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

export default function Intakes() {
  // B-97: advocate/lawyer features are hidden for Wave 1 per D-14 -- this
  // must hold even on a direct URL hit or a refresh, not just when reached
  // via the (now-hidden) in-app links. (Note: the client-facing intake
  // FORM at /intake/[token] and /intake-view/[token] is a different screen
  // entirely and is intentionally left untouched here -- this list/manage
  // screen is the advocate-facing one.)
  if (!ADVOCATE_MODE_ENABLED) return <Redirect href="/(tabs)/home" />;

  const { token, user } = useAuth();
  const router = useRouter();
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const loadIntakes = useCallback(async () => {
    if (!user?.id || !token) return;
    setLoading(true);
    const r = await fetch(`${API_BASE}/api/advocate/intakes/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (r?.ok) setIntakes(await r.json());
    setLoading(false);
  }, [user?.id, token]);

  useEffect(() => { loadIntakes(); }, [loadIntakes]);

  const createIntake = async (tmpl: IntakeTemplate) => {
    if (!user?.id || !token) return;
    setShowPicker(false);
    setCreating(true);
    try {
      const r = await fetch(`${API_BASE}/api/advocate/intake/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ advocate_id: user.id, template_id: tmpl.id, template_title: tmpl.title }),
      });
      if (!r.ok) throw new Error('Failed');
      const { intake_url } = await r.json();
      await loadIntakes();
      if (Platform.OS !== 'web') {
        await shareExternal({ message: `Please fill in your case details using this secure link:\n${intake_url}`, url: intake_url });
      } else {
        await Clipboard.setStringAsync(intake_url);
        alert(`Link copied!\n${intake_url}`);
      }
    } catch { /* silently handled */ }
    setCreating(false);
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Client Intakes</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={NAVY} />
        </View>
      ) : (
        <FlatList
          data={intakes}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="people-outline" size={40} color="#D1D5DB" />
              <Text style={s.emptyTitle}>No intakes yet</Text>
              <Text style={s.emptySub}>Tap + to pick a template and send a secure intake link to your client.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={s.row}
              onPress={() => item.status === 'complete' ? router.push(`/intake-view/${item.intake_token}` as any) : null}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowName}>{item.client_name || 'Awaiting client'}</Text>
                {item.template_title ? <Text style={s.rowTemplate}>{item.template_title}</Text> : null}
                <Text style={s.rowDate}>{new Date(item.created_at).toLocaleDateString('en-IN')}</Text>
              </View>
              <StatusChip status={item.status} />
              {item.status === 'complete' && <Ionicons name="chevron-forward" size={16} color="#9CA3AF" style={{ marginLeft: 8 }} />}
            </Pressable>
          )}
        />
      )}

      {/* FAB */}
      <Pressable style={s.fab} onPress={() => setShowPicker(true)} disabled={creating}>
        {creating ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={28} color="#fff" />}
      </Pressable>

      {/* Template Picker Modal */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <Pressable style={s.backdrop} onPress={() => setShowPicker(false)} />
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Select Case Type</Text>
          <Text style={s.sheetSub}>Choose a template to send to your client</Text>
          {INTAKE_TEMPLATES.map(tmpl => (
            <Pressable key={tmpl.id} style={s.templateCard} onPress={() => createIntake(tmpl)}>
              <View style={[s.templateIcon, { backgroundColor: tmpl.color + '18' }]}>
                <Ionicons name={tmpl.icon as any} size={22} color={tmpl.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.templateTitle}>{tmpl.title}</Text>
                <Text style={s.templateDesc}>{tmpl.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </Pressable>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff', flex: 1 },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  rowName: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginBottom: 2 },
  rowTemplate: { fontSize: 12, color: GOLD, fontWeight: '600', marginBottom: 2 },
  rowDate: { fontSize: 12, color: '#9CA3AF' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptySub:   { fontSize: 13, color: '#9CA3AF', textAlign: 'center', maxWidth: 260 },
  fab: { position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: NAVY },
  sheetSub: { fontSize: 13, color: '#6B7280', marginTop: -6, marginBottom: 4 },
  templateCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' },
  templateIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  templateTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  templateDesc: { fontSize: 12, color: '#6B7280', marginTop: 2 },
});

const ic = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  chipText: { fontSize: 12, fontWeight: '700' },
});
