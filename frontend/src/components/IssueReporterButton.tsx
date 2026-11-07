/**
 * In-app issue reporter — a floating button on every screen that lets a tester
 * or user describe a problem without leaving DHARA.
 *
 * ADDITIVE ONLY: it reads nothing from SOS, Family Journey, location or the
 * legal chat, and writes only to POST /api/issues.
 *
 * Placement: bottom-LEFT. The SOS pill is fixed top-right and the Help FAB is
 * bottom-right, so this never overlaps either of them.
 *
 * Privacy: only the category, the title, the description and build/device/route
 * metadata are sent. The notice under the description asks the user not to
 * include personal details, and the server stores no email, phone or location.
 *
 * Flag: EXPO_PUBLIC_ENABLE_ISSUE_REPORTER. Default ON (the app is testers-only
 * until the final release); set it to "false" to hide the button everywhere.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { theme } from '@/src/theme';
import { useAuth, API_BASE } from '@/src/auth';

const c = theme.colors;

/** Off only when explicitly disabled, so every current build has it. */
export const ISSUE_REPORTER_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_ISSUE_REPORTER !== 'false';

const PENDING_KEY = 'issue_reports_pending_v1';

export const ISSUE_CATEGORIES = [
  'Installation, Upgrade & Launch',
  'Login & Session',
  'Navigation & UI',
  'Forms & Profile',
  'SOS & Alert Delivery',
  'Guardian Journey & Check-in',
  'Trusted Circle & Guardian Access',
  'Location & Permissions',
  'Audio, Camera & Notifications',
  'Evidence Locker',
  'Voice & Assistant',
  'Legal Intelligence',
  'Network & Offline Recovery',
  'Performance & Device Compatibility',
  'Accessibility',
  'Security & Privacy',
  'Other',
] as const;

type Report = {
  category: string;
  title: string;
  description: string;
  app_version?: string;
  build?: string;
  platform?: string;
  os_version?: string;
  device_model?: string;
  current_screen?: string;
  created_at?: string;
};

function deviceMeta(route: string): Partial<Report> {
  const extra = (Constants.expoConfig ?? {}) as { version?: string };
  return {
    app_version: extra.version || undefined,
    build: String(Constants.expoConfig?.extra?.buildNumber ?? Constants.expoVersion ?? ''),
    platform: Platform.OS,
    os_version: String(Device.osVersion ?? Platform.Version ?? ''),
    device_model: String(Device.modelName ?? 'unknown'),
    current_screen: route,
    created_at: new Date().toISOString(),
  };
}

