import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking, Share, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { API_BASE } from '@/src/apiBase';

const c = theme.colors;

type Result = { extracted_text: string; summary: string; action: string; mode: string };

export default function Scan() {
  const { language } = useAuth();
  const lang = language.code;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [lastB64, setLastB64] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showText, setShowText] = useState(false);

  const analyze = async (base64: string, mode: 'summary' | 'draft') => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/scan/notice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    try { await Share.share({ message: `${result.summary}\n\nNext step: ${result.action}` }); } catch {}
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

            <Pressable style={styles.toggle} onPress={() => setShowText(s => !s)}>
              <Ionicons name={showText ? 'chevron-up' : 'chevron-down'} size={18} color={c.navy} />
              <Text style={styles.toggleTxt}>{showText ? 'Hide' : 'Show'} the exact text read</Text>
            </Pressable>
            {showText && <Text style={styles.extracted}>{result.extracted_text}</Text>}

            <View style={styles.resultBtns}>
              <Pressable style={styles.secBtn} onPress={share}>
                <Ionicons name="share-outline" size={18} color={c.navy} /><Text style={styles.secTxt}>Share</Text>
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
