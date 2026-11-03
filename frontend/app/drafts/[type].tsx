import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { crossAlert } from '@/src/utils/crossAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { draftByType } from '@/src/drafts';
import { addToHistory } from '@/src/draftHistory';

import { shareExternal } from '@/src/outbound';
export default function DraftForm() {
  const { type, prefill } = useLocalSearchParams<{ type: string; prefill?: string }>();
  const router = useRouter();
  const { token, refreshUser } = useAuth();
  const spec = useMemo(() => draftByType(String(type)), [type]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!prefill) return {};
    try {
      const parsed = JSON.parse(String(prefill));
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch { return {}; }
  });
  const [generated, setGenerated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasPrefill = !!prefill;

  if (!spec) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Text style={styles.missing}>That notice type is not available.</Text>
      </SafeAreaView>
    );
  }

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));

  const onGenerate = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/drafts/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ draft_type: spec.type }),
      });
      if (res.status === 402) {
        const body = await res.json();
        const msg = body?.detail?.message || 'Upgrade to Pro for unlimited notices.';
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined' && window.confirm(`${msg}\n\nOpen upgrade?`)) {
            router.push('/upgrade');
          }
        } else {
          crossAlert('Free notice used', msg, [
            { text: 'Not now', style: 'cancel' },
            { text: 'See Pro', onPress: () => router.push('/upgrade') },
          ]);
        }
        return;
      }
      if (!res.ok) throw new Error('failed');
      const text = spec.build(values);
      setGenerated(text);
      // Save to on-device history so the user can reopen, edit or resend this
      // exact notice later without spending another draft from the quota.
      addToHistory({ type: spec.type, title: spec.title, text, lang: 'en' }).catch(() => {});
      refreshUser().catch(() => {});
    } catch {
      crossAlert('Could not create the notice', 'Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!generated) return;
    await Clipboard.setStringAsync(generated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onShare = async () => {
    if (!generated) return;
    try {
      await shareExternal({ message: generated });
    } catch {}
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="draft-form-screen">
      <View style={styles.header}>
        <Pressable testID="draft-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={theme.colors.onBrandPrimary} />
        </Pressable>
        <Text style={styles.h1} numberOfLines={1}>{spec.title}</Text>
        <View style={{ width: 26 }} />
      </View>

      {generated ? (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.deadlineCard}>
              <Ionicons name="time-outline" size={16} color={theme.colors.error} />
              <Text style={styles.deadlineText}>{spec.deadline}</Text>
            </View>
            {/* Mandatory legal disclosure above every generated notice */}
            <View style={styles.legalDisclaimer} testID="draft-legal-disclaimer">
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.onSurfaceSecondary} />
              <Text style={styles.legalDisclaimerText}>
                This is a template for your use. Review all details before submitting.{' '}
                DHARA does not create an advocate-client relationship.
              </Text>
            </View>
            <View style={styles.output} testID="draft-output">
              <Text style={styles.outputText} selectable>{generated}</Text>
            </View>
          </ScrollView>
          <View style={styles.actionBar}>
            <Pressable testID="draft-copy" style={styles.secondaryBtn} onPress={onCopy}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={theme.colors.brand} />
              <Text style={styles.secondaryBtnText}>{copied ? 'Copied' : 'Copy'}</Text>
            </Pressable>
            <Pressable testID="draft-share" style={styles.primaryBtn} onPress={onShare}>
              <Ionicons name="share-social-outline" size={18} color={theme.colors.onBrandSecondary} />
              <Text style={styles.primaryBtnText}>Send</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={24}>
            <View style={styles.deadlineCard}>
              <Ionicons name="time-outline" size={16} color={theme.colors.error} />
              <Text style={styles.deadlineText}>{spec.deadline}</Text>
            </View>
            {/* Pre-generation legal disclosure */}
            <View style={styles.legalDisclaimer}>
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.onSurfaceSecondary} />
              <Text style={styles.legalDisclaimerText}>
                This is a template for your use. Review all details before submitting.{' '}
                DHARA does not create an advocate-client relationship.
              </Text>
            </View>
            {hasPrefill && (
              <View style={styles.prefillBanner} testID="draft-prefill-banner">
                <Ionicons name="scan-outline" size={16} color={theme.colors.brand} />
                <Text style={styles.prefillBannerText}>
                  Some fields were filled in from your scanned document — please check each one before writing the notice.
                </Text>
              </View>
            )}
            {spec.fields.map((f) => (
              <View key={f.key} style={styles.fieldWrap}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  testID={`field-${f.key}`}
                  value={values[f.key] || ''}
                  onChangeText={(t) => set(f.key, t)}
                  placeholder={f.placeholder}
                  placeholderTextColor={theme.colors.onSurfaceTertiary}
                  keyboardType={f.keyboard === 'numeric' ? 'numeric' : 'default'}
                  multiline={!!f.multiline}
                  style={[styles.input, f.multiline && styles.inputMulti]}
                />
              </View>
            ))}
            <Text style={styles.hint}>
              Leave a field blank and a blank line appears in the notice for you to fill by hand.
            </Text>
          </KeyboardAwareScrollView>
          <View style={styles.actionBar}>
            <Pressable
              testID="draft-generate"
              style={[styles.primaryBtn, { flex: 1 }, busy && { opacity: 0.6 }]}
              onPress={onGenerate}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrandSecondary} />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={18} color={theme.colors.onBrandSecondary} />
                  <Text style={styles.primaryBtnText}>Write my notice</Text>
                </>
              )}
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: theme.spacing.lg, backgroundColor: theme.colors.brand, gap: theme.spacing.md,
  },
  h1: { flex: 1, textAlign: 'center', fontFamily: theme.fonts.display, fontSize: 17, color: theme.colors.onBrandPrimary, fontWeight: '700' },
  scroll: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  deadlineCard: {
    flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start',
    backgroundColor: '#FEE2E2', borderRadius: theme.radius.md, padding: theme.spacing.md,
  },
  deadlineText: { flex: 1, color: '#7F1D1D', fontSize: 12, lineHeight: 18, fontWeight: '600' },
  fieldWrap: { gap: 6 },
  label: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md, color: theme.colors.onSurface, fontSize: 15, minHeight: 48,
  },
  inputMulti: { minHeight: 76, textAlignVertical: 'top' },
  hint: { color: theme.colors.onSurfaceTertiary, fontSize: 12, marginTop: theme.spacing.sm },
  output: {
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.lg,
  },
  outputText: { color: theme.colors.onSurface, fontSize: 13, lineHeight: 21 },
  actionBar: {
    flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.lg,
    borderTopWidth: 1, borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.brandSecondary, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.xl, minHeight: 52, flex: 1,
  },
  primaryBtnText: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 2, borderColor: theme.colors.brand, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.xl, minHeight: 52, flex: 1,
  },
  secondaryBtnText: { color: theme.colors.brand, fontWeight: '800', fontSize: 15 },
  missing: { padding: theme.spacing.xl, color: theme.colors.onSurface },
  legalDisclaimer: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#F8F9FA',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  legalDisclaimerText: {
    flex: 1,
    color: theme.colors.onSurfaceSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  prefillBanner: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: theme.colors.goldSoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.gold,
  },
  prefillBannerText: {
    flex: 1,
    color: theme.colors.brand,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
});
