/**
 * Screen 1 — Matter list
 * Entry point from the advocate tab "Consultation Notes" card.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, FlatList, ActivityIndicator,
  StyleSheet, TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { API_BASE, useAuth } from '@/src/auth';

const c = theme.colors;

interface Matter {
  id: string;
  title: string;
  client_ref: string | null;
  created_at: string;
  consultation_count: number;
}

export default function MatterListScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [clientRef, setClientRef] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/notetaker/matters`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setMatters(await r.json());
    } catch {}
    setLoading(false);
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createMatter = async () => {
    if (!title.trim()) { crossAlert('Title required', 'Give this matter a title before creating it.'); return; }
    setCreating(true);
    try {
      const r = await fetch(`${API_BASE}/api/notetaker/matters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim(), client_ref: clientRef.trim() || null }),
      });
      if (r.ok) {
        const m: Matter = await r.json();
        setShowCreate(false);
        setTitle(''); setClientRef('');
        router.push(`/notetaker/matter/${m.id}`);
      } else {
        crossAlert('Error', 'Could not create matter.');
      }
    } catch {
      crossAlert('Error', 'Network error.');
    }
    setCreating(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back">
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Consultation Notes</Text>
        <Pressable style={styles.tasksBtn} onPress={() => router.push('/notetaker/tasks')} accessibilityLabel="View task drafts">
          <Text style={styles.tasksBtnText}>Tasks</Text>
        </Pressable>
        <Pressable style={styles.newBtn} onPress={() => setShowCreate(true)} accessibilityLabel="Create new matter">
          <Text style={styles.newBtnText}>+ Matter</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.navy} size="large" /></View>
      ) : matters.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📁</Text>
          <Text style={styles.emptyTitle}>No matters yet</Text>
          <Text style={styles.emptyBody}>
            Create a matter to group consultations for a client.
          </Text>
          <Pressable style={styles.ctaBtn} onPress={() => setShowCreate(true)}>
            <Text style={styles.ctaBtnText}>Create first matter</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={matters}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/notetaker/matter/${item.id}`)}
              accessibilityLabel={`Open matter ${item.title}`}
            >
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardArrow}>›</Text>
              </View>
              {item.client_ref ? <Text style={styles.cardRef}>{item.client_ref}</Text> : null}
              <Text style={styles.cardMeta}>
                {item.consultation_count === 0
                  ? 'No consultations'
                  : `${item.consultation_count} consultation${item.consultation_count === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
          )}
        />
      )}

      {/* Create matter modal */}
      <Modal visible={showCreate} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>New matter</Text>
            <Text style={styles.fieldLabel}>Matter title *</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. State v. Kumar — Domestic Violence"
              placeholderTextColor={c.muted}
              autoFocus
            />
            <Text style={styles.fieldLabel}>Client reference (optional)</Text>
            <TextInput
              style={styles.input}
              value={clientRef}
              onChangeText={setClientRef}
              placeholder="e.g. File no. 2026/DV/0042"
              placeholderTextColor={c.muted}
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => { setShowCreate(false); setTitle(''); setClientRef(''); }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, !title.trim() && styles.saveBtnDisabled]}
                onPress={createMatter}
                disabled={creating}
              >
                {creating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>Create</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    backgroundColor: c.navy, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  backArrow: { color: '#fff', fontSize: 28, lineHeight: 32, marginTop: -2 },
  headerTitle: { flex: 1, color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 18, marginLeft: 4 },
  newBtn: { backgroundColor: c.gold, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  newBtnText: { color: c.navy, fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  tasksBtn: { paddingHorizontal: 10, paddingVertical: 8, marginRight: 4 },
  tasksBtnText: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13, textDecorationLine: 'underline' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 20, color: c.navy, marginBottom: 8 },
  emptyBody: { fontFamily: theme.fonts.body, fontSize: 15, color: c.muted, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  ctaBtn: { backgroundColor: c.navy, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  ctaBtnText: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 16 },
  card: {
    backgroundColor: c.surface, borderRadius: 14, padding: 16,
    shadowColor: c.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: c.navy },
  cardArrow: { color: c.muted, fontSize: 22 },
  cardRef: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2 },
  cardMeta: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 6 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36,
  },
  modalTitle: { fontFamily: theme.fonts.display, fontSize: 22, color: c.navy, marginBottom: 20 },
  fieldLabel: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.muted, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 10,
    padding: 14, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink,
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, alignItems: 'center' },
  cancelBtnText: { fontFamily: theme.fonts.bodyMedium, fontSize: 15, color: c.muted },
  saveBtn: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: c.navy, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: '#fff' },
});
