/**
 * Missing Person — Result Screen
 * Reads answers from AsyncStorage (device only), generates PDF on-device,
 * and shows the shareable Rights Card.
 *
 * DATA POLICY: PDF generated on-device via expo-print. No answers sent to server.
 *
 * Route: /missing/result
 */
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/src/auth';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { answersKey, clearSupport, loadSupport, mapUrl, MissingPhoto, MissingSupport, photoForPdf, photoRequest } from '@/src/missing/support';
import rightsData    from '@/src/content/missing_rights.json';
import { indiaEntity } from '@/src/operatorIdentity';

import { openExternal } from '@/src/outbound';
type Lang = 'en' | 'hi' | 'mr';

const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;
const RED = theme.colors.error;
const BG = theme.colors.background;

function t(obj: Record<string, string> | undefined, lang: Lang): string {
  if (!obj) return '';
  return obj[lang] || obj['en'] || '';
}

// ── Build the HTML for the complaint draft ────────────────────────────────────
function buildDraftHtml(answers: Record<string, string>, lang: Lang, support: MissingSupport | null, photos: string[]): string {
  const missingName = answers['missing_name'] || 'Unknown';
  const ts = new Date().toLocaleString();

  const fieldLabels: Record<string, Record<Lang, string>> = {
    missing_name:        { en: 'Name of Missing Person', hi: 'लापता व्यक्ति का नाम', mr: 'बेपत्ता व्यक्तीचे नाव' },
    age:                 { en: 'Age', hi: 'आयु', mr: 'वय' },
    relationship:        { en: 'Relationship to Complainant', hi: 'शिकायतकर्ता से संबंध', mr: 'तक्रारदाराशी नाते' },
    last_seen_date:      { en: 'Last Seen — Date & Time', hi: 'अंतिम बार देखा — तिथि और समय', mr: 'शेवटचे पाहिले — तारीख आणि वेळ' },
    last_seen_place:     { en: 'Last Seen — Place', hi: 'अंतिम बार देखा — स्थान', mr: 'शेवटचे पाहिले — ठिकाण' },
    physical_description:{ en: 'Physical Description', hi: 'शारीरिक विवरण', mr: 'शारीरिक वर्णन' },
    distinguishing_marks:{ en: 'Identifying Marks', hi: 'पहचान चिह्न', mr: 'ओळखण्याची खूण' },
    last_known_contact:  { en: 'Last Known Contact', hi: 'अंतिम ज्ञात संपर्क', mr: 'शेवटचा ज्ञात संपर्क' },
    possible_destination:{ en: 'Possible Destination', hi: 'संभावित स्थान', mr: 'संभाव्य ठिकाण' },
    reason_if_known:     { en: 'Reason (if known)', hi: 'कारण (यदि ज्ञात)', mr: 'कारण (माहीत असल्यास)' },
    previous_missing:    { en: 'Previously Missing?', hi: 'पहले लापता?', mr: 'यापूर्वी बेपत्ता?' },
    mobile_or_vehicle:   { en: 'Mobile / Vehicle', hi: 'मोबाइल / वाहन', mr: 'मोबाईल / वाहन' },
    police_station:      { en: 'Police Station', hi: 'पुलिस थाना', mr: 'पोलीस ठाणे' },
    reporter_name:       { en: "Complainant's Name", hi: 'शिकायतकर्ता का नाम', mr: 'तक्रारदाराचे नाव' },
    reporter_address:    { en: "Complainant's Address", hi: 'शिकायतकर्ता का पता', mr: 'तक्रारदाराचा पत्ता' },
    reporter_mobile:     { en: "Complainant's Mobile", hi: 'शिकायतकर्ता का मोबाइल', mr: 'तक्रारदाराचा मोबाईल' },
  };

  const fieldRows = Object.entries(fieldLabels)
    .filter(([k]) => answers[k] && answers[k] !== '—' && answers[k] !== 'confirmed')
    .map(([k, labels]) => `
      <tr>
        <td style="padding:8px 12px;background:#f5f5f5;font-size:12px;color:#666;width:40%;vertical-align:top;font-weight:600;">
          ${(labels[lang] || labels['en']).toUpperCase()}
        </td>
        <td style="padding:8px 12px;font-size:14px;color:#111;vertical-align:top;">
          ${String(answers[k]).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
        </td>
      </tr>
    `).join('');

  const location = support?.location;
  const annex = `${location ? `<h2>Confirmed last-seen location</h2><p>${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${location.accuracy ? ` (GPS accuracy ±${Math.round(location.accuracy)} m)` : ''}</p><p><a href="${mapUrl(location)}">View on map</a></p><p>Confirmed by the complainant. Not live tracking.</p>` : ''}
    ${photos.length ? `<h2>Attached photographs</h2>${photos.map((src, i) => `<figure style="break-inside:avoid"><img src="${src}" style="max-width:100%;max-height:360px;object-fit:contain"/><figcaption>Photo ${i + 1}</figcaption></figure>`).join('')}` : ''}`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>DHARA Missing Person Complaint</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
  h1   { color: #1B2B5B; font-size: 20px; margin-bottom: 4px; }
  .disclaimer {
    background: #FFF8E7; border-left: 4px solid #C9973A;
    padding: 12px; font-size: 12px; color: #555; margin-bottom: 20px; line-height: 1.6;
  }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  tr { border-bottom: 1px solid #eee; }
  .footer { margin-top: 24px; font-size: 11px; color: #888; }
</style>
</head>
<body>
  <h1>${lang === 'hi' ? 'लापता व्यक्ति की शिकायत' : lang === 'mr' ? 'बेपत्ता व्यक्तीची तक्रार' : 'Missing Person Complaint'}</h1>
  <p style="color:#666;font-size:13px;">Prepared by DHARA · ${ts}</p>

  <div class="disclaimer">
    <strong>IMPORTANT:</strong> DHARA has prepared this draft to help you.
    This document has not been submitted to the police. You must submit it yourself
    at your local police station. Call 112 for immediate police assistance.
  </div>

  <table>
    ${fieldRows}
  </table>
  ${annex}

  <div class="footer">
    DHARA_MissingPerson_${missingName.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 20)}_${Date.now()}.pdf<br/>
    © DHARA · ${indiaEntity} · For citizen assistance only
  </div>
</body>
</html>`;
}

// ── Rights Card Component ─────────────────────────────────────────────────────
function RightsCard({ lang, onShare }: { lang: Lang; onShare: () => void }) {
  const card = rightsData.card;

  const makeCall = (number: string) => {
    openExternal(`tel:${number}`).catch(() => {});
  };

  return (
    <View style={rc.card}>
      <Text style={rc.title}>{t(card.title, lang)}</Text>

      {/* Emergency chips */}
      <View style={rc.chips}>
        {card.emergency_numbers.map(en => (
          <Pressable key={en.number} style={rc.chip} onPress={() => makeCall(en.number)}>
            <Text style={rc.chipNum}>📞 {en.number}</Text>
            <Text style={rc.chipLabel}>{t(en.label, lang)}</Text>
          </Pressable>
        ))}
      </View>

      {/* Rights panels */}
      {card.rights.map(right => (
        <View key={right.id} style={rc.panel}>
          <Text style={rc.panelHeading}>{t(right.heading, lang)}</Text>
          <Text style={rc.panelBody}>{t(right.body, lang)}</Text>
        </View>
      ))}

      {/* Footer */}
      <Text style={rc.footer}>{t(card.footer_note, lang)}</Text>

      {/* Share button */}
      <Pressable style={rc.shareBtn} onPress={onShare}>
        <Text style={rc.shareBtnText}>
          {lang === 'hi' ? '📤 छवि के रूप में शेयर करें' : lang === 'mr' ? '📤 प्रतिमा म्हणून शेअर करा' : '📤 Share as Image'}
        </Text>
      </Pressable>
    </View>
  );
}

// ── Main Result Screen ────────────────────────────────────────────────────────
export default function MissingResultScreen() {
  const { language: rawLang, user, token } = useAuth();
  const userId = user?.id;
  const lang: Lang = (['en', 'hi', 'mr'].includes(rawLang.code) ? rawLang.code : 'en') as Lang;
  const router = useRouter();

  const [answers,   setAnswers]   = useState<Record<string, string>>({});
  const [loading,   setLoading]   = useState(true);
  const [pdfUri,    setPdfUri]    = useState<string | null>(null);
  const [pdfName,   setPdfName]   = useState('');
  const [genError,  setGenError]  = useState('');
  const [generating, setGenerating] = useState(false);
  const [support, setSupport] = useState<MissingSupport | null>(null);
  const [photos, setPhotos] = useState<MissingPhoto[]>([]);

  // Load answers from device storage
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setPdfUri(null); setGenError('');
    (async () => {
      if (!userId || !token) throw new Error('Please sign in to view your complaint.');
      const raw = await AsyncStorage.getItem(answersKey(userId));
      const stored = await loadSupport(userId);
      const files = stored.photosAttached ? await (await photoRequest(stored.draftId, token)).json() : [];
      if (active) { setAnswers(raw ? JSON.parse(raw) : {}); setSupport(stored); setPhotos(files); }
    })().catch(e => { if (active) setGenError(e.message || 'Could not load your complaint.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, token]));

  const missingName = answers['missing_name'] || 'Unknown';
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const filename = `DHARA_MissingPerson_${missingName.replace(/\s+/g, '_').slice(0, 20)}_${ts}.pdf`;

  // ── Generate PDF on-device ──────────────────────────────────────────────
  const generatePdf = useCallback(async () => {
    setGenerating(true);
    setGenError('');
    try {
      if (!userId || !token || !answers.missing_name) throw new Error('Complete the interview before generating your complaint.');
      const current = await loadSupport(userId);
      const files: MissingPhoto[] = current.photosAttached ? await (await photoRequest(current.draftId, token)).json() : [];
      const images = await Promise.all(files.map(photo => photoForPdf(current.draftId, photo, token)));
      const html = buildDraftHtml(answers, lang, current, images);

      if (Platform.OS === 'web') {
        // Web: open a new tab with the HTML content — user can Ctrl+P → Save as PDF
        const blob = new Blob([html], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setPdfUri(url);
      } else {
        // Native: use expo-print to create PDF file on device
        const Print = await import('expo-print');
        const result = await Print.printToFileAsync({ html, base64: false });
        setPdfUri(result.uri);
      }
      setPdfName(filename);
    } catch (err: any) {
      setGenError(err?.message || 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  }, [answers, lang, filename, userId, token]);

  // ── Share PDF ──────────────────────────────────────────────────────────
  const sharePdf = async () => {
    if (!pdfUri) return;
    if (Platform.OS === 'web') {
      window.open(pdfUri, '_blank');
    } else {
      try {
        const Sharing = await import('expo-sharing');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', dialogTitle: pdfName });
        }
      } catch {
        Alert.alert('Share unavailable', 'PDF saved to: ' + pdfUri);
      }
    }
  };

  // ── Share Rights Card as image ─────────────────────────────────────────
  const shareRightsCard = async () => {
    // Build rights card HTML and open as printable/shareable page
    const card = rightsData.card;
    const rightsHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body { font-family: Arial, sans-serif; background:#1B2B5B; color:#fff; padding:24px; }
  h1   { font-size:22px; color:#C9973A; margin-bottom:16px; }
  .chip{ display:inline-block; background:#CC0000; color:#fff; padding:10px 16px;
         border-radius:12px; margin:4px; font-size:18px; font-weight:bold; }
  .panel { background:rgba(255,255,255,0.1); border-radius:10px; padding:14px; margin:8px 0; }
  .phead { font-size:14px; font-weight:700; color:#C9973A; margin-bottom:6px; }
  .pbody { font-size:13px; line-height:1.6; }
  .footer{ font-size:11px; color:rgba(255,255,255,0.6); margin-top:16px; }
</style></head><body>
<h1>${t(card.title, lang)}</h1>
${card.emergency_numbers.map(e => `<span class="chip">📞 ${e.number} · ${t(e.label, lang)}</span>`).join('')}
${card.rights.map(r => `<div class="panel"><div class="phead">${t(r.heading, lang)}</div><div class="pbody">${t(r.body, lang)}</div></div>`).join('')}
<div class="footer">${t(card.footer_note, lang)}</div>
</body></html>`;

    if (Platform.OS === 'web') {
      const blob = new Blob([rightsHtml], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    } else {
      try {
        const Print = await import('expo-print');
        const Sharing = await import('expo-sharing');
        const { uri } = await Print.printToFileAsync({ html: rightsHtml, base64: false });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Rights Card' });
        }
      } catch {
        Alert.alert('Share', 'Rights card share failed');
      }
    }
  };

  // ── Print complaint ────────────────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    if (!answers.missing_name) {
      Alert.alert('No data', 'Complete the interview before printing.');
      return;
    }
    const current = await loadSupport(userId!);
    const html = buildDraftHtml(answers, lang, current, []);
    if (Platform.OS === 'web') {
      const blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    } else {
      try {
        const Print = await import('expo-print');
        await Print.printAsync({ html });
      } catch {
        Alert.alert('Print unavailable', 'Use Generate PDF instead.');
      }
    }
  }, [answers, lang, userId, support]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.centred}>
          <ActivityIndicator size="large" color={NAVY} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView testID="missing-result-screen" style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header */}
        <Pressable testID="missing-result-back" onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </Pressable>

        <View style={s.banner}>
          <Text style={s.bannerEmoji}>📋</Text>
          <Text testID="missing-result-title" style={s.bannerTitle}>
            {lang === 'hi' ? 'मसौदा तैयार' : lang === 'mr' ? 'मसुदा तयार' : 'Draft Ready'}
          </Text>
          <Text style={s.bannerSub}>
            {lang === 'hi'
              ? 'आपकी शिकायत का मसौदा तैयार है। इसे पुलिस थाने पर जमा करें।'
              : lang === 'mr'
              ? 'तुमच्या तक्रारीचा मसुदा तयार आहे. पोलीस ठाण्यात सादर करा.'
              : 'Your complaint draft is ready. Submit it at the police station.'}
          </Text>
        </View>
        <View style={s.attachments}>
          <Text testID="missing-result-attachments" style={s.attachmentText}>{photos.length} photo{photos.length === 1 ? '' : 's'} attached{support?.location ? ' · Last-seen GPS confirmed' : ' · No GPS added'}</Text>
          {support?.location && <Text testID="missing-result-coordinates" style={s.attachmentText}>{support.location.latitude.toFixed(6)}, {support.location.longitude.toFixed(6)}</Text>}
          <Pressable testID="missing-result-edit-attachments" style={s.attachmentBtn} onPress={() => router.push('/missing/attachments')}><Ionicons name="attach" size={20} color={NAVY} /><Text style={s.attachmentText}>Add / edit photos & location</Text></Pressable>
        </View>

        {/* PDF generation */}
        {!pdfUri && !generating && (
          <Pressable testID="missing-generate-pdf" style={s.primaryBtn} onPress={generatePdf}>
            <Text style={s.primaryBtnText}>
              {lang === 'hi' ? '📄 PDF तैयार करें' : lang === 'mr' ? '📄 PDF तयार करा' : '📄 Generate PDF'}
            </Text>
          </Pressable>
        )}

        {generating && (
          <View style={s.generatingRow}>
            <ActivityIndicator size="small" color={NAVY} />
            <Text style={s.generatingText}>
              {lang === 'hi' ? 'PDF तैयार हो रहा है...' : lang === 'mr' ? 'PDF तयार होत आहे...' : 'Generating PDF…'}
            </Text>
          </View>
        )}

        {genError ? (
          <View style={s.errorCard}>
            <Text testID="missing-pdf-error" accessibilityRole="alert" style={s.errorText}>{genError}</Text>
          </View>
        ) : null}

        {pdfUri && (
          <Pressable testID="missing-share-pdf" style={s.primaryBtn} onPress={sharePdf}>
            <Text style={s.primaryBtnText}>
              {lang === 'hi' ? '⬇ PDF डाउनलोड / शेयर करें' : lang === 'mr' ? '⬇ PDF डाउनलोड / शेअर करा' : '⬇ Download / Share PDF'}
            </Text>
          </Pressable>
        )}

        {/* Print button */}
        {Object.keys(answers).length > 0 && !loading && (
          <Pressable testID="missing-print" style={[s.primaryBtn, { backgroundColor: '#2D6A4F' }]} onPress={handlePrint}>
            <Text style={s.primaryBtnText}>
              {lang === 'hi' ? '🖨 प्रिंट करें' : lang === 'mr' ? '🖨 प्रिंट करा' : '🖨 Print Complaint'}
            </Text>
          </Pressable>
        )}

        {/* Device-only notice */}
        <View style={s.privacyCard}>
          <Text testID="missing-result-privacy" style={s.privacyText}>
            {lang === 'hi'
              ? 'उत्तर और GPS इस डिवाइस पर रहते हैं। वैकल्पिक फोटो आपकी सहमति से निजी स्टोरेज में अपलोड होते हैं।'
              : lang === 'mr'
              ? 'उत्तरे आणि GPS या डिव्हाइसवर राहतात. पर्यायी फोटो तुमच्या संमतीने खाजगी स्टोरेजमध्ये अपलोड होतात.'
              : 'Answers and GPS remain on this device. Optional photos are uploaded privately with your agreement. The PDF includes your attached photos and confirmed location.'}
          </Text>
        </View>

        {/* Rights Card */}
        <Text style={s.rightsTitle}>
          {lang === 'hi' ? '— आपके अधिकार —' : lang === 'mr' ? '— तुमचे अधिकार —' : '— Your Rights —'}
        </Text>

        <RightsCard lang={lang} onShare={shareRightsCard} />

        {/* Start over */}
        <Pressable
          testID="missing-start-new"
          style={s.secondaryBtn}
          onPress={async () => {
            try {
              if (support && token) for (const photo of photos) await photoRequest(support.draftId, token, photo.file_id, { method: 'DELETE' });
              if (user) await clearSupport(user.id);
              router.replace('/missing');
            } catch { setGenError('Could not clear this draft. Please retry.'); }
          }}
        >
          <Text style={s.secondaryBtnText}>
            {lang === 'hi' ? '↺ नई शिकायत शुरू करें' : lang === 'mr' ? '↺ नवीन तक्रार सुरू करा' : '↺ Start New Complaint'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  attachments: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.divider, padding: 14, borderRadius: 12, marginBottom: 20, gap: 8 },
  attachmentText: { fontSize: 14, color: NAVY, lineHeight: 21 },
  attachmentBtn: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center' },
  safe:           { flex: 1, backgroundColor: BG },
  scroll:         { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 60 },
  centred:        { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backBtn:        { marginBottom: 12, minHeight: 44, minWidth: 44, justifyContent: 'center' },
  backText:       { color: NAVY, fontSize: 14, fontWeight: '600' },
  banner:         {
    backgroundColor: NAVY, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 20,
  },
  bannerEmoji:    { fontSize: 36, marginBottom: 8 },
  bannerTitle:    { fontSize: 22, fontWeight: '700', color: '#FFF' },
  bannerSub:      { fontSize: 13, color: '#C5CEEA', marginTop: 8, textAlign: 'center', lineHeight: 19 },
  primaryBtn:     {
    backgroundColor: NAVY, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  secondaryBtn:   {
    borderWidth: 1.5, borderColor: NAVY, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 8,
  },
  secondaryBtnText: { color: NAVY, fontWeight: '600', fontSize: 14 },
  generatingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 12 },
  generatingText: { color: NAVY, fontSize: 14 },
  errorCard:      { backgroundColor: '#FFF0F0', borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText:      { color: RED, fontSize: 13 },
  privacyCard:    {
    backgroundColor: '#F0F4FF', borderRadius: 10, padding: 14, marginBottom: 24,
  },
  privacyText:    { fontSize: 12, color: '#334', lineHeight: 18 },
  rightsTitle:    {
    fontSize: 14, fontWeight: '700', color: NAVY, textAlign: 'center',
    marginBottom: 16, letterSpacing: 0.5,
  },
});

const rc = StyleSheet.create({
  card:          {
    backgroundColor: NAVY, borderRadius: 20, padding: 20, marginBottom: 20,
  },
  title:         { fontSize: 18, fontWeight: '700', color: GOLD, marginBottom: 16 },
  chips:         { flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  chip:          {
    backgroundColor: RED, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, flex: 1,
    alignItems: 'center',
  },
  chipNum:       { fontSize: 20, fontWeight: '800', color: '#FFF' },
  chipLabel:     { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4, textAlign: 'center' },
  panel:         {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, marginBottom: 10,
  },
  panelHeading:  { fontSize: 13, fontWeight: '700', color: GOLD, marginBottom: 6 },
  panelBody:     { fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },
  footer:        { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 12, lineHeight: 17 },
  shareBtn:      {
    marginTop: 16, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  shareBtnText:  { color: '#FFF', fontWeight: '600', fontSize: 14 },
});
