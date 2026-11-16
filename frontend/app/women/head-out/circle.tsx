/**
 * Head Out wizard — Step 3: Trusted Circle & Rules.
 *
 * Lets the user pick up to 3 already-linked Trusted Circle members (the
 * authenticated, accept/decline in-app system — trustedCircle/api.ts, not
 * the separate local-device contacts used by Silent Alert's SMS) to notify
 * for this journey, edit what each selected person receives, set the
 * check-in duration, and start the journey.
 *
 * PERMISSIONS SCOPE — read this before changing the toggle copy below.
 * These 3 toggles edit a person's STANDING permissions (updateLinkPermissions,
 * same fields inviteContact() sets once at invite time) — there is no
 * per-journey override layer in the backend, so a change here affects every
 * future journey with that person, not just the one being set up right now.
 * The UI says so explicitly ("from now on") rather than implying it's
 * scoped to this journey, which the original design's layout could be read
 * to suggest.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Switch, Image, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useAuth } from '@/src/auth';
import { useHeadOutWizard } from '@/src/women/headOutWizardStore';
import {
  listAcceptedRecipients, listInvitations, updateLinkPermissions, getPhotoViewToken,
  type InviteLink, type Permissions,
} from '@/src/trustedCircle/api';

const c = theme.colors;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Must match head-out.tsx's own SESSION_KEY exactly — that screen (not this
// one) owns reading/rendering the active session; this screen only writes it.
const SESSION_KEY = 'ws_head_out_session';

const TRUSTED_CIRCLE_RECIPIENT = process.env.EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT === 'true';
const GO1B_GPS_ENABLED = process.env.EXPO_PUBLIC_GO1B_GPS === 'true';
const RECIPIENTS_ENABLED = TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED;
const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
const MAX_RECIPIENTS = 3;

const DURATIONS = [
  { label: '30 min', mins: 30 },
  { label: '1 hour', mins: 60 },
  { label: '2 hours', mins: 120 },
  { label: '4 hours', mins: 240 },
];

/** "Remind me before alerting" — a push to the OWNER only, handled by
 * deadline_worker.py's _run_reminders. Never touches the trusted circle. */
const REMIND_OPTIONS: { label: string; mins: number | null }[] = [
  { label: 'No reminder', mins: null },
  { label: '5 minutes', mins: 5 },
  { label: '10 minutes', mins: 10 },
  { label: '15 minutes', mins: 15 },
];

/** "If I don't respond" — whether a missed check-in actually escalates to
 * the trusted circle. Both options keep the server-side deadline tracking;
 * "Do nothing" only suppresses the circle notification (auto_notify_on_no_response). */
const RESPONSE_OPTIONS: { label: string; value: boolean }[] = [
  { label: 'Notify my circle', value: true },
  { label: 'Do nothing', value: false },
];

type ToggleKey = 'journey' | 'missed' | 'emergency';
const TOGGLE_DEFS: { key: ToggleKey; label: string; sub: string; icon: IconName }[] = [
  { key: 'journey', label: 'Journey start & live location', sub: 'while journey is active', icon: 'navigate-outline' },
  { key: 'missed', label: 'Late arrival alert', sub: 'if no response', icon: 'warning-outline' },
  { key: 'emergency', label: 'Emergency alert (SOS)', sub: 'with location', icon: 'alert-circle-outline' },
];

/** 3 UI toggles stand in for 5 real permission fields — "Journey start &
 * live location" bundles journey_status + temp_location + expected_arrival
 * (there's no dedicated 4th toggle for arrival confirmation, so it travels
 * with the journey-visibility group rather than being silently dropped). */
function toggleValue(perm: Permissions, key: ToggleKey): boolean {
  if (key === 'journey') return !!(perm.journey_status || perm.temp_location);
  if (key === 'missed') return !!perm.missed_checkin;
  return !!perm.emergency_requests;
}
function patchForToggle(key: ToggleKey, value: boolean): Partial<Permissions> {
  if (key === 'journey') return { journey_status: value, temp_location: value, expected_arrival: value };
  if (key === 'missed') return { missed_checkin: value };
  return { emergency_requests: value };
}