async function postReport(token: string, report: Report): Promise<boolean> {
  const r = await fetch(`${API_BASE}/api/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(report),
  });
  return r.ok;
}

export function IssueReporterButton() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { token } = useAuth();

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Anything queued while offline goes out on the next app open / next report.
  const flushPending = useCallback(async () => {
    if (!token) return;
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      const queue: Report[] = raw ? JSON.parse(raw) : [];
      if (!queue.length) return;
      const left: Report[] = [];
      for (const item of queue) {
        try {
          const sent = await postReport(token, item);
          if (!sent) left.push(item);
        } catch {
          left.push(item);
        }
      }
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(left));
    } catch {}
  }, [token]);

  useEffect(() => { void flushPending(); }, [flushPending]);

  if (!ISSUE_REPORTER_ENABLED || !token) return null;
  // Never sit on top of the Emergency screen's own controls, or the
  // operator-only admin pages.
  if (pathname === '/emergency' || pathname?.startsWith('/admin-')) return null;

  const reset = () => {
    setCategory(''); setTitle(''); setDescription(''); setResult(null); setPickerOpen(false);
  };

  const submit = async () => {
    if (!category) { setResult({ ok: false, text: 'Please choose a category.' }); return; }
    if (!title.trim() || !description.trim()) {
      setResult({ ok: false, text: 'Please add a short title and a description.' });
      return;
    }
    setBusy(true);
    setResult(null);
    const report: Report = {
      category,
      title: title.trim().slice(0, 120),
      description: description.trim().slice(0, 2000),
      ...deviceMeta(pathname || 'unknown'),
    };
    try {
      const sent = await postReport(token, report);
      if (sent) {
        setResult({ ok: true, text: 'Thank you — your report has been sent.' });
        setTitle(''); setDescription(''); setCategory('');
        void flushPending();
      } else {
        setResult({ ok: false, text: 'The server could not accept this report. Please try again.' });
      }
    } catch {
      // Offline — keep it and send it later.
      try {
        const raw = await AsyncStorage.getItem(PENDING_KEY);
        const queue: Report[] = raw ? JSON.parse(raw) : [];
        queue.push(report);
        await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(queue));
        setResult({ ok: true, text: 'You are offline. Your report is saved and will be sent when the connection returns.' });
        setTitle(''); setDescription(''); setCategory('');
      } catch {
        setResult({ ok: false, text: 'Your report could not be saved. Please try again.' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        testID="issue-reporter-button"
        accessibilityRole="button"
        accessibilityLabel="Report a problem with the app"
        accessibilityHint="Opens a form to describe an issue for the DHARA team"
        onPress={() => setOpen(true)}
        style={[styles.fab, { bottom: insets.bottom + 140 }]}
      >
        <Ionicons name="bug-outline" size={20} color="#fff" />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="issue-reporter-sheet">
            <ScrollView bounces={false} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>Report a problem</Text>

              <Text style={styles.label}>Category</Text>
              <Pressable
                testID="issue-category-trigger"
                accessibilityRole="button"
                accessibilityLabel={category ? `Category: ${category}` : 'Choose a category'}
                style={styles.select}
                onPress={() => setPickerOpen(v => !v)}
              >
                <Text style={[styles.selectTxt, !category && { color: c.muted }]} numberOfLines={1}>
                  {category || 'Choose a category'}
                </Text>
                <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.navy} />
              </Pressable>
              {pickerOpen ? (
                <View style={styles.options}>
                  {ISSUE_CATEGORIES.map(opt => (
                    <Pressable
                      key={opt}
                      testID={`issue-category-${opt}`}
                      accessibilityRole="button"
                      accessibilityLabel={opt}
                      style={styles.option}
                      onPress={() => { setCategory(opt); setPickerOpen(false); }}
                    >
                      <Text style={styles.optionTxt}>{opt}</Text>
                      {category === opt ? <Ionicons name="checkmark" size={16} color={c.navy} /> : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text style={styles.label}>Title</Text>
              <TextInput
                testID="issue-title-input"
                accessibilityLabel="Title of the problem"
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="What went wrong, in a few words"
                placeholderTextColor={c.muted}
                maxLength={120}
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                testID="issue-description-input"
                accessibilityLabel="Description of the problem"
                style={[styles.input, styles.multiline]}
                value={description}
                onChangeText={setDescription}
                placeholder="What were you doing, and what happened?"
                placeholderTextColor={c.muted}
                multiline
                maxLength={2000}
              />
              <Text style={styles.notice}>
                Please don&rsquo;t include personal details, phone numbers or exact locations.
              </Text>

              {result ? (
                <Text
                  testID="issue-result"
                  style={[styles.result, { color: result.ok ? c.success : c.error }]}
                >
                  {result.text}
                </Text>
              ) : null}
            </ScrollView>

            <Pressable
              testID="issue-submit"
              accessibilityRole="button"
              accessibilityLabel="Submit report"
              style={styles.primary}
              onPress={submit}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Submit</Text>}
            </Pressable>
            <Pressable
              testID="issue-cancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={styles.ghost}
              onPress={() => { setOpen(false); reset(); }}
            >
              <Text style={styles.ghostTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    left: 16,
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.navy,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(14,39,64,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: 20,
    paddingBottom: 28,
    gap: 10,
    maxHeight: '88%',
  },
  title: { fontFamily: theme.fonts.displayBold, fontSize: 19, color: c.ink },
  label: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48,
    backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: c.border, paddingHorizontal: 12,
  },
  selectTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink },
  options: { borderWidth: 1, borderColor: c.border, borderRadius: theme.radius.sm, overflow: 'hidden' },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  optionTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 14, color: c.ink },
  input: {
    backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.sm, borderWidth: 1,
    borderColor: c.border, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48,
    fontFamily: theme.fonts.body, fontSize: 15, color: c.ink,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  notice: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },
  result: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, lineHeight: 18 },
  primary: {
    backgroundColor: c.navy, borderRadius: theme.radius.pill, minHeight: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  ghost: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostTxt: { color: c.muted, fontFamily: theme.fonts.bodySemiBold, fontSize: 14 },
});
