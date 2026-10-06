import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking, Share, Image, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { API_BASE } from '@/src/apiBase';
import { draftByType } from '@/src/drafts';

const c = theme.colors;

type Result = {
  extracted_text: string; summary: string; action: string; mode: string;
  suggested_template?: string | null; prefill?: Record<string, string>;
};

// Builds a proper letter/notice-style PDF from the scanned document's own
// content — not a generic blurb — so sharing on WhatsApp/email sends the
// actual reading (or drafted reply) of THIS document, not just a one-line
// chat message. Mirrors the same expo-print pattern already used by
// fir-draft/result.tsx and missing/result.tsx.
const esc = (s: string) => (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const buildScanHtml = (r: Result) => {
  const isDraft = r.mode === 'draft';
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
body{padding:28px;font-family:Arial,sans-serif;color:#1A1A1A;}
h2{color:#1B2B5B;font-size:18px;margin-bottom:2px;}
.date{color:#6B6B6B;font-size:12px;margin-bottom:18px;}
.label{color:#8A6A2A;font-size:11px;letter-spacing:1px;font-weight:700;margin-top:18px;}
.body{white-space:pre-wrap;font-size:14px;line-height:1.7;margin-top:6px;}
.orig{background:#F7F7F7;border-left:3px solid #C9973A;padding:12px;font-size:12px;line-height:1.6;color:#444;white-space:pre-wrap;margin-top:8px;}
.foot{color:#8A8A8A;font-size:11px;margin-top:26px;border-top:1px solid #E5E5E5;padding-top:10px;}
</style></head><body>
<h2>${isDraft ? 'Drafted reply' : 'Document, explained'} — DHARA</h2>
<div class="date">${today}</div>
${isDraft ? `<div class="label">YOUR DRAFTED REPLY</div><div class="body">${esc(r.summary)}</div>` : `<div class="label">WHAT THIS MEANS</div><div class="body">${esc(r.summary)}</div>`}
${r.action ? `<div class="label">SUGGESTED NEXT STEP</div><div class="body">${esc(r.action)}</div>` : ''}
${r.extracted_text ? `<div class="label">BASED ON THE SCANNED DOCUMENT</div><div class="orig">${esc(r.extracted_text)}</div>` : ''}
<div class="foot">This is DHARA's reading of a photographed document, for your reference. Review all details before sending. DHARA does not create an advocate-client relationship.</div>
</body></html>`;
};

export default function Scan() {
  const router = useRouter();
  const { language, token } = useAuth();
  const lang = language.code;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [lastB64, setLastB64] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showText, setShowText] = useState(false);
  const [sharing, setSharing] = useState(false);

  const analyze = async (base64: string, mode: 'summary' | 'draft') => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/scan/notice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ image_base64: base64, lang, mode }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || 'Could not read the document.');
      }
      setResult(await r.json());
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (fromCamera: boolean) => {
    setError('');
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        setError('Permission blocked. Open Settings to allow access.');
      } else {
        setError('We need access to scan a document.');
      }
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { base64: true, quality: 0.5, allowsEditing: true, mediaTypes: ['images'] };
    try {
      const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;
      setImg(res.assets[0].uri);
      setLastB64(res.assets[0].base64);
      setResult(null);
      await analyze(res.assets[0].base64, 'summary');
    } catch {
      // The camera can be unavailable in a sandboxed web preview (camera access
      // is blocked inside the iframe). Fall back to picking an image so the user
      // is never dead-ended; on a phone the live camera opens normally.
      if (fromCamera) {
        try {
          const res2 = await ImagePicker.launchImageLibraryAsync(opts);
          if (!res2.canceled && res2.assets?.[0]?.base64) {
            setImg(res2.assets[0].uri); setLastB64(res2.assets[0].base64); setResult(null);
            await analyze(res2.assets[0].base64, 'summary');
            return;
          }
        } catch { /* ignore and show guidance below */ }
        setError('The camera can\u2019t open in this preview. Open DHARA on your phone to use the camera, or tap “Choose from gallery”.');
      } else {
        setError('Could not open the gallery. Please try again.');
      }
    }
  };

  const share = async () => {
    if (!result) return;
    setSharing(true);
    try {
      const html = buildScanHtml(result);
      if (Platform.OS === 'web') {
        // Web preview: open a printable tab (Ctrl+P → Save as PDF), same
        // fallback used elsewhere in the app since browsers can't silently
        // write a PDF file to disk.
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        return;
      }
      const Print = await import('expo-print');
      const Sharing = await import('expo-sharing');
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: result.mode === 'draft' ? 'Share drafted reply' : 'Share document summary',
        });
      } else {
        // No native share sheet available — fall back to a plain-text share
        // so the user still gets the content some way.
        await Share.share({ message: `${result.summary}\n\nNext step: ${result.action}` });
      }
    } catch {
      // PDF generation failed for some reason — don't dead-end the user.
      try { await Share.share({ message: `${result.summary}\n\nNext step: ${result.action}` }); } catch {}
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Scan a notice" subtitle="Photo → read → explain in your language" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {!result && !busy && (
          <View style={styles.intro}>
            <View style={styles.introIcon}><Ionicons name="document-text-outline" size={34} color={c.gold} /></View>
            <Text style={styles.introTitle}>Point your camera at any notice, letter or bill</Text>
            <Text style={styles.introSub}>DHARA reads it, explains it in simple {language.native}, and can draft a reply. Your photo is used only to read this document.</Text>
          </View>
        )}

        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator size="large" color={c.navy} />
            <Text style={styles.busyTxt}>Reading your document…</Text>
          </View>
        )}

        {error ? (
          <View style={styles.errBox}>
            <Ionicons name="alert-circle-outline" size={18} color={c.error} />
            <Text style={styles.errTxt}>{error}</Text>
            {error.includes('Settings') && (
              <Pressable style={styles.settingsBtn} onPress={() => Linking.openSettings()}>
                <Text style={styles.settingsTxt}>Open Settings</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {result && !busy && (
          <View>
            {img ? <Image source={{ uri: img }} style={styles.preview} resizeMode="cover" /> : null}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{result.mode === 'draft' ? 'DRAFTED REPLY' : 'WHAT THIS MEANS'}</Text>
              <Text style={styles.summary}>{result.summary}</Text>
            </View>
            {result.action ? (
              <View style={styles.actionCard}>
                <Ionicons name="arrow-forward-circle" size={18} color={c.gold} />
                <Text style={styles.actionTxt}>{result.action}</Text>
              </View>
            ) : null}

            {result.suggested_template && draftByType(result.suggested_template) ? (
              <Pressable
                style={styles.templateCard}
                testID="scan-use-template"
                onPress={() => router.push({
                  pathname: '/drafts/[type]',
                  params: { type: result.suggested_template!, prefill: JSON.stringify(result.prefill || {}) },
                } as any)}
              >
                <View style={styles.templateIcon}>
                  <Ionicons name={draftByType(result.suggested_template)!.icon} size={20} color={c.navy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.templateTitle}>Use the {draftByType(result.suggested_template)!.title} template</Text>
                  <Text style={styles.templateSub}>
                    {Object.keys(result.prefill || {}).length
                      ? 'DHARA can pre-fill what it read from this document — you just review and send.'
                      : 'A ready, legally-worded notice for exactly this situation.'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
              </Pressable>
            ) : null}

            <Pressable style={styles.toggle} onPress={() => setShowText(s => !s)}>
              <Ionicons name={showText ? 'chevron-up' : 'chevron-down'} size={18} color={c.navy} />
              <Text style={styles.toggleTxt}>{showText ? 'Hide' : 'Show'} the exact text read</Text>
            </Pressable>
            {showText && <Text style={styles.extracted}>{result.extracted_text}</Text>}

            <View style={styles.resultBtns}>
              <Pressable style={styles.secBtn} onPress={share} disabled={sharing} testID="scan-share">
                {sharing ? <ActivityIndicator size="small" color={c.navy} /> : <Ionicons name="share-outline" size={18} color={c.navy} />}
                <Text style={styles.secTxt}>{sharing ? 'Preparing PDF…' : 'Share'}</Text>
              </Pressable>
              {result.mode !== 'draft' && lastB64 && (
                <Pressable style={styles.secBtn} onPress={() => analyze(lastB64, 'draft')}>
                  <Ionicons name="create-outline" size={18} color={c.navy} /><Text style={styles.secTxt}>Draft a reply</Text>
                </Pressable>
              )}
              {result.mode === 'draft' && lastB64 && (
                <Pressable style={styles.secBtn} onPress={() => analyze(lastB64, 'summary')}>
                  <Ionicons name="reader-outline" size={18} color={c.navy} /><Text style={styles.secTxt}>Explain instead</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {!busy && (
          <View style={styles.actions}>
            <Pressable style={styles.primaryBtn} onPress={() => pick(true)} testID="scan-camera">
              <Ionicons name="camera" size={20} color="#fff" />
              <Text style={styles.primaryTxt}>Take a photo</Text>
            </Pressable>
            <Pressable style={styles.ghostBtn} onPress={() => pick(false)} testID="scan-gallery">
              <Ionicons name="images-outline" size={20} color={c.navy} />
              <Text style={styles.ghostTxt}>Choose from gallery</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  intro: { alignItems: 'center', paddingVertical: 10 },
  introIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center' },
  introTitle: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink, textAlign: 'center', marginTop: 16 },
  introSub: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  busy: { alignItems: 'center', paddingVertical: 50, gap: 14 },
  busyTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.muted },
  errBox: { backgroundColor: '#FBEAE8', borderRadius: 12, padding: 14, marginTop: 16, gap: 8 },
  errTxt: { fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.error },
  settingsBtn: { backgroundColor: c.navy, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 6 },
  settingsTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  card: { backgroundColor: c.navy, borderRadius: 18, padding: 20, marginTop: 8 },
  preview: { width: '100%', height: 160, borderRadius: 14, marginBottom: 12, backgroundColor: c.surfaceTertiary },
  cardLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.gold, letterSpacing: 1.2 },
  summary: { fontFamily: theme.fonts.body, fontSize: 17, color: '#fff', lineHeight: 26, marginTop: 10 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.goldMuted, borderRadius: 14, padding: 16, marginTop: 14 },
  actionTxt: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.ink, lineHeight: 22 },
  templateCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.gold, borderRadius: 16, padding: 16, marginTop: 14 },
  templateIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  templateTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  templateSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 17 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  toggleTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  extracted: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14 },
  resultBtns: { flexDirection: 'row', gap: 12, marginTop: 18 },
  secBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingVertical: 13, backgroundColor: c.surface },
  secTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  actions: { gap: 12, marginTop: 24 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16 },
  primaryTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 14, paddingVertical: 16 },
  ghostTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
