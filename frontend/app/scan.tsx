/**
 * DHARA — Scan a Notice v2
 * Complete staged journey: Capture → Review → Processing → OCR Review → Result
 *
 * Steps:
 *   entry      — intro screen, camera/gallery buttons
 *   review     — DHARA-controlled post-capture screen (Retake / Rotate / Use this scan)
 *   processing — animated staged progress while API call runs
 *   ocr-review — user reviews / corrects extracted text before seeing interpretation
 *   result     — structured legal or non-legal result
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator,
  Linking, Share, Image, Platform, TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { API_BASE } from '@/src/apiBase';
import { draftByType } from '@/src/drafts';

const c = theme.colors;

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanStep = 'entry' | 'review' | 'processing' | 'ocr-review' | 'result';

type MaterialFacts = {
  issuing_authority?: string;
  recipient?: string;
  date_of_issue?: string;
  reference_number?: string;
  amount?: string;
  deadline?: string;
  statutes_cited?: string;
  jurisdiction?: string;
};

type ScanResult = {
  extracted_text: string;
  document_type: string;
  is_legal_document: boolean;
  summary: string;
  action: string;
  mode: string;
  material_facts: MaterialFacts;
  legal_truth_state: string;
  suggested_template?: string | null;
  prefill?: Record<string, string>;
  scan_id?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PROCESSING_STEPS = [
  'Image ready',
  'Reading text from document',
  'Identifying document type',
  'Checking legal relevance',
  'Preparing explanation',
];

const LEGAL_DOC_TYPES = new Set([
  'LEGAL_NOTICE', 'COURT_DOCUMENT', 'POLICE_DOCUMENT', 'GOVERNMENT_NOTICE',
  'EMPLOYMENT_NOTICE', 'TENANCY_NOTICE', 'BANK_NOTICE', 'LOAN_DEMAND',
  'CONTRACT', 'LEGAL_AGREEMENT',
]);

const DOC_TYPE_LABELS: Record<string, string> = {
  LEGAL_NOTICE: 'Legal Notice',
  COURT_DOCUMENT: 'Court Document',
  POLICE_DOCUMENT: 'Police Document',
  GOVERNMENT_NOTICE: 'Government Notice',
  EMPLOYMENT_NOTICE: 'Employment Notice',
  TENANCY_NOTICE: 'Tenancy / Housing Notice',
  CONSUMER_BILL: 'Consumer Bill',
  BANK_NOTICE: 'Bank Notice',
  LOAN_DEMAND: 'Loan Demand Notice',
  INSURANCE_DOCUMENT: 'Insurance Document',
  UTILITY_BILL: 'Utility Bill',
  TAX_NOTICE: 'Tax Notice',
  PRIVATE_LETTER: 'Private Letter',
  CONTRACT: 'Contract',
  LEGAL_AGREEMENT: 'Legal Agreement',
  NON_LEGAL_DOCUMENT: 'Non-legal Document',
  UNKNOWN: 'Document',
};

const DOC_TYPE_DESCRIPTIONS: Record<string, string> = {
  NON_LEGAL_DOCUMENT: 'an informational or technical document',
  CONSUMER_BILL: 'a consumer or product bill',
  UTILITY_BILL: 'a utility bill',
  INSURANCE_DOCUMENT: 'an insurance document',
  PRIVATE_LETTER: 'a private letter or personal correspondence',
  TAX_NOTICE: 'a tax document',
};

const FACT_LABELS: Record<string, string> = {
  issuing_authority: 'Issued by',
  recipient: 'Addressed to',
  date_of_issue: 'Issued on',
  reference_number: 'Reference / Case No.',
  amount: 'Amount',
  deadline: 'Response deadline',
  statutes_cited: 'Law cited',
  jurisdiction: 'Jurisdiction',
};

// ── HTML builder for sharing ───────────────────────────────────────────────────

const esc = (s: string) => (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildScanHtml = (r: ScanResult) => {
  const isDraft = r.mode === 'draft';
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const docTypeLabel = DOC_TYPE_LABELS[r.document_type] || 'Document';
  const factsHtml = r.material_facts
    ? Object.entries(r.material_facts)
        .filter(([, v]) => v && v !== 'null' && v !== 'NOT FOUND')
        .map(([k, v]) =>
          `<div class="fact"><span class="fk">${FACT_LABELS[k] || k}</span><span class="fv">${esc(v as string)}</span></div>`
        ).join('')
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
body{padding:28px;font-family:Arial,sans-serif;color:#1A1A1A;}
h2{color:#1B2B5B;font-size:18px;margin-bottom:2px;}
.date{color:#6B6B6B;font-size:12px;margin-bottom:18px;}
.label{color:#8A6A2A;font-size:11px;letter-spacing:1px;font-weight:700;margin-top:18px;}
.body{white-space:pre-wrap;font-size:14px;line-height:1.7;margin-top:6px;}
.orig{background:#F7F7F7;border-left:3px solid #C9973A;padding:12px;font-size:12px;line-height:1.6;color:#444;white-space:pre-wrap;margin-top:8px;}
.foot{color:#8A8A8A;font-size:11px;margin-top:26px;border-top:1px solid #E5E5E5;padding-top:10px;}
.badge{display:inline-block;background:#E7EDF4;color:#1B2B5B;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;margin-bottom:12px;}
.fact{display:flex;gap:12px;margin-bottom:6px;}
.fk{color:#8A6A2A;font-size:12px;font-weight:700;min-width:130px;}
.fv{font-size:12px;color:#1A1A1A;}
</style></head><body>
<h2>${isDraft ? 'Drafted reply' : 'Document, explained'} — DHARA</h2>
<div class="date">${today}</div>
<div class="badge">${esc(docTypeLabel)}</div>
${factsHtml ? `<div class="label">IMPORTANT DETAILS</div>${factsHtml}` : ''}
${isDraft
  ? `<div class="label">YOUR DRAFTED REPLY</div><div class="body">${esc(r.summary)}</div>`
  : `<div class="label">WHAT THIS MEANS</div><div class="body">${esc(r.summary)}</div>`}
${r.action ? `<div class="label">WHAT YOU CAN DO</div><div class="body">${esc(r.action)}</div>` : ''}
${r.extracted_text ? `<div class="label">TEXT DHARA READ</div><div class="orig">${esc(r.extracted_text)}</div>` : ''}
<div class="foot">DHARA's reading of a photographed document, for your reference only. Review all details before acting. DHARA does not create an advocate-client relationship.</div>
</body></html>`;
};

// ── Local header (step-aware back navigation) ─────────────────────────────────

function ScanHeader({
  step, onBack,
}: { step: ScanStep; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const titleMap: Record<ScanStep, { title: string; sub?: string }> = {
    entry:        { title: 'Scan a notice', sub: 'Photo → read → explain in your language' },
    review:       { title: 'Review scan' },
    processing:   { title: 'Reading your document' },
    'ocr-review': { title: 'Text DHARA read' },
    result:       { title: 'Scanned document' },
  };
  const { title, sub } = titleMap[step];
  const showBack = step !== 'processing';

  const handleBack = () => {
    if (step === 'entry') router.back();
    else onBack();
  };

  return (
    <View style={[headerStyles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable
        onPress={showBack ? handleBack : undefined}
        style={[headerStyles.back, !showBack && { opacity: 0 }]}
        testID="screen-back"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={headerStyles.title} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={headerStyles.sub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.navy, paddingHorizontal: 12, paddingBottom: 16,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 22 },
  sub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: 2 },
});

// ── Main Component ──────────────────────────────────────────────────────────────

export default function Scan() {
  const router = useRouter();
  const { language, token } = useAuth();
  const lang = language?.code ?? 'en';
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<ScanStep>('entry');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [processingStepIdx, setProcessingStepIdx] = useState(0);
  const [ocrText, setOcrText] = useState('');
  const [ocrEdited, setOcrEdited] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [showOcrInResult, setShowOcrInResult] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [savedToFiles, setSavedToFiles] = useState(false);

  const processingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Processing animation ─────────────────────────────────────────────────

  const startProcessingAnimation = useCallback(() => {
    setProcessingStepIdx(0);
    const delays = [0, 1800, 4000, 7000, 10000];
    processingTimers.current = delays.map((delay, idx) =>
      setTimeout(() => setProcessingStepIdx(idx), delay)
    );
  }, []);

  const stopProcessingAnimation = useCallback(() => {
    processingTimers.current.forEach(clearTimeout);
    processingTimers.current = [];
    setProcessingStepIdx(PROCESSING_STEPS.length - 1);
  }, []);

  // ── Capture ──────────────────────────────────────────────────────────────

  const handleCapture = async (fromCamera: boolean) => {
    setError('');

    try {
      if (fromCamera) {
        const perm = await ImagePicker.getCameraPermissionsAsync();
        if (!perm.granted) {
          if (!perm.canAskAgain) {
            setError('Camera access is off. Enable it in Settings or choose from gallery instead.');
            return;
          }
          const req = await ImagePicker.requestCameraPermissionsAsync();
          if (!req.granted) {
            setError('Camera access is off. Enable it in Settings or choose from gallery instead.');
            return;
          }
        }
      } else {
        const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!req.granted) {
            setError('Gallery access denied. Enable it in Settings to allow access.');
            return;
          }
        }
      }

      const opts: ImagePicker.ImagePickerOptions = {
        base64: true,
        quality: 0.7,
        allowsEditing: false, // DHARA-controlled review screen replaces native editor
        mediaTypes: ['images'],
      };

      const res = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);

      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      setImageUri(asset.uri);
      setImageBase64(asset.base64 ?? null);
      setResult(null);
      setShowExplanation(false);
      setShowOcrInResult(false);
      setSavedToFiles(false);
      setStep('review');
    } catch {
      if (fromCamera) {
        setError(
          "The camera couldn't open in this preview. Open DHARA on your phone to use the camera, or tap \"Choose from gallery\"."
        );
      } else {
        setError('Could not open the gallery. Please try again.');
      }
    }
  };

  // ── Rotate ───────────────────────────────────────────────────────────────

  const handleRotate = async () => {
    if (!imageUri || rotating) return;
    setRotating(true);
    try {
      const manipResult = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ rotate: 90 }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setImageUri(manipResult.uri);
      if (manipResult.base64) setImageBase64(manipResult.base64);
    } catch {
      // rotation failed — keep original; do not alert the user
    } finally {
      setRotating(false);
    }
  };

  // ── Use this scan → call backend ─────────────────────────────────────────

  const handleUseScan = async () => {
    if (!imageBase64) return;
    setStep('processing');
    startProcessingAnimation();
    setBusy(true);
    setError('');

    try {
      const r = await fetch(`${API_BASE}/api/scan/notice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ image_base64: imageBase64, lang, mode: 'summary' }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || 'Could not read the document. Please try a clearer photo.');
      }
      const data: ScanResult = await r.json();
      setResult(data);
      setOcrText(data.extracted_text || '');
      setOcrEdited(false);
      setSavedToFiles(!!data.scan_id);
      stopProcessingAnimation();
      // Small pause so final animation step is visible before transition
      setTimeout(() => { setBusy(false); setStep('ocr-review'); }, 500);
    } catch (e: any) {
      stopProcessingAnimation();
      setBusy(false);
      setError(e.message || 'Something went wrong. Please try again.');
      setStep('entry');
    }
  };

  // ── Retake ───────────────────────────────────────────────────────────────

  const handleRetake = () => {
    setStep('entry');
  };

  // ── Re-analyze in draft mode ─────────────────────────────────────────────

  const reAnalyze = async (mode: 'summary' | 'draft') => {
    if (!imageBase64) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${API_BASE}/api/scan/notice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ image_base64: imageBase64, lang, mode }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || 'Could not process the document.');
      }
      const data: ScanResult = await r.json();
      setResult(data);
      setOcrText(data.extracted_text || '');
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  // ── Share ────────────────────────────────────────────────────────────────

  const handleShare = async () => {
    if (!result) return;
    setSharing(true);
    try {
      const html = buildScanHtml(result);
      if (Platform.OS === 'web') {
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
        await Share.share({ message: `${result.summary}\n\nNext step: ${result.action}` });
      }
    } catch {
      try { if (result) await Share.share({ message: `${result.summary}\n\nNext step: ${result.action}` }); } catch { /* */ }
    } finally {
      setSharing(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const friendlyDocType = (dt?: string) => DOC_TYPE_LABELS[dt ?? ''] || 'Document';

  const docTypeDescription = (dt?: string) =>
    DOC_TYPE_DESCRIPTIONS[dt ?? ''] || 'an informational document';

  const isLegalDoc = (r: ScanResult) =>
    r.is_legal_document || LEGAL_DOC_TYPES.has(r.document_type);

  const hasMaterialFacts = (r: ScanResult) =>
    r.material_facts
      ? Object.values(r.material_facts).some(
          v => v && v !== 'null' && v !== 'NOT FOUND' && v.trim() !== ''
        )
      : false;

  const handleBack = () => {
    if (step === 'review') setStep('entry');
    else if (step === 'ocr-review') setStep('review');
    else if (step === 'result') setStep('entry');
    else setStep('entry');
  };

  // ── Error box ────────────────────────────────────────────────────────────

  const ErrorBox = ({ msg }: { msg: string }) => (
    <View style={styles.errBox}>
      <Ionicons name="alert-circle-outline" size={18} color={c.error} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={styles.errTxt}>{msg}</Text>
        {imageUri && step === 'entry' && (
          <Pressable
            style={styles.retryWithScanBtn}
            onPress={() => { setError(''); setStep('review'); }}
          >
            <Text style={styles.retryWithScanTxt}>Try again with this scan</Text>
          </Pressable>
        )}
      </View>
      {msg.toLowerCase().includes('settings') && (
        <Pressable style={styles.settingsBtn} onPress={() => Linking.openSettings()}>
          <Text style={styles.settingsTxt}>Open Settings</Text>
        </Pressable>
      )}
    </View>
  );

  // ── STEP: Entry ──────────────────────────────────────────────────────────

  const renderEntry = () => (
    <>
      {!imageUri ? (
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <Ionicons name="document-text-outline" size={34} color={c.gold} />
          </View>
          <Text style={styles.introTitle}>Point your camera at any notice, letter or bill</Text>
          <Text style={styles.introSub}>
            DHARA reads it, explains it in simple {language?.native || 'English'}, and can draft a reply.
            {'\n\n'}You review the extracted text before any legal interpretation is shown.
          </Text>
        </View>
      ) : (
        <View style={styles.retryPreview}>
          <Image source={{ uri: imageUri }} style={styles.retryThumb} resizeMode="cover" />
          <Text style={styles.retryHint}>Your previous scan — tap Take a photo to capture a new one.</Text>
        </View>
      )}

      {error ? <ErrorBox msg={error} /> : null}

      <View style={styles.actions}>
        <Pressable style={styles.primaryBtn} onPress={() => handleCapture(true)} testID="scan-camera">
          <Ionicons name="camera" size={20} color="#fff" />
          <Text style={styles.primaryTxt}>Take a photo</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => handleCapture(false)} testID="scan-gallery">
          <Ionicons name="images-outline" size={20} color={c.navy} />
          <Text style={styles.ghostTxt}>Choose from gallery</Text>
        </Pressable>
      </View>
    </>
  );

  // ── STEP: Review ─────────────────────────────────────────────────────────

  const renderReview = () => (
    <>
      <View style={styles.reviewImageWrap}>
        <Image source={{ uri: imageUri! }} style={styles.reviewImage} resizeMode="contain" />
      </View>
      <Text style={styles.reviewHint}>
        Make sure the full document is visible and text is clearly readable
      </Text>
      <View style={styles.reviewToolbar}>
        <Pressable style={styles.toolBtn} onPress={handleRetake} testID="scan-retake">
          <Ionicons name="camera-reverse-outline" size={22} color={c.navy} />
          <Text style={styles.toolBtnTxt}>Retake</Text>
        </Pressable>
        <Pressable
          style={[styles.toolBtn, rotating && styles.toolBtnDisabled]}
          onPress={handleRotate}
          disabled={rotating}
          testID="scan-rotate"
        >
          {rotating
            ? <ActivityIndicator size="small" color={c.navy} />
            : <Ionicons name="refresh-outline" size={22} color={c.navy} />}
          <Text style={styles.toolBtnTxt}>Rotate</Text>
        </Pressable>
      </View>
      <Pressable style={styles.useScanBtn} onPress={handleUseScan} testID="scan-use">
        <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
        <Text style={styles.useScanTxt}>Use this scan</Text>
      </Pressable>
    </>
  );

  // ── STEP: Processing ─────────────────────────────────────────────────────

  const renderProcessing = () => (
    <View style={styles.processingContainer}>
      <ActivityIndicator size="large" color={c.navy} style={styles.processingSpinner} />
      <Text style={styles.processingTitle}>Reading your document…</Text>
      <View style={styles.processingSteps}>
        {PROCESSING_STEPS.map((label, idx) => {
          const done = idx < processingStepIdx;
          const active = idx === processingStepIdx;
          return (
            <View key={idx} style={styles.processingRow}>
              <View style={styles.processingIconBox}>
                {done ? (
                  <Ionicons name="checkmark-circle" size={20} color={c.success} />
                ) : active ? (
                  <View style={styles.processingActiveDot} />
                ) : (
                  <View style={styles.processingPendingDot} />
                )}
              </View>
              <Text style={[
                styles.processingLabel,
                done && styles.processingDone,
                active && styles.processingActive,
              ]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.processingNote}>This may take up to 20 seconds</Text>
    </View>
  );

  // ── STEP: OCR Review ─────────────────────────────────────────────────────

  const renderOcrReview = () => (
    <>
      <View style={styles.ocrHeaderRow}>
        <Ionicons name="reader-outline" size={20} color={c.navy} />
        <Text style={styles.ocrSubtitle}>
          Check names, dates and amounts are correct before seeing the interpretation.
        </Text>
      </View>

      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.ocrThumb} resizeMode="contain" />
      )}

      <View style={styles.ocrBlock}>
        <Text style={styles.ocrLabel}>TEXT DHARA READ</Text>
        <TextInput
          style={styles.ocrInput}
          multiline
          value={ocrText}
          onChangeText={(t) => { setOcrText(t); setOcrEdited(true); }}
          placeholder="Extracted text will appear here…"
          placeholderTextColor={c.muted}
          textAlignVertical="top"
          testID="scan-ocr-text"
        />
        {ocrEdited && (
          <View style={styles.ocrEditedNote}>
            <Ionicons name="pencil-outline" size={14} color={c.warning} />
            <Text style={styles.ocrEditedTxt}>
              You edited the text. The analysis was based on DHARA&apos;s original reading.
            </Text>
          </View>
        )}
      </View>

      <Pressable style={styles.primaryBtn} onPress={() => setStep('result')} testID="scan-ocr-confirm">
        <Text style={styles.primaryTxt}>This looks correct — continue</Text>
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </Pressable>

      <Pressable style={[styles.ghostBtn, { marginTop: 10 }]} onPress={() => setStep('review')}>
        <Ionicons name="camera-reverse-outline" size={18} color={c.navy} />
        <Text style={styles.ghostTxt}>Go back to scan</Text>
      </Pressable>
    </>
  );

  // ── STEP: Result — Non-legal ──────────────────────────────────────────────

  const renderResultNonLegal = (r: ScanResult) => (
    <>
      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.resultThumb} resizeMode="cover" />
      )}

      <View style={styles.nonLegalBadge}>
        <Ionicons name="information-circle-outline" size={26} color={c.navy} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nonLegalTitle}>This does not appear to be a legal notice</Text>
          <Text style={styles.nonLegalSub}>
            This looks like {docTypeDescription(r.document_type)} rather than a court,
            police, government, contractual or legal notice.
          </Text>
        </View>
      </View>

      {!showExplanation && (
        <Pressable style={styles.primaryBtn} onPress={() => setShowExplanation(true)} testID="scan-explain-nonlegal">
          <Text style={styles.primaryTxt}>Explain this document</Text>
        </Pressable>
      )}

      {showExplanation && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>DOCUMENT SUMMARY</Text>
            <Text style={styles.summary}>{r.summary}</Text>
          </View>
          {r.action ? (
            <View style={styles.actionCard}>
              <Ionicons name="arrow-forward-circle" size={18} color={c.gold} />
              <Text style={styles.actionTxt}>{r.action}</Text>
            </View>
          ) : null}
        </>
      )}

      <Pressable style={styles.toggle} onPress={() => setShowOcrInResult(s => !s)}>
        <Ionicons name={showOcrInResult ? 'chevron-up' : 'chevron-down'} size={18} color={c.navy} />
        <Text style={styles.toggleTxt}>{showOcrInResult ? 'Hide' : 'Show'} text DHARA read</Text>
      </Pressable>
      {showOcrInResult && <Text style={styles.extracted}>{ocrText || r.extracted_text}</Text>}

      <Pressable
        style={[styles.ghostBtn, { marginTop: 20 }]}
        onPress={() => { setStep('entry'); setImageUri(null); setImageBase64(null); setResult(null); }}
        testID="scan-another"
      >
        <Text style={styles.ghostTxt}>Scan another document</Text>
      </Pressable>
    </>
  );

  // ── STEP: Result — Legal ─────────────────────────────────────────────────

  const renderResultLegal = (r: ScanResult) => (
    <>
      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.resultThumb} resizeMode="cover" />
      )}

      {/* Document type badge */}
      <View style={styles.docTypeBadge}>
        <Ionicons name="shield-checkmark-outline" size={14} color={c.navy} />
        <Text style={styles.docTypeBadgeTxt}>{friendlyDocType(r.document_type)}</Text>
      </View>

      {/* WHAT THIS IS */}
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionLabel}>WHAT THIS IS</Text>
        <Text style={styles.sectionText}>
          This appears to be a {friendlyDocType(r.document_type).toLowerCase()}.
        </Text>
      </View>

      {/* IMPORTANT DETAILS */}
      {hasMaterialFacts(r) && (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionLabel}>IMPORTANT DETAILS</Text>
          <View style={styles.factsGrid}>
            {Object.entries(r.material_facts || {})
              .filter(([, v]) => v && v !== 'null' && v !== 'NOT FOUND' && v.trim() !== '')
              .map(([k, v]) => (
                <View key={k} style={styles.factCard}>
                  <Text style={styles.factKey}>{FACT_LABELS[k] || k}</Text>
                  <Text style={styles.factValue}>{v as string}</Text>
                </View>
              ))}
          </View>
        </View>
      )}

      {/* WHAT THIS MEANS */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>WHAT THIS MEANS</Text>
        <Text style={styles.summary}>{r.summary}</Text>
      </View>

      {/* Legal truth state indicator */}
      {r.legal_truth_state === 'CANNOT_VERIFY' && (
        <View style={styles.truthNote}>
          <Ionicons name="information-circle-outline" size={16} color={c.warning} />
          <Text style={styles.truthNoteTxt}>
            DHARA could not verify the specific applicable law from this document alone. Consult an advocate before acting.
          </Text>
        </View>
      )}
      {r.legal_truth_state === 'VERIFIED_CONDITIONAL' && (
        <View style={[styles.truthNote, styles.truthNoteConditional]}>
          <Ionicons name="help-circle-outline" size={16} color={c.info} />
          <Text style={[styles.truthNoteTxt, { color: c.info }]}>
            The applicable law depends on additional facts not visible in this document.
          </Text>
        </View>
      )}

      {/* WHAT YOU CAN DO */}
      {r.action ? (
        <View style={styles.actionCard}>
          <Text style={styles.actionCardLabel}>WHAT YOU CAN DO</Text>
          <Text style={styles.actionTxt}>{r.action}</Text>
        </View>
      ) : null}

      {/* Template suggestion */}
      {r.suggested_template && draftByType(r.suggested_template) ? (
        <Pressable
          style={styles.templateCard}
          testID="scan-use-template"
          onPress={() => router.push({
            pathname: '/drafts/[type]',
            params: { type: r.suggested_template!, prefill: JSON.stringify(r.prefill || {}) },
          } as any)}
        >
          <View style={styles.templateIcon}>
            <Ionicons name={draftByType(r.suggested_template)!.icon} size={20} color={c.navy} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.templateTitle}>Use the {draftByType(r.suggested_template)!.title} template</Text>
            <Text style={styles.templateSub}>
              {Object.keys(r.prefill || {}).length
                ? 'DHARA can pre-fill what it read from this document — review and send.'
                : 'A ready, legally-worded notice for this situation.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
        </Pressable>
      ) : null}

      {/* Primary CTA */}
      <Pressable
        style={[styles.primaryBtn, { marginTop: 20 }]}
        onPress={() => router.push('/(tabs)' as any)}
        testID="scan-ask-dhara"
      >
        <Ionicons name="chatbubble-ellipses-outline" size={20} color="#fff" />
        <Text style={styles.primaryTxt}>Ask DHARA about this</Text>
      </Pressable>

      {/* Text toggle */}
      <Pressable style={styles.toggle} onPress={() => setShowOcrInResult(s => !s)}>
        <Ionicons name={showOcrInResult ? 'chevron-up' : 'chevron-down'} size={18} color={c.navy} />
        <Text style={styles.toggleTxt}>{showOcrInResult ? 'Hide' : 'Show'} text DHARA read</Text>
      </Pressable>
      {showOcrInResult && <Text style={styles.extracted}>{ocrText || r.extracted_text}</Text>}

      {/* Save / Share row */}
      <View style={styles.resultActionRow}>
        <Pressable
          style={[styles.secBtn, savedToFiles && styles.secBtnSaved]}
          onPress={() => {
            if (r.scan_id) { setSavedToFiles(true); }
            else if (!token) { setError('Sign in to save scans to My Files.'); }
          }}
          testID="scan-save"
        >
          <Ionicons
            name={savedToFiles ? 'checkmark-circle' : 'save-outline'}
            size={18}
            color={savedToFiles ? c.success : c.navy}
          />
          <Text style={[styles.secTxt, savedToFiles && { color: c.success }]}>
            {savedToFiles ? 'Saved' : 'Save to My Files'}
          </Text>
        </Pressable>
        <Pressable style={styles.secBtn} onPress={handleShare} disabled={sharing} testID="scan-share">
          {sharing
            ? <ActivityIndicator size="small" color={c.navy} />
            : <Ionicons name="share-outline" size={18} color={c.navy} />}
          <Text style={styles.secTxt}>{sharing ? 'Preparing…' : 'Share'}</Text>
        </Pressable>
      </View>

      {/* Draft / Explain toggle */}
      {busy ? (
        <View style={styles.busy}><ActivityIndicator color={c.navy} /><Text style={styles.busyTxt}>Processing…</Text></View>
      ) : r.mode !== 'draft' ? (
        <Pressable style={styles.ghostBtn} onPress={() => reAnalyze('draft')}>
          <Ionicons name="create-outline" size={18} color={c.navy} />
          <Text style={styles.ghostTxt}>Draft a reply to this notice</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.ghostBtn} onPress={() => reAnalyze('summary')}>
          <Ionicons name="reader-outline" size={18} color={c.navy} />
          <Text style={styles.ghostTxt}>Show explanation instead</Text>
        </Pressable>
      )}

      <Pressable
        style={[styles.ghostBtn, { marginTop: 8 }]}
        onPress={() => { setStep('entry'); setImageUri(null); setImageBase64(null); setResult(null); }}
      >
        <Text style={styles.ghostTxt}>Scan another document</Text>
      </Pressable>
    </>
  );

  // ── Result dispatcher ────────────────────────────────────────────────────

  const renderResult = () => {
    if (!result) return null;
    if (isLegalDoc(result)) return renderResultLegal(result);
    return renderResultNonLegal(result);
  };

  // ── Root render ──────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <ScanHeader step={step} onBack={handleBack} />

      {step === 'processing' ? (
        <View style={{ flex: 1 }}>{renderProcessing()}</View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'entry' && renderEntry()}
          {step === 'review' && renderReview()}
          {step === 'ocr-review' && renderOcrReview()}
          {step === 'result' && renderResult()}
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  scroll: { padding: 20 },

  // ── Entry ──────────────────────────────────────────────────────────────
  intro: { alignItems: 'center', paddingVertical: 10 },
  introIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center',
  },
  introTitle: {
    fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink,
    textAlign: 'center', marginTop: 16,
  },
  introSub: {
    fontFamily: theme.fonts.body, fontSize: 14, color: c.muted,
    textAlign: 'center', lineHeight: 21, marginTop: 10,
  },
  retryPreview: { alignItems: 'center', gap: 10, marginBottom: 8 },
  retryThumb: { width: '100%', height: 140, borderRadius: 12 },
  retryHint: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, textAlign: 'center' },
  retryWithScanBtn: {
    backgroundColor: c.navy, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 4,
  },
  retryWithScanTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 },

  // ── Error ──────────────────────────────────────────────────────────────
  errBox: {
    backgroundColor: '#FBEAE8', borderRadius: 12, padding: 14,
    marginTop: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  errTxt: { fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.error },
  settingsBtn: {
    backgroundColor: c.navy, borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', marginTop: 6, paddingHorizontal: 12,
  },
  settingsTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 },

  // ── Shared action buttons ───────────────────────────────────────────────
  actions: { gap: 12, marginTop: 24 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, marginTop: 16,
  },
  primaryTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 14, paddingVertical: 15,
  },
  ghostTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 16 },

  // ── Review step ────────────────────────────────────────────────────────
  reviewImageWrap: {
    backgroundColor: c.ink, borderRadius: 16, overflow: 'hidden',
    minHeight: 260, alignItems: 'center', justifyContent: 'center',
  },
  reviewImage: { width: '100%', height: 300 },
  reviewHint: {
    fontFamily: theme.fonts.body, fontSize: 13, color: c.muted,
    textAlign: 'center', marginTop: 10, marginBottom: 16,
  },
  reviewToolbar: {
    flexDirection: 'row', gap: 12, marginBottom: 16,
  },
  toolBtn: {
    flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, borderWidth: 1, borderColor: c.lines,
    borderRadius: 14, backgroundColor: c.surface, minHeight: 64,
  },
  toolBtnDisabled: { opacity: 0.5 },
  toolBtnTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  useScanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: c.navy, borderRadius: 14, paddingVertical: 18,
  },
  useScanTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 17 },

  // ── Processing step ────────────────────────────────────────────────────
  processingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: 32,
  },
  processingSpinner: { marginBottom: 24 },
  processingTitle: {
    fontFamily: theme.fonts.displayBold, fontSize: 20, color: c.ink,
    textAlign: 'center', marginBottom: 28,
  },
  processingSteps: { width: '100%', gap: 16, marginBottom: 24 },
  processingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  processingIconBox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  processingActiveDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: c.navy,
  },
  processingPendingDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: c.lines,
  },
  processingLabel: {
    fontFamily: theme.fonts.body, fontSize: 15, color: c.muted, flex: 1,
  },
  processingDone: { color: c.success },
  processingActive: { color: c.navy, fontFamily: theme.fonts.bodySemiBold },
  processingNote: {
    fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, textAlign: 'center',
  },

  // ── OCR review step ────────────────────────────────────────────────────
  ocrHeaderRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14,
  },
  ocrSubtitle: {
    flex: 1, fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.muted, lineHeight: 20,
  },
  ocrThumb: {
    width: '100%', height: 140, borderRadius: 12, marginBottom: 16,
    backgroundColor: c.surfaceTertiary,
  },
  ocrBlock: {
    borderWidth: 1, borderColor: c.lines, borderRadius: 14,
    backgroundColor: c.surface, padding: 14, marginBottom: 16, gap: 8,
  },
  ocrLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.gold, letterSpacing: 1.2 },
  ocrInput: {
    fontFamily: theme.fonts.body, fontSize: 14, color: c.ink,
    lineHeight: 21, minHeight: 120,
  },
  ocrEditedNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF8E8', borderRadius: 8, padding: 8,
  },
  ocrEditedTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.warning },

  // ── Result shared ──────────────────────────────────────────────────────
  resultThumb: {
    width: '100%', height: 160, borderRadius: 14, marginBottom: 14,
    backgroundColor: c.surfaceTertiary,
  },
  card: { backgroundColor: c.navy, borderRadius: 18, padding: 20, marginTop: 8 },
  cardLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.gold, letterSpacing: 1.2 },
  summary: { fontFamily: theme.fonts.body, fontSize: 17, color: '#fff', lineHeight: 26, marginTop: 10 },
  actionCard: {
    backgroundColor: c.goldMuted, borderRadius: 14, padding: 16,
    marginTop: 14, gap: 8,
  },
  actionCardLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.darkGold, letterSpacing: 1 },
  actionTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.ink, lineHeight: 22 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  toggleTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  extracted: {
    fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21,
    marginTop: 10, backgroundColor: c.surface, borderWidth: 1,
    borderColor: c.lines, borderRadius: 12, padding: 14,
  },
  resultActionRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  secBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1, borderColor: c.lines, borderRadius: 12,
    paddingVertical: 13, backgroundColor: c.surface,
  },
  secBtnSaved: { borderColor: c.success, backgroundColor: c.successSoft },
  secTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  busy: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  busyTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },

  // ── Result — legal ─────────────────────────────────────────────────────
  docTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.navySoft, borderRadius: 20, paddingHorizontal: 12,
    paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 14,
  },
  docTypeBadgeTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.navy },
  sectionBlock: { marginTop: 16, gap: 8 },
  sectionLabel: {
    fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.darkGold, letterSpacing: 1.2,
  },
  sectionText: { fontFamily: theme.fonts.body, fontSize: 15, color: c.ink, lineHeight: 22 },
  factsGrid: {
    borderRadius: 14, borderWidth: 1, borderColor: c.lines,
    backgroundColor: c.surface, overflow: 'hidden',
  },
  factCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  factKey: {
    fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.muted,
    width: 110, flexShrink: 0, paddingTop: 1,
  },
  factValue: { flex: 1, fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.ink, lineHeight: 20 },
  truthNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FFF8E8', borderRadius: 12, padding: 12, marginTop: 14,
  },
  truthNoteConditional: { backgroundColor: '#EAF2FF' },
  truthNoteTxt: {
    flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.warning, lineHeight: 19,
  },
  templateCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.gold, borderRadius: 16, padding: 16, marginTop: 14,
  },
  templateIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center',
  },
  templateTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  templateSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 17 },

  // ── Result — non-legal ─────────────────────────────────────────────────
  nonLegalBadge: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: c.navySoft, borderRadius: 16, padding: 16, marginBottom: 16,
  },
  nonLegalTitle: {
    fontFamily: theme.fonts.bodyBold, fontSize: 17, color: c.navy, lineHeight: 24,
  },
  nonLegalSub: {
    fontFamily: theme.fonts.body, fontSize: 14, color: c.muted,
    lineHeight: 21, marginBottom: 16, marginTop: 4,
  },
});