export default function TrustedCircleAndRules() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token: authToken } = useAuth();

  const draft = useHeadOutWizard(s => s.destination);
  const selectedRecipientIds = useHeadOutWizard(s => s.selectedRecipientIds);
  const setSelectedRecipientIds = useHeadOutWizard(s => s.setSelectedRecipientIds);
  const resetWizard = useHeadOutWizard(s => s.reset);

  const [accepted, setAccepted] = useState<InviteLink[]>([]);
  const [pending, setPending] = useState<InviteLink[]>([]);
  const [loadingCircle, setLoadingCircle] = useState(false);
  const [durationMins, setDurationMins] = useState(60);
  const [remindBeforeMins, setRemindBeforeMins] = useState<number | null>(5);
  const [autoNotifyOnNoResponse, setAutoNotifyOnNoResponse] = useState(true);
  const [openPicker, setOpenPicker] = useState<'remind' | 'response' | null>(null);
  const [starting, setStarting] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [pendingToggleKey, setPendingToggleKey] = useState<string | null>(null); // `${linkId}:${toggleKey}`

  const [photoToken, setPhotoToken] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  // Collapsed by default — these toggle blocks are unconditionally AVAILABLE
  // (not gated on selection, see PERMISSIONS SCOPE note), but showing all of
  // them fully expanded for every confirmed person made this screen very
  // dense with 2+ people. Auto-expand a newly-SELECTED person once (so
  // picking someone for this trip surfaces their settings without an extra
  // tap), but let the user collapse it back down if they want.
  const [expandedToggles, setExpandedToggles] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadCircle = useCallback(() => {
    if (!RECIPIENTS_ENABLED || !authToken) return;
    setLoadingCircle(true);
    Promise.all([
      listAcceptedRecipients(authToken),
      listInvitations(authToken, 'sent'),
      getPhotoViewToken(authToken),
    ])
      .then(([acceptedList, sentList, token]) => {
        if (!mountedRef.current) return;
        setAccepted(acceptedList);
        setPending(sentList.filter(l => l.status === 'pending'));
        setPhotoToken(token);
      })
      .finally(() => { if (mountedRef.current) setLoadingCircle(false); });
  }, [authToken]);

  // Refresh every time this screen regains focus — e.g. returning from
  // "Manage trusted circle" after sending a new invite.
  useFocusEffect(useCallback(() => { loadCircle(); }, [loadCircle]));

  const canSelectMore = selectedRecipientIds.length < MAX_RECIPIENTS;

  const toggleRecipient = useCallback((id: string) => {
    const isSel = selectedRecipientIds.includes(id);
    if (!isSel && !canSelectMore) return; // at the cap — ignore new selections
    if (!isSel) setExpandedToggles(cur => ({ ...cur, [id]: true }));
    setSelectedRecipientIds(
      isSel ? selectedRecipientIds.filter(x => x !== id) : [...selectedRecipientIds, id],
    );
  }, [selectedRecipientIds, canSelectMore, setSelectedRecipientIds]);

  const handleTogglePermission = useCallback(async (link: InviteLink, key: ToggleKey, value: boolean) => {
    if (!authToken) return;
    const comboKey = `${link.id}:${key}`;
    setPendingToggleKey(comboKey);
    setPermissionError(null);
    const previous = link.permissions;
    const optimistic = { ...previous, ...patchForToggle(key, value) };
    // Optimistic update so the switch responds instantly.
    setAccepted(cur => cur.map(l => l.id === link.id ? { ...l, permissions: optimistic } : l));
    try {
      const saved = await updateLinkPermissions(authToken, link.id, patchForToggle(key, value));
      if (!mountedRef.current) return;
      setAccepted(cur => cur.map(l => l.id === link.id ? { ...l, permissions: saved } : l));
    } catch {
      if (!mountedRef.current) return;
      // Roll back — the toggle must never show a state that isn't really saved.
      setAccepted(cur => cur.map(l => l.id === link.id ? { ...l, permissions: previous } : l));
      setPermissionError(`Could not update ${link.contact_name}'s settings. Please try again.`);
    } finally {
      if (mountedRef.current) setPendingToggleKey(null);
    }
  }, [authToken]);

  const handleStartJourney = useCallback(async () => {
    if (!draft.label.trim() || starting) return;
    setStarting(true);
    const session = {
      destination: draft.label.trim(),
      startTime: Date.now(),
      durationMins,
      radiusMeters: draft.radiusMeters,
      savedPlaceId: draft.savedPlaceId,
      latitude: draft.latitude ?? null,
      longitude: draft.longitude ?? null,
      ...(RECIPIENTS_ENABLED && { recipientLinkIds: selectedRecipientIds }),
      remindBeforeMins,
      autoNotifyOnNoResponse,
    };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session)).catch(() => {});
    // head-out.tsx picks this session up on mount and creates its journey
    // record itself (see the journey-recovery effect added there) — this
    // screen doesn't need to call the journey API directly.
    resetWizard();
    router.replace('/women/head-out');
  }, [draft, durationMins, remindBeforeMins, autoNotifyOnNoResponse, selectedRecipientIds, starting, resetWizard, router]);

  const photoUri = (ownerId: string | null) =>
    ownerId && photoToken ? `${API_BASE}/api/profile/photo/${ownerId}?token=${encodeURIComponent(photoToken)}` : null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Trusted Circle & Rules" subtitle="Step 3 of 3" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}>

        {RECIPIENTS_ENABLED && (
          <>
            <Text style={styles.fieldLabel}>Select who to notify</Text>
            <Text style={styles.sectionNote}>Select up to {MAX_RECIPIENTS} people. They&apos;ll be notified based on their current settings below.</Text>
            {loadingCircle && <ActivityIndicator size="small" color={c.muted} style={{ marginVertical: 10 }} />}

            {!loadingCircle && accepted.length === 0 && pending.length === 0 && (
              <View style={styles.emptyCard}>
                <Ionicons name="people-outline" size={20} color={c.darkGold} />
                <Text style={styles.emptyTxt}>Your trusted circle is empty. Add people so DHARA can notify them during this journey.</Text>
              </View>
            )}

            {accepted.map(link => {
              const sel = selectedRecipientIds.includes(link.id);
              const uri = !failedPhotos[link.id] ? photoUri(link.invitee_user_id) : null;
              return (
                <View key={link.id} style={[styles.personCard, sel && styles.personCardActive]}>
                  <Pressable
                    testID={`headout-circle-${link.id}`}
                    style={styles.personRow}
                    onPress={() => toggleRecipient(link.id)}
                    disabled={!sel && !canSelectMore}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel, disabled: !sel && !canSelectMore }}
                  >
                    <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={20} color={sel ? c.navy : (canSelectMore ? c.muted : c.lines)} />
                    {uri ? (
                      <Image source={{ uri }} style={styles.avatar} onError={() => setFailedPhotos(f => ({ ...f, [link.id]: true }))} />
                    ) : (
                      <View style={styles.avatarFallback}><Ionicons name="person" size={16} color={c.muted} /></View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={styles.personNameRow}>
                        <Text style={styles.personName}>{link.contact_name}</Text>
                        {!!link.relationship && <Text style={styles.personRelationship}>{link.relationship}</Text>}
                        <View style={styles.confirmedPill}><Text style={styles.confirmedPillTxt}>Confirmed</Text></View>
                      </View>
                    </View>
                  </Pressable>

                  {/* Unconditionally AVAILABLE — NOT gated on `sel`. These are standing
                      permissions on the person (see PERMISSIONS SCOPE note at the top of
                      this file), independent of whether they're picked for THIS journey's
                      notify list, so hiding them entirely behind the checkbox would wrongly
                      imply they're journey-scoped. Collapsed by default to keep the screen
                      readable with multiple people — expanding is just a display choice,
                      not a permission gate. */}
                  <Pressable
                    testID={`headout-toggles-expand-${link.id}`}
                    style={styles.togglesSummaryRow}
                    onPress={() => setExpandedToggles(cur => ({ ...cur, [link.id]: !cur[link.id] }))}
                    accessibilityRole="button"
                    accessibilityLabel={`${expandedToggles[link.id] ? 'Hide' : 'Show'} what ${link.contact_name} receives`}
                  >
                    <Text style={styles.togglesSummaryTxt}>What {link.contact_name.split(' ')[0]} receives from now on</Text>
                    <Ionicons name={expandedToggles[link.id] ? 'chevron-up' : 'chevron-down'} size={16} color={c.muted} />
                  </Pressable>

                  {expandedToggles[link.id] && (
                    <View style={styles.togglesBlock}>
                      {TOGGLE_DEFS.map(t => {
                        const comboKey = `${link.id}:${t.key}`;
                        return (
                          <View key={t.key} style={styles.toggleRow}>
                            <Ionicons name={t.icon} size={16} color={c.muted} style={{ marginTop: 1 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.toggleLabel}>{t.label}</Text>
                              <Text style={styles.toggleSub}>{t.sub}</Text>
                            </View>
                            {pendingToggleKey === comboKey
                              ? <ActivityIndicator size="small" color={c.muted} />
                              : (
                                <Switch
                                  testID={`headout-toggle-${link.id}-${t.key}`}
                                  accessibilityLabel={`${t.label} for ${link.contact_name}`}
                                  value={toggleValue(link.permissions, t.key)}
                                  onValueChange={(v) => handleTogglePermission(link, t.key, v)}
                                  trackColor={{ false: c.lines, true: c.navy }}
                                  thumbColor="#fff"
                                />
                              )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}

            {pending.map(link => (
              <View key={link.id} style={[styles.personRow, styles.personRowPending]} testID={`headout-circle-pending-${link.id}`}>
                <Ionicons name="square-outline" size={20} color={c.muted} />
                <View style={styles.avatarFallback}><Ionicons name="person" size={16} color={c.muted} /></View>
                <View style={{ flex: 1 }}>
                  <View style={styles.personNameRow}>
                    <Text style={[styles.personName, { color: c.muted }]}>{link.contact_name}</Text>
                    {!!link.relationship && <Text style={styles.personRelationship}>{link.relationship}</Text>}
                    <View style={styles.pendingPill}><Text style={styles.pendingPillTxt}>Pending</Text></View>
                  </View>
                  <Text style={styles.personMeta}>{"Hasn't accepted your invite yet"}</Text>
                </View>
              </View>
            ))}

            {!canSelectMore && (
              <Text style={styles.capNote}>You&apos;ve selected {MAX_RECIPIENTS} people — the most for one journey.</Text>
            )}

            {!!permissionError && (
              <View style={styles.errorBox}>
                <Ionicons name="warning-outline" size={14} color={c.emergencyRed} />
                <Text style={styles.errorTxt}>{permissionError}</Text>
              </View>
            )}

            <Pressable
              testID="headout-manage-circle"
              style={styles.manageRow}
              onPress={() => router.push('/women/trusted-circle')}
              accessibilityRole="button"
              accessibilityLabel="Add or manage trusted circle members"
            >
              <Ionicons name="add-circle-outline" size={20} color={c.darkGold} />
              <Text style={styles.manageTxt}>Add another person</Text>
            </Pressable>
          </>
        )}

        <Text style={styles.fieldLabel}>Check-in settings</Text>
        <Text style={styles.sectionNote}>How long until your check-in timer runs out.</Text>
        <View style={styles.durationRow}>
          {DURATIONS.map(d => (
            <Pressable
              key={d.mins}
              testID={`headout-circle-dur-${d.mins}`}
              style={[styles.durChip, durationMins === d.mins && styles.durChipActive]}
              onPress={() => setDurationMins(d.mins)}
              accessibilityRole="radio"
              accessibilityState={{ checked: durationMins === d.mins }}
            >
              <Text style={[styles.durTxt, durationMins === d.mins && styles.durTxtActive]}>{d.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          testID="headout-circle-remind-picker"
          style={styles.optionRow}
          onPress={() => setOpenPicker('remind')}
          accessibilityRole="button"
          accessibilityLabel="Remind me before alerting"
        >
          <Text style={styles.optionLabel}>Remind me before alerting</Text>
          <View style={styles.optionValuePill}>
            <Text style={styles.optionValueTxt}>{REMIND_OPTIONS.find(o => o.mins === remindBeforeMins)?.label ?? 'No reminder'}</Text>
            <Ionicons name="chevron-down" size={14} color={c.navy} />
          </View>
        </Pressable>

        {RECIPIENTS_ENABLED && (
          <Pressable
            testID="headout-circle-response-picker"
            style={styles.optionRow}
            onPress={() => setOpenPicker('response')}
            accessibilityRole="button"
            accessibilityLabel="If I don't respond"
          >
            <Text style={styles.optionLabel}>{"If I don't respond"}</Text>
            <View style={styles.optionValuePill}>
              <Text style={styles.optionValueTxt}>{RESPONSE_OPTIONS.find(o => o.value === autoNotifyOnNoResponse)?.label}</Text>
              <Ionicons name="chevron-down" size={14} color={c.navy} />
            </View>
          </Pressable>
        )}

        <View style={styles.disclosure}>
          <Ionicons name="information-circle-outline" size={15} color={c.muted} />
          <Text style={styles.disclosureTxt}>
            {RECIPIENTS_ENABLED && autoNotifyOnNoResponse
              ? "When this timer runs out, DHARA automatically alerts your selected trusted circle members (the ones with \"Emergency alert\" or \"Late arrival alert\" turned on above) — this is the only thing above that can send something without you tapping anything else first."
              : 'When this timer runs out, DHARA will prompt you to prepare an alert for your trusted circle — it never sends anything automatically.'}
            {' '}Nothing above has been sent yet either.
          </Text>
        </View>

      </ScrollView>

      <Modal visible={!!openPicker} transparent animationType="fade" onRequestClose={() => setOpenPicker(null)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setOpenPicker(null)}>
          <View style={styles.pickerSheet} testID="headout-circle-picker-sheet">
            <Text style={styles.pickerTitle}>
              {openPicker === 'remind' ? 'Remind me before alerting' : "If I don't respond"}
            </Text>
            {(openPicker === 'remind' ? REMIND_OPTIONS : RESPONSE_OPTIONS).map((opt: any) => {
              const selected = openPicker === 'remind' ? opt.mins === remindBeforeMins : opt.value === autoNotifyOnNoResponse;
              return (
                <Pressable
                  key={opt.label}
                  testID={`headout-circle-picker-opt-${opt.label.replace(/\s+/g, '-').toLowerCase()}`}
                  style={styles.pickerOption}
                  onPress={() => {
                    if (openPicker === 'remind') setRemindBeforeMins(opt.mins);
                    else setAutoNotifyOnNoResponse(opt.value);
                    setOpenPicker(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                >
                  <Text style={[styles.pickerOptionTxt, selected && styles.pickerOptionTxtSelected]}>{opt.label}</Text>
                  {selected && <Ionicons name="checkmark" size={18} color={c.navy} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable
          testID="headout-start-journey"
          style={[styles.startBtn, starting && styles.startBtnDisabled]}
          disabled={starting}
          onPress={handleStartJourney}
          accessibilityRole="button"
          accessibilityLabel="Start journey"
        >
          {starting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.startBtnTxt}>Start journey</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 4 },
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 4, marginTop: 16 },
  sectionNote: { fontFamily: theme.fonts.body, fontSize: 12.5, color: c.muted, marginBottom: 10 },
  emptyCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: c.goldMuted, borderWidth: 1, borderColor: c.goldSoft,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  emptyTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 19 },
  personCard: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, marginBottom: 8, overflow: 'hidden',
  },
  personCardActive: { borderColor: c.navy },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  personRowPending: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, padding: 12, marginBottom: 8, opacity: 0.75,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.navySoft },
  avatarFallback: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: c.navySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  personNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  personName: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink },
  personRelationship: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  personMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  confirmedPill: { backgroundColor: c.verifiedGreen, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  confirmedPillTxt: { color: '#fff', fontSize: 10.5, fontFamily: theme.fonts.bodyBold },
  pendingPill: { backgroundColor: c.goldSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pendingPillTxt: { color: c.darkGold, fontSize: 10.5, fontFamily: theme.fonts.bodyBold },
  togglesSummaryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: c.lines, paddingHorizontal: 12, paddingVertical: 10,
  },
  togglesSummaryTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12.5, color: c.navy },
  togglesBlock: {
    borderTopWidth: 1, borderTopColor: c.lines, backgroundColor: c.navySoft,
    paddingHorizontal: 12, paddingVertical: 10, gap: 10,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  toggleLabel: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },
  toggleSub: { fontFamily: theme.fonts.body, fontSize: 11.5, color: c.muted, marginTop: 1 },
  capNote: { fontFamily: theme.fonts.body, fontSize: 12, color: c.darkGold, fontStyle: 'italic', marginBottom: 8 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca',
    borderRadius: 10, padding: 10, marginBottom: 8,
  },
  errorTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.emergencyRed },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  manageTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.darkGold },
  durationRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  durChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface,
  },
  durChipActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  durTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
  durTxtActive: { color: c.navy },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.lines,
  },
  optionLabel: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink, flex: 1, paddingRight: 10 },
  optionValuePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: c.lines, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  optionValueTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(14,39,64,0.45)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  pickerTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink, marginBottom: 12 },
  pickerOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.lines,
  },
  pickerOptionTxt: { fontFamily: theme.fonts.body, fontSize: 15, color: c.ink },
  pickerOptionTxtSelected: { fontFamily: theme.fonts.bodyBold, color: c.navy },
  disclosure: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: c.surface, borderRadius: 10, borderWidth: 1,
    borderColor: c.lines, padding: 10, marginTop: 14,
  },
  disclosureTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, flex: 1, lineHeight: 18 },
  footer: {
    paddingHorizontal: 20, paddingTop: 12, backgroundColor: c.background,
    borderTopWidth: 1, borderTopColor: c.lines,
  },
  startBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  startBtnDisabled: { opacity: 0.6 },
  startBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
});