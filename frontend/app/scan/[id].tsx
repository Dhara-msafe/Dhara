import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView, ActivityIndicator, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth, API_BASE } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { draftByType } from '@/src/drafts';

const c = theme.colors;

type Detail = {
  id: string; extracted_text: string; summary: string; action: string;
  mode: string; suggested_template?: string | null; prefill?: Record<string, string>;
  created_at: string; photo_base64?: string | null;
};

// Read-only view of a scan saved by POST /api/scan/notice — reached from the
// "Documents" tab. Mirrors scan.tsx's result card styling for consistency.
export default function ScanDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (!id || !token) { setLoading(false); setError(true); return; }
    let active = true;
    fetch(`${API_BASE}/api/scan/history/detail/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { if (active) setDetail(data); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, token]);

  const share = async () => {
    if (!detail) return;
    try {
      await Share.share({ message: `${detail.mode === 'draft' ? 'Drafted reply' : 'Document, explained'} — DHARA\n\n${detail.summary}` });
    } catch {}
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Scanned document" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {loading ? (
          <View style={styles.busy}><ActivityIndicator color={c.navy} /></View>
        ) : error || !detail ? (
          <View style={styles.errBox}>
            <Text style={styles.errTxt}>Couldn&apos;t load this scan. Please go back and try again.</Text>
          </View>
        ) : (
          <View>
            {detail.photo_base64 ? (
              <Image source={{ uri: `data:image/jpeg;base64,${detail.photo_base64}` }} style={styles.preview} resizeMode="cover" />
            ) : null}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{detail.mode === 'draft' ? 'DRAFTED REPLY' : 'WHAT THIS MEANS'}</Text>
              <Text style={styles.summary}>{detail.summary}</Text>
            </View>
            {detail.action ? (
              <View style={styles.actionCard}>
                <Ionicons name="arrow-forward-circle" size={18} color={c.gold} />
                <Text style={styles.actionTxt}>{detail.action}</Text>
              </View>
            ) : null}
            {detail.suggested_template && draftByType(detail.suggested_template) ? (
              <Pressable
                style={styles.templateCard}
                onPress={() => router.push({
                  pathname: '/drafts/[type]',
                  params: { type: detail.suggested_template!, prefill: JSON.stringify(detail.prefill || {}) },
                } as any)}
              >
                <View style={styles.templateIcon}>
                  <Ionicons name={draftByType(detail.suggested_template)!.icon} size={20} color={c.navy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.templateTitle}>Use the {draftByType(detail.suggested_template)!.title} template</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
              </Pressable>
            ) : null}
            <Pressable style={styles.toggle} onPress={() => setShowText(s => !s)}>
              <Ionicons name={showText ? 'chevron-up' : 'chevron-down'} size={18} color={c.navy} />
              <Text style={styles.toggleTxt}>{showText ? 'Hide' : 'Show'} the exact text read</Text>
            </Pressable>
            {showText && <Text style={styles.extracted}>{detail.extracted_text}</Text>}
            <Pressable style={styles.secBtn} onPress={share} testID="scan-detail-share">
              <Ionicons name="share-outline" size={18} color={c.navy} />
              <Text style={styles.secTxt}>Share</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  busy: { alignItems: 'center', paddingVertical: 60 },
  errBox: { backgroundColor: '#FBEAE8', borderRadius: 12, padding: 14, marginTop: 16 },
  errTxt: { fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.error },
  preview: { width: '100%', height: 180, borderRadius: 14, marginBottom: 12, backgroundColor: c.surfaceTertiary },
  card: { backgroundColor: c.navy, borderRadius: 18, padding: 20 },
  cardLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.gold, letterSpacing: 1.2 },
  summary: { fontFamily: theme.fonts.body, fontSize: 17, color: '#fff', lineHeight: 26, marginTop: 10 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.goldMuted, borderRadius: 14, padding: 16, marginTop: 14 },
  actionTxt: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.ink, lineHeight: 22 },
  templateCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.gold, borderRadius: 16, padding: 16, marginTop: 14 },
  templateIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  templateTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  toggleTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  extracted: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14 },
  secBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingVertical: 13, backgroundColor: c.surface, marginTop: 18 },
  secTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
});
