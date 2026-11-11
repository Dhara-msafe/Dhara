/**
 * Task drafts screen — lists the nt_tasks created from approved consultation
 * notes' proposed_actions (Approved step → "Create task drafts from actions").
 * Lets the advocate mark a task done, undo that, and jump back to the
 * consultation it came from.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { useAuth } from '@/src/auth';
import { listTasks, updateTaskStatus } from '@/src/notetaker/api';
import { ScreenHeader } from '@/src/notetaker/ui';
import type { NtTask, TaskStatus } from '@/src/notetaker/api';

const c = theme.colors;

export default function TasksScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TaskStatus>('pending');
  const [tasks, setTasks] = useState<NtTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async (which: TaskStatus) => {
    if (!token) return;
    setLoading(true);
    try {
      setTasks(await listTasks(token, which));
    } catch {
      // keep whatever was last loaded rather than clearing on a transient error
    }
    setLoading(false);
  }, [token]);

  useFocusEffect(useCallback(() => { load(tab); }, [load, tab]));

  const toggle = async (task: NtTask) => {
    if (!token) return;
    const next: TaskStatus = task.status === 'done' ? 'pending' : 'done';
    setUpdatingId(task.id);
    try {
      await updateTaskStatus(token, task.id, next);
      // Optimistic removal from the current tab's list.
      setTasks(prev => prev.filter(t => t.id !== task.id));
    } catch (e: any) {
      crossAlert('Could not update task', e?.message || 'Please try again.');
    }
    setUpdatingId(null);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Task drafts" subtitle="From approved consultation notes" />

      <View style={styles.tabRow}>
        {(['pending', 'done'] as TaskStatus[]).map(t => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
            accessibilityLabel={t === 'pending' ? 'Pending tasks' : 'Completed tasks'}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'pending' ? 'Pending' : 'Completed'}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.navy} size="large" /></View>
      ) : tasks.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>{tab === 'pending' ? '✅' : '🗂️'}</Text>
          <Text style={styles.emptyTitle}>{tab === 'pending' ? 'No pending tasks' : 'No completed tasks yet'}</Text>
          <Text style={styles.emptyBody}>
            {tab === 'pending'
              ? 'Tasks appear here once you create drafts from an approved note\u2019s proposed actions.'
              : 'Mark a pending task done and it will show up here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                style={styles.checkbox}
                onPress={() => toggle(item)}
                disabled={updatingId === item.id}
                accessibilityLabel={item.status === 'done' ? 'Mark as pending' : 'Mark as done'}
              >
                {updatingId === item.id ? (
                  <ActivityIndicator color={c.navy} size="small" />
                ) : (
                  <View style={[styles.checkboxBox, item.status === 'done' && styles.checkboxBoxDone]}>
                    {item.status === 'done' && <Text style={styles.checkboxTick}>✓</Text>}
                  </View>
                )}
              </Pressable>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => router.push(`/notetaker/consultation/${item.consultation_id}`)}
                accessibilityLabel={`Open consultation for task: ${item.text}`}
              >
                <Text style={[styles.taskText, item.status === 'done' && styles.taskTextDone]}>{item.text}</Text>
                <Text style={styles.taskMeta} numberOfLines={1}>
                  {item.matter_title || 'Matter'} · {item.consultation_title || 'Consultation'}
                </Text>
                <View style={styles.badgeRow}>
                  <View style={styles.assigneeBadge}>
                    <Text style={styles.assigneeBadgeText}>{item.assignee || 'advocate'}</Text>
                  </View>
                </View>
                {!!item.source_ref && <Text style={styles.sourceRef} numberOfLines={1}>“{item.source_ref}”</Text>}
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: c.surfaceSecondary },
  tabActive: { backgroundColor: c.navy },
  tabText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.muted },
  tabTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 18, color: c.navy, marginBottom: 8 },
  emptyBody: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, textAlign: 'center', lineHeight: 20 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: c.surface,
    borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border,
  },
  checkbox: { paddingTop: 2 },
  checkboxBox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxBoxDone: { backgroundColor: c.navy, borderColor: c.navy },
  checkboxTick: { color: '#fff', fontSize: 14, fontWeight: '700' },
  taskText: { fontFamily: theme.fonts.bodyMedium, fontSize: 15, color: c.ink, lineHeight: 21 },
  taskTextDone: { color: c.muted, textDecorationLine: 'line-through' },
  taskMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 4 },
  badgeRow: { flexDirection: 'row', marginTop: 8 },
  assigneeBadge: { backgroundColor: c.surfaceSecondary, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  assigneeBadgeText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 10, color: c.navy, textTransform: 'capitalize' },
  sourceRef: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, fontStyle: 'italic', marginTop: 6 },
});
