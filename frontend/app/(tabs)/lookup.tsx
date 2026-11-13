/**
 * Dhara Lookup — eCourts case search tab.
 * Sprint 3: Cascade filter UI + in-app WebView results.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable,
  StyleSheet, Modal, FlatList, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder, RecordingPresets, setAudioModeAsync, AudioModule,
} from 'expo-audio';
import { theme } from '@/src/theme';
import {
  STATES_UTS, DISTRICTS, CNR_STATE_CODES, CNR_COURT_CODES,
} from '@/src/courtData';
import { useAuth, API_BASE } from '@/src/auth';
import { whisperTranscribeFile } from '@/src/voice/stt';
import { parseSpokenCaseRef } from '@/src/voice/spokenCnrParser';
import { claimMic, MIC_BUSY_MESSAGE, withMicLease, type MicLease } from '@/src/voice/micArbiterGuard';

const NAVY  = theme.colors.primary;
const GOLD  = theme.colors.gold;
const CREAM = '#F8F6F0';
const HINT  = '#999999';

type Mode = 'cnr' | 'party';
type PartyType = 'petitioner' | 'respondent';

// ── Searchable sheet picker ───────────────────────────────────────────────────
function SheetPicker({
  visible, title, items, selectedCode, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  items: { code: string; name: string }[];
  selectedCode: string;
  onSelect: (item: { code: string; name: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()))
    : items;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ps.overlay} onPress={onClose}>
        <View style={ps.sheet}>
          <View style={ps.handle} />
          <Text style={ps.title}>{title}</Text>
          <View style={ps.searchBox}>
            <Ionicons name="search-outline" size={16} color={HINT} />
            <TextInput
              style={ps.searchInput}
              placeholder="Type to filter…"
              placeholderTextColor={HINT}
              value={q}
              onChangeText={setQ}
              autoFocus
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={HINT} />
              </Pressable>
            )}
          </View>
          <FlatList
            data={filtered}
            keyExtractor={i => i.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const active = item.code === selectedCode;
              return (
                <Pressable
                  style={[ps.item, active && ps.itemActive]}
                  onPress={() => { setQ(''); onSelect(item); onClose(); }}
                >
                  <Text style={[ps.itemText, active && ps.itemTextActive]}>{item.name}</Text>
                  {active && <Ionicons name="checkmark" size={16} color={NAVY} />}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={ps.empty}>No matches</Text>}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Picker row ────────────────────────────────────────────────────────────────
function PickerRow({
  label, value, placeholder, onPress, disabled,
}: {
  label: string; value: string; placeholder: string;
  onPress: () => void; disabled: boolean;
}) {
  return (
    <View style={styles.filterBlock}>
      <Text style={styles.filterLabel}>{label}</Text>
      <Pressable
        style={[styles.pickerRow, disabled && styles.pickerRowDisabled]}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
      >
        <Text
          style={[styles.pickerText, !value && styles.pickerPlaceholder]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <Ionicons
          name="chevron-down-outline"
          size={16}
          color={disabled ? HINT : NAVY}
        />
      </Pressable>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function LookupScreen() {
  const { token } = useAuth();
  const [mode, setMode] = useState<Mode>('cnr');

  // CNR
  const [cnr, setCnr]           = useState('');
  const [cnrState, setCnrState] = useState('');
  const [cnrCourt, setCnrCourt] = useState('');

  // Voice-assisted CNR entry
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [heardSummary, setHeardSummary] = useState<string | null>(null);
  const micIntroShownRef = useRef(false);
  const webStreamRef = useRef<any>(null);
  const webRecorderRef = useRef<any>(null);
  const micLeaseRef = useRef<MicLease | null>(null);
  const webChunksRef = useRef<any[]>([]);

  // Party
  const [selState,  setSelState]   = useState<{ code: string; name: string } | null>(null);
  const [selDist,   setSelDist]    = useState<{ code: string; name: string } | null>(null);
  const [partyName, setPartyName]  = useState('');
  const [partyType, setPartyType]  = useState<PartyType>('petitioner');
  const [showFilters, setShowFilters] = useState(false);

  // Modals
  const [showState, setShowState] = useState(false);
  const [showDist,  setShowDist]  = useState(false);

  const handleCNR = (text: string) => {
    const v = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16);
    setCnr(v);
    setCnrState(v.length >= 2 ? (CNR_STATE_CODES[v.slice(0, 2)] ?? '') : '');
    setCnrCourt(v.length >= 4 ? (CNR_COURT_CODES[v.slice(2, 4)] ?? '') : '');
  };

  // ── Voice-only CNR entry ────────────────────────────────────────────────
  // Speak the CNR (or just "case number 427 of 2024") — we transcribe, parse
  // the spoken numbers/letters, and fill in whatever was heard. Nothing is
  // fabricated: if only a case number + year were spoken, only those are
  // filled — the user completes the rest by hand.
  const applyTranscript = useCallback((text: string) => {
    if (!text || !text.trim()) {
      setHeardSummary('Did not catch that — please try again or type the CNR.');
      return;
    }
    const parsed = parseSpokenCaseRef(text);
    setHeardSummary(parsed.heardSummary);
    if (!parsed.isEmpty && parsed.bestGuessCnr) {
      handleCNR(parsed.bestGuessCnr);
    }
  }, []);

  const startMicRecording = useCallback(async () => {
    if (!micIntroShownRef.current) {
      micIntroShownRef.current = true;
      Alert.alert(
        'Speak your CNR',
        'Say the CNR, or just the case number and year (e.g. "case number four two seven of twenty twenty-four"). Dhara only records while you speak.',
      );
    }
    setHeardSummary(null);

    if (Platform.OS === 'web') {
      try {
        if (!(navigator as any)?.mediaDevices?.getUserMedia) {
          Alert.alert('Not supported', 'Voice input is not supported in this browser. Please type the CNR.');
          return;
        }
        const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
        webStreamRef.current = stream;
        const WMR = (window as any).MediaRecorder;
        const mimeType = (WMR && WMR.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : 'audio/webm';
        const mr = new WMR(stream, { mimeType });
        webChunksRef.current = [];
        mr.ondataavailable = (e: any) => { if (e.data?.size > 0) webChunksRef.current.push(e.data); };
        const lease = claimMic('lookup_mic', () => { try { mr.stop(); } catch {} setIsRecording(false); });
        if (!lease.ok) { try { stream.getTracks().forEach((t: any) => t.stop()); } catch {} Alert.alert('Microphone busy', MIC_BUSY_MESSAGE); return; }
        micLeaseRef.current = lease;
        mr.start();
        webRecorderRef.current = mr;
        setIsRecording(true);
      } catch {
        Alert.alert('Microphone blocked', 'Click the lock icon next to the address bar to allow microphone access, or type the CNR.');
      }
      return;
    }

    try {
      // P0-A: Check current status first — skip the request dialog when
      // permission is already granted (avoids unnecessary Android dialog
      // backgrounding and repeat prompts).
      let perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted) {
        perm = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert(
            'Microphone permission needed',
            'Microphone access is blocked for Dhara. Open Settings to allow it, or type the CNR instead.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert('Microphone permission', 'Please allow microphone access to speak your CNR.');
        }
        return;
      }
      // BATCH A1: claim the mic lease BEFORE touching the shared audio
      // session — setAudioModeAsync is global and must never run ahead of
      // a lease check, or it can disrupt an active Evidence Locker recording.
      const claimResult = await withMicLease(
        'lookup_mic',
        () => { try { recorder.stop(); } catch {} setIsRecording(false); },
        async () => {
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
          await recorder.prepareToRecordAsync();
        },
      );
      if (!claimResult.ok) { Alert.alert('Microphone busy', MIC_BUSY_MESSAGE); return; }
      micLeaseRef.current = claimResult.lease;
      recorder.record();
      setIsRecording(true);
    } catch (e: any) {
      micLeaseRef.current?.release(); micLeaseRef.current = null;
      Alert.alert('Recording failed', e?.message || 'Could not access the microphone. Please type the CNR.');
    }
  }, [recorder]);

  const stopMicRecording = useCallback(async () => {
    setIsRecording(false);
    setTranscribing(true);

    if (Platform.OS === 'web') {
      const mr = webRecorderRef.current;
      if (!mr) { setTranscribing(false); return; }
      try {
        const audioBlob: Blob = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Recording stop timeout')), 8000);
          mr.onstop = () => {
            clearTimeout(timeout);
            resolve(new Blob(webChunksRef.current, { type: 'audio/webm' }));
          };
          try { mr.stop(); } catch (e) { clearTimeout(timeout); reject(e); }
        });
        try { webStreamRef.current?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
        webRecorderRef.current = null;
        webStreamRef.current = null;
        if (!audioBlob || audioBlob.size === 0) {
          setHeardSummary('No audio captured. Please hold and try again.');
          return;
        }
        const blobUrl = URL.createObjectURL(audioBlob);
        try {
          if (!API_BASE || !token) throw new Error('Voice input is unavailable');
          const result = await whisperTranscribeFile(API_BASE, token, blobUrl, 'en');
          applyTranscript(result?.text || '');
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } catch {
        setHeardSummary('Could not transcribe. Please try again or type the CNR.');
      } finally {
        setTranscribing(false);
        micLeaseRef.current?.release(); micLeaseRef.current = null;
      }
      return;
    }

    try {
      await recorder.stop();
      const uri = recorder.uri;
      // Mic diagnosis fix: distinct sentinel — "nothing captured" is not a
      // transcription failure and never reaches the network.
      if (!uri) throw new Error('__no_recording__');
      if (!API_BASE || !token) throw new Error('Voice input is unavailable');
      const result = await whisperTranscribeFile(API_BASE, token, uri, 'en');
      applyTranscript(result?.text || '');
    } catch (e: any) {
      // Mic diagnosis fix: distinct message per cause. Mirrors
      // src/voice/stt.ts's sttErrorToMessage() mapping for the sentinels
      // whisperTranscribeFile() throws.
      const m = e?.message;
      setHeardSummary(
        m === '__no_recording__'
          ? 'No sound was recorded. Please allow the microphone and try again.'
          : m === '__network_error__'
          ? 'Could not reach DHARA. Check your internet and try again.'
          : (e?.serverMessage || 'Could not transcribe. Please try again or type the CNR.')
      );
    } finally {
      setTranscribing(false);
      micLeaseRef.current?.release(); micLeaseRef.current = null;
    }
  }, [recorder, token, applyTranscript]);

  const onMicPress = useCallback(() => {
    if (transcribing) return;
    if (isRecording) stopMicRecording();
    else startMicRecording();
  }, [isRecording, transcribing, startMicRecording, stopMicRecording]);

  const pickState = (s: { code: string; name: string }) => {
    setSelState(s);
    setSelDist(null);  // reset district
  };

  const clearFilters = () => {
    setSelState(null);
    setSelDist(null);
  };

  const districts = selState ? (DISTRICTS[selState.code] ?? []) : [];

  // State/district are optional refinement only — a party name search
  // works nationwide on its own (backend does not require them).
  const partyCanSearch = partyName.trim().length >= 3;

  const handleSearch = useCallback(() => {
    if (mode === 'cnr') {
      if (cnr.length !== 16) return;
      router.push({
        pathname: '/lookup-results' as any,
        params: { mode: 'cnr', cnr },
      });
    } else {
      if (!partyCanSearch) return;
      router.push({
        pathname: '/lookup-results' as any,
        params: {
          mode: 'party',
          name: partyName.trim(),
          partyType,
          ...(selState ? { stateName: selState.name } : {}),
          ...(selDist ? { districtName: selDist.name } : {}),
        },
      });
    }
  }, [mode, cnr, selState, selDist, partyName, partyType, partyCanSearch]);

  const cnrComplete = cnr.length === 16;
  const canSearch   = mode === 'cnr' ? cnrComplete : partyCanSearch;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Ionicons name="search-outline" size={20} color="#fff" />
          <Text style={styles.headerTitle}>Dhara Lookup</Text>
        </View>
        <Text style={styles.headerSub}>Search Indian court cases via eCourtsIndia</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Mode toggle */}
          <View style={styles.modeRow}>
            {(['cnr', 'party'] as Mode[]).map(m => (
              <Pressable
                key={m}
                style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                onPress={() => { setMode(m); }}
              >
                <Ionicons
                  name={m === 'cnr' ? 'barcode-outline' : 'person-outline'}
                  size={15}
                  color={mode === m ? '#fff' : NAVY}
                />
                <Text style={[styles.modeBtnText, mode === m && { color: '#fff' }]}>
                  {m === 'cnr' ? 'By CNR' : 'By Party Name'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ── CNR MODE ─────────────────────────────────────────── */}
          {mode === 'cnr' && (
            <View style={styles.card}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={cnr}
                  onChangeText={handleCNR}
                  placeholder="CNR — e.g. DLHC010001232024"
                  placeholderTextColor={HINT}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={16}
                  returnKeyType="search"
                  onSubmitEditing={cnrComplete ? handleSearch : undefined}
                />
                {cnr.length > 0 && (
                  <Pressable onPress={() => { setCnr(''); setCnrState(''); setCnrCourt(''); setHeardSummary(null); }} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={HINT} />
                  </Pressable>
                )}
                <Pressable
                  onPress={onMicPress}
                  disabled={transcribing}
                  hitSlop={8}
                  style={[styles.micBtn, isRecording && styles.micBtnActive]}
                  accessibilityLabel={isRecording ? 'Stop recording' : 'Speak your CNR'}
                >
                  {transcribing
                    ? <ActivityIndicator size="small" color={isRecording ? '#fff' : NAVY} />
                    : <Ionicons name={isRecording ? 'stop-circle' : 'mic-outline'} size={20} color={isRecording ? '#fff' : NAVY} />}
                </Pressable>
              </View>

              {(isRecording || transcribing || heardSummary) && (
                <View style={styles.voiceStatusRow}>
                  <Ionicons
                    name={isRecording ? 'radio-outline' : transcribing ? 'sync-outline' : 'chatbubble-ellipses-outline'}
                    size={14}
                    color={NAVY}
                  />
                  <Text style={styles.voiceStatusText}>
                    {isRecording ? 'Listening… tap the mic again to stop.'
                      : transcribing ? 'Transcribing…'
                      : heardSummary}
                  </Text>
                </View>
              )}

              {cnr.length > 0 && (
                <View style={styles.cnrProgress}>
                  <View style={[styles.cnrBar, { width: `${(cnr.length / 16) * 100}%` as any }]} />
                  <Text style={styles.cnrCount}>{cnr.length}/16{cnrComplete ? ' ✓' : ''}</Text>
                </View>
              )}

              {/* B-103: cnrState/cnrCourt are strings (useState('')), not
                  booleans. '' || '' is '' (a string, not false), so the old
                  `(cnrState || cnrCourt) && (...)` rendered the empty string
                  itself as a bare child of this View whenever the CNR field
                  was empty or its first 4 chars didn't resolve to a known
                  state/court code — React Native Web's "Unexpected text
                  node: ." warning/toast (reported on /lookup and persisting
                  visibly into /lookup-results after navigating). Every other
                  conditional in this file already uses an explicit ternary
                  to `null`; this is the one spot that still used `&&`. */}
              {(cnrState || cnrCourt) ? (
                <View style={styles.decodedRow}>
                  {cnrState ? (
                    <View style={styles.decodedChip}>
                      <Ionicons name="location-outline" size={12} color={NAVY} />
                      <Text style={styles.decodedText}>{cnr.slice(0, 2)} → {cnrState}</Text>
                    </View>
                  ) : null}
                  {cnrCourt ? (
                    <View style={styles.decodedChip}>
                      <Ionicons name="business-outline" size={12} color={NAVY} />
                      <Text style={styles.decodedText}>{cnr.slice(2, 4)} → {cnrCourt}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Text style={styles.inputHint}>
                CNR = 16 characters · found on your case notice or the eCourts portal · or tap 🎙 and speak it
              </Text>
            </View>
          )}

          {/* ── PARTY MODE ───────────────────────────────────────── */}
          {mode === 'party' && (
            <View style={styles.card}>
              {/* Party name — always enabled, this is the only required field */}
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Party Name * (min 3 chars)</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={partyName}
                    onChangeText={setPartyName}
                    placeholder="Enter petitioner or respondent name"
                    placeholderTextColor={HINT}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={partyCanSearch ? handleSearch : undefined}
                  />
                  {partyName.length > 0 && (
                    <Pressable onPress={() => setPartyName('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={HINT} />
                    </Pressable>
                  )}
                </View>
                <Text style={styles.inputHint}>
                  Searches all-India by name. Add optional filters below to narrow the results.
                </Text>
              </View>

              {/* Party type toggle */}
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Party Type</Text>
                <View style={styles.toggleRow}>
                  {(['petitioner', 'respondent'] as PartyType[]).map(pt => (
                    <Pressable
                      key={pt}
                      style={[styles.toggleBtn, partyType === pt && styles.toggleBtnActive]}
                      onPress={() => setPartyType(pt)}
                    >
                      <Text style={[styles.toggleText, partyType === pt && styles.toggleTextActive]}>
                        {pt.charAt(0).toUpperCase() + pt.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* ── Optional filters: State / District ──────────────── */}
              <View style={styles.filtersDivider} />
              <Pressable style={styles.filtersToggleRow} onPress={() => setShowFilters(v => !v)}>
                <View style={styles.filtersToggleLeft}>
                  <Ionicons name="options-outline" size={16} color={NAVY} />
                  <Text style={styles.filtersToggleLabel}>Filters (optional)</Text>
                  {(selState || selDist) && (
                    <View style={styles.filtersBadge}>
                      <Text style={styles.filtersBadgeText}>
                        {[selState?.name, selDist?.name].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                  )}
                </View>
                <Ionicons
                  name={showFilters ? 'chevron-up-outline' : 'chevron-down-outline'}
                  size={18}
                  color={NAVY}
                />
              </Pressable>

              {showFilters && (
                <View style={styles.filtersBody}>
                  <PickerRow
                    label="State / Union Territory"
                    value={selState?.name ?? ''}
                    placeholder="Any state (nationwide)"
                    onPress={() => setShowState(true)}
                    disabled={false}
                  />
                  <PickerRow
                    label="District"
                    value={selDist?.name ?? ''}
                    placeholder={selState ? 'Any district' : 'Select a State first'}
                    onPress={() => setShowDist(true)}
                    disabled={!selState}
                  />
                  {(selState || selDist) && (
                    <Pressable style={styles.clearFiltersBtn} onPress={clearFilters}>
                      <Ionicons name="close-circle-outline" size={14} color="#DC2626" />
                      <Text style={styles.clearFiltersText}>Clear filters</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Search button */}
          <Pressable
            style={[styles.searchBtn, !canSearch && styles.searchBtnDisabled]}
            onPress={handleSearch}
            disabled={!canSearch}
          >
            <Ionicons name="search" size={16} color="#fff" />
            <Text style={styles.searchBtnText}>Search eCourts</Text>
          </Pressable>

          {/* Hint */}
          {mode === 'party' && partyName.trim().length === 0 && (
            <View style={styles.hintCard}>
              <Ionicons name="information-circle-outline" size={18} color={NAVY} />
              <Text style={styles.hintText}>
                Type a name and tap Search — results open inside DHARA. Use Filters to narrow by state/district.
              </Text>
            </View>
          )}

          {mode === 'cnr' && !cnr && (
            <View style={styles.hintCard}>
              <Ionicons name="barcode-outline" size={18} color={NAVY} />
              <Text style={styles.hintText}>
                Your 16-character CNR is on any court notice, vakalatnama, or the eCourts portal.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Pickers */}
      <SheetPicker
        visible={showState}
        title="Select State / UT"
        items={STATES_UTS}
        selectedCode={selState?.code ?? ''}
        onSelect={pickState}
        onClose={() => setShowState(false)}
      />
      <SheetPicker
        visible={showDist}
        title="Select District"
        items={districts}
        selectedCode={selDist?.code ?? ''}
        onSelect={d => setSelDist(d)}
        onClose={() => setShowDist(false)}
      />
    </SafeAreaView>
  );
}

const ps = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingHorizontal: 20, paddingBottom: 30 },
  handle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginVertical: 12 },
  title:   { fontSize: 16, fontWeight: '700', color: NAVY, marginBottom: 10 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, color: '#1F2937' },
  item:     { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemActive: { backgroundColor: '#FEF9EC' },
  itemText: { fontSize: 14, color: '#374151', flex: 1 },
  itemTextActive: { color: NAVY, fontWeight: '700' },
  empty:  { paddingVertical: 20, textAlign: 'center', color: HINT },
});

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: CREAM },
  header: { backgroundColor: NAVY, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(211,182,117,0.25)' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 13, color: GOLD, fontWeight: '500' },
  scroll:  { flex: 1 },
  scrollContent: { padding: 16, gap: 14, paddingBottom: 48 },

  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: NAVY, backgroundColor: '#fff' },
  modeBtnActive: { backgroundColor: NAVY },
  modeBtnText: { fontSize: 14, fontWeight: '700', color: NAVY },

  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: NAVY + '33', padding: 16, gap: 14 },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingBottom: 8 },
  inputDisabled: { opacity: 0.45 },
  input: { fontSize: 15, color: '#1F2937', minHeight: 28 },

  cnrProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cnrBar:  { height: 3, borderRadius: 2, backgroundColor: NAVY },
  cnrCount: { fontSize: 11, color: NAVY, fontWeight: '700' },

  micBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3EFE7' },
  micBtnActive: { backgroundColor: '#DC2626' },
  voiceStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EEF2FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  voiceStatusText: { flex: 1, fontSize: 12.5, color: NAVY, lineHeight: 17 },

  decodedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  decodedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  decodedText: { fontSize: 12, color: NAVY, fontWeight: '600' },

  inputHint: { fontSize: 12, color: HINT, lineHeight: 16 },

  filterBlock: { gap: 5 },
  filterLabel: { fontSize: 12, fontWeight: '700', color: NAVY, letterSpacing: 0.2 },

  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: NAVY, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#fff' },
  pickerRowDisabled: { borderColor: '#D1D5DB', opacity: 0.5 },
  pickerText: { fontSize: 14, color: '#1F2937', flex: 1 },
  pickerPlaceholder: { color: HINT },

  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, borderWidth: 1.5, borderColor: NAVY, backgroundColor: '#fff' },
  toggleBtnActive: { backgroundColor: NAVY },
  toggleText: { fontSize: 14, fontWeight: '700', color: NAVY },
  toggleTextActive: { color: '#fff' },

  searchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: GOLD, paddingVertical: 14, borderRadius: 10 },
  searchBtnDisabled: { backgroundColor: '#D1D5DB' },
  searchBtnText: { color: NAVY, fontSize: 15, fontWeight: '800' },

  hintCard: { flexDirection: 'row', gap: 10, backgroundColor: '#EEF2FF', borderRadius: 10, padding: 14, alignItems: 'flex-start' },
  hintText: { flex: 1, fontSize: 13, color: NAVY, lineHeight: 19 },

  filtersDivider: { height: 1, backgroundColor: '#F0EDE4', marginVertical: 2 },
  filtersToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  filtersToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' },
  filtersToggleLabel: { fontSize: 13, fontWeight: '700', color: NAVY },
  filtersBadge: { backgroundColor: '#EEF2FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  filtersBadgeText: { fontSize: 11, color: NAVY, fontWeight: '600' },
  filtersBody: { gap: 12, marginTop: 4 },
  clearFiltersBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 4 },
  clearFiltersText: { fontSize: 12.5, color: '#DC2626', fontWeight: '700' },
});
