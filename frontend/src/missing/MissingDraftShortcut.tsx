import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth';
import { theme } from '../theme';
import { answersKey } from './support';

export function MissingDraftShortcut() {
  const { user } = useAuth();
  const userId = user?.id;
  const router = useRouter();
  const [name, setName] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    if (userId) AsyncStorage.getItem(answersKey(userId)).then(raw => { if (active) setName(raw ? JSON.parse(raw).missing_name || '' : ''); }).catch(() => {});
    return () => { active = false; };
  }, [userId]));
  if (!name) return null;
  return <Pressable testID="complaints-missing-draft" accessibilityRole="button" onPress={() => router.push('/missing/interview')} style={s.card}>
    <Text testID="complaints-missing-name" style={s.title}>Missing person · {name}</Text>
    <Text testID="complaints-missing-local-note" style={s.body}>Saved on this device · Continue complaint →</Text>
  </Pressable>;
}
const s = StyleSheet.create({ card: { padding: 16, marginBottom: 16, borderRadius: 14, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.divider, gap: 6 }, title: { color: theme.colors.primary, fontSize: 14, fontFamily: 'InterBold'}, body: { color: theme.colors.onSurfaceTertiary, fontFamily: 'Inter', fontSize: 12, lineHeight: 18 } });