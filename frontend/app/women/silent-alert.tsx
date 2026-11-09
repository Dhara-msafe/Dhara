import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Switch } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, type Contact, getSilentAlertEvidencePref, setSilentAlertEvidencePref } from '@/src/women/api';
import { composeAlert } from '@/src/women/helpActions';
import { useEvidenceRecorder } from '@/src/women/EvidenceRecorderProvider';
import { triggerFromSilentAlert, describeEvidenceFailure } from '@/src/women/safetyTriggerCoordinator';
import { OUTBOUND_LIVE, SIMULATED_TEXT } from '@/src/outbound';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

const c = theme.colors;
// Feature flag — toggle UI only shown when env var is true (QA/dev builds).
const SILENT_EVIDENCE_ENABLED = process.env.EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 === 'true';
const message = 'I need help. Please contact me and help me reach safety. If I am in immediate danger, contact emergency services.';

export default function SilentAlert() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { startTriggerRecording, recorderState, recordingOwner } = useEvidenceRecorder();

  const [contacts, setContacts]       = useState<Contact[]>([]);
  const [location, setLocation]       = useState('');
  const [status, setStatus]           = useState('');
  const [busy, setBusy]               = useState(false);
  // Toggle only matters when flag is true; default OFF per spec.
  const [evidenceEnabled, setEvidenceEnabled] = useState(false);
  const request = useRef(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    getCircle()
      .then(list => { if (active) setContacts(list); })
      .catch(() => { if (active) setStatus('Could not load your circle. Open Manage circle to try again.'); });
    if (SILENT_EVIDENCE_ENABLED) {
      getSilentAlertEvidencePref().then(v => { if (active) setEvidenceEnabled(v); });
    }
    return () => { active = false; request.current++; setBusy(false); };
  }, []));

  const toggleEvidence = async (val: boolean) => {
    setEvidenceEnabled(val);
    await setSilentAlertEvidencePref(val);
  };

  const addLocation = async () => {
    const id = ++request.current;
    setBusy(true); setStatus('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Location permission was not granted. You can still prepare a message without it.');
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (request.current !== id) return;
      setLocation(`My location at ${new Date(point.timestamp).toLocaleString()}: https://maps.google.com/?q=${point.coords.latitude},${point.coords.longitude}`);
    } catch (e: any) { if (request.current === id) setStatus(e.message || 'Location unavailable. Continue without location.'); }
    finally { if (request.current === id) setBusy(false); }
  };

  /** Route through SafetyTriggerCoordinator then open SMS composer. */
  const handlePrepareAlert = async (phone: string) => {
    let evidenceNotice = '';
    if (SILENT_EVIDENCE_ENABLED && evidenceEnabled) {
      const scope = user?.id || 'device';
      // Coordinator handles flag gate + audit logging
      const result = await triggerFromSilentAlert({
        scope,
        startEvidenceRecording: startTriggerRecording,
      });
      if (!result.flagOff && !result.evidenceStarted) {
        // Captured, not shown yet — composeAlert()'s own status below would
        // otherwise silently overwrite this the moment it resolves.
        evidenceNotice = describeEvidenceFailure(result.evidenceFailureReason) + ' ';
      }
    }
    const composeStatus = await composeAlert(phone, body);
    setStatus(evidenceNotice ? `${evidenceNotice}${composeStatus}` : composeStatus);
  };

  const body = `${message}${location ? `\n${location}` : ''}`;
  // Only contacts marked for notifications AND holding a usable number can be
  // messaged — a row with no number would open an empty composer.
  const notifyContacts = contacts.filter(ct => ct.notify !== false && !!ct.phone?.trim());
  const notifyWithoutPhone = contacts.filter(ct => ct.notify !== false && !ct.phone?.trim()).length;
  const isRecordingActive = recorderState.isRecording && recordingOwner === 'trigger';

  return (
    <View style={styles.root} testID="silent-alert-screen">
      <ScreenHeader title="Silent alert" subtitle="Prepare a message · you choose when to send" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="silent-alert-disclosure" style={styles.note}>{OUTBOUND_LIVE ? 'This opens your SMS app with the message ready — you read it and press Send yourself, one person at a time. DHARA never sends anything by itself, and delivery is not confirmed. SMS service may be required, and either phone may make a sound; DHARA cannot guarantee silence.' : `QA mode — ${SIMULATED_TEXT}. Your SMS app will not open and no alert will leave this device.`}</Text>
        <Text testID="silent-alert-message" selectable style={styles.message}>{body}</Text>
        <Pressable testID="alert-add-location" style={styles.button} disabled={busy} onPress={addLocation}>{busy ? <ActivityIndicator color={c.onBrandPrimary} /> : <Text style={styles.buttonText}>{location ? 'Update location (optional)' : 'Add my location (optional)'}</Text>}</Pressable>
        {(!!location || busy) && <Pressable testID="alert-remove-location" style={styles.secondary} onPress={() => { request.current++; setBusy(false); setLocation(''); }}><Text style={styles.label}>{busy ? 'Continue without location' : 'Remove location'}</Text></Pressable>}

        {/* Evidence toggle — only shown when EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1=true */}
        {SILENT_EVIDENCE_ENABLED && (
          <View style={styles.toggleCard}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Also start Evidence Recording</Text>
                <Text style={styles.toggleSub}>Records audio the moment you prepare an alert — stored privately on this device</Text>
              </View>
              <Switch
                testID="evidence-toggle"
                value={evidenceEnabled}
                onValueChange={toggleEvidence}
                trackColor={{ false: c.lines, true: c.navy }}
                thumbColor="#fff"
              />
            </View>
            {isRecordingActive && (
              <View style={styles.recordingBadge}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>Evidence recording is active</Text>
              </View>
            )}
            {evidenceEnabled && !isRecordingActive && (
              <View style={styles.evidenceTip}>
                <Ionicons name="shield-checkmark-outline" size={14} color={c.navy} />
                <Text style={styles.evidenceTipText}>Recording starts when you tap Prepare SMS below</Text>
              </View>
            )}
          </View>
        )}

        {contacts.length === 0 && (
          <View style={styles.emptyCard} testID="alert-no-contacts">
            <Text style={styles.note}>No trusted contacts saved yet. Add someone in your trusted circle, or copy this message and send it yourself.</Text>
            <Pressable testID="alert-empty-manage-circle" style={styles.button} onPress={() => router.push('/women/trusted-circle')}>
              <Text style={styles.buttonText}>Manage circle</Text>
            </Pressable>
          </View>
        )}
        {contacts.length > 0 && notifyContacts.length === 0 && (
          <View style={styles.emptyCard} testID="alert-no-notify-contacts">
            <Text style={styles.note}>
              {notifyWithoutPhone > 0
                ? 'Your contacts for Silent alert have no phone number saved. Add a number in your trusted circle so a message can be prepared.'
                : 'All your contacts are set to "Call only". Open your trusted circle and tap the bell to enable one for Silent alert.'}
            </Text>
            <Pressable testID="alert-empty-manage-circle" style={styles.button} onPress={() => router.push('/women/trusted-circle')}>
              <Text style={styles.buttonText}>Manage circle</Text>
            </Pressable>
          </View>
        )}
        {notifyContacts.map(contact => (
          <Pressable key={contact.id} testID={`alert-contact-${contact.id}`} style={styles.secondary} onPress={() => handlePrepareAlert(contact.phone)}>
            <View style={styles.contactRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Prepare SMS to {contact.name}</Text>
                <Text style={styles.note}>{contact.phone}</Text>
              </View>
              {SILENT_EVIDENCE_ENABLED && evidenceEnabled && (
                <View style={styles.evidenceChip}>
                  <Ionicons name="mic-outline" size={12} color={c.navy} />
                  <Text style={styles.evidenceChipText}>+ Record</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}
        <Pressable testID="alert-copy-message" style={styles.secondary} onPress={async () => { try { await Clipboard.setStringAsync(body); setStatus('Message copied. No alert has been sent.'); } catch { setStatus('Copy unavailable. Select the message text to copy it.'); } }}><Text style={styles.label}>Copy message</Text></Pressable>
        <Pressable testID="alert-manage-circle" style={styles.secondary} onPress={() => router.push('/women/trusted-circle')}><Text style={styles.label}>Manage trusted circle</Text></Pressable>
        {!!status && <Text testID="silent-alert-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 18 },
  note:    { fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 23, color: c.muted },
  message: { padding: 18, backgroundColor: c.surface, borderRadius: 14, fontFamily: theme.fonts.body, fontSize: 16, lineHeight: 24, color: c.ink },
  button:  { padding: 16, minHeight: 52, borderRadius: 14, backgroundColor: c.navy, alignItems: 'center' },
  buttonText: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.onBrandPrimary },
  secondary:  { padding: 16, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: c.lines, backgroundColor: c.surface },
  emptyCard:  { gap: 14 },
  label:      { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.navy },
  // Toggle card
  toggleCard:    { borderRadius: 16, borderWidth: 1, borderColor: c.lines, backgroundColor: c.surface, overflow: 'hidden' },
  toggleRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  toggleLabel:   { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink, marginBottom: 3 },
  toggleSub:     { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 18 },
  recordingBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  recordingDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  recordingText:  { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: '#ef4444' },
  evidenceTip:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  evidenceTipText: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 18 },
  contactRow:       { flexDirection: 'row', alignItems: 'center' },
  evidenceChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.navySoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  evidenceChipText: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.navy },
});