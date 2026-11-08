/**
 * S3 — Guardian Journey Engine (SMS + status page)
 *
 * Feature flag: EXPO_PUBLIC_GUARDIAN_SHARE=true
 *
 * Phase 2 addition:
 *   Before sending SMS, creates a backend journey record that returns a
 *   short public URL ({host}/api/journey/status/{token}). The URL is
 *   appended to the SMS so the guardian can check real-time status in any
 *   browser without the app.
 *
 * Nothing is sent automatically; the user always controls every send.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useAuth } from '@/src/auth';
import { API_BASE } from '@/src/apiBase';
import { getCircle, type Contact } from '@/src/women/api';

import { openExternal, composeSms } from '@/src/outbound';
const c = theme.colors;

function formatDeadline(startTime: number, durationMins: number): string {
  const deadline = new Date(startTime + durationMins * 60 * 1000);
  return deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function GuardianShare() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { token: authToken } = useAuth();

  const params = useLocalSearchParams<{
    destination?: string;
    startTime?: string;
    durationMins?: string;
    journeyToken?: string;    // GO1B: pre-created token from head-out.tsx (when GPS is active)
    gpsLive?: string;         // '1' only when location sharing is actually running
  }>();

  const paramStart   = parseInt(params.startTime   ?? '0',  10);
  const paramDuration = parseInt(params.durationMins ?? '60', 10) || 60;
  // Editable journey details — this screen can also be opened straight from
  // Women's Shield, where no params are passed at all.
  const [destInput,    setDestInput]    = useState(params.destination ?? '');
  const [durationMins, setDurationMins] = useState(paramDuration);
  const [customDur,    setCustomDur]    = useState(
    [15, 30, 60, 120].includes(paramDuration) ? '' : String(paramDuration),
  );
  /** Duration in force when the Custom field was focused — restored if the
   *  user types an out-of-range value such as 1441 over a valid one. */
  const baselineDurationRef = useRef(paramDuration);
  const [durError,     setDurError]     = useState<string | null>(null);
  /** Set when the status record is created, so "check-in by" counts from then. */
  const [startedAt,    setStartedAt]    = useState(paramStart > 0 ? paramStart : 0);
  const destination  = destInput.trim();
  // If a journey was already created in head-out.tsx (GO1B GPS on), reuse it
  const preCreatedToken = params.journeyToken || null;
  /** True only when head-out confirmed the user consented and GPS is running. */
  const gpsLive = params.gpsLive === '1';

  /** The status link is useless to a guardian if it points at a dev host. */
  const linkHostWarning = (() => {
    const host = (API_BASE || '').replace(/^https?:\/\//, '').split('/')[0];
    if (!host) return 'This build has no backend address set, so a status link cannot be created.';
    const bare = host.split(':')[0];
    const isPrivate = bare === 'localhost' || bare === '127.0.0.1'
      || /^10\./.test(bare) || /^192\.168\./.test(bare)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(bare);
    return isPrivate ? `This link only works on this network (${bare}) — your guardian will not be able to open it from their own phone.` : null;
  })();

  const [circle,       setCircle]       = useState<Contact[]>([]);
  const [loading,      setLoading]      = useState(true);
  /** Contacts whose SMS composer was actually opened (NOT "sent"). */
  const [prepared,     setPrepared]     = useState<Set<string>>(new Set());
  const [preparingId,  setPreparingId]  = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [safeError,    setSafeError]    = useState<string | null>(null);
  const [revokeError,  setRevokeError]  = useState<string | null>(null);

  // Phase 2 state — seed with pre-created token from GPS session if available
  const [statusUrl,    setStatusUrl]    = useState<string | null>(null);
  const [journeyToken, setJourneyToken] = useState<string | null>(preCreatedToken);
  const [creating,     setCreating]     = useState(false);
  const [markingSafe,  setMarkingSafe]  = useState(false);
  const [markedSafe,   setMarkedSafe]   = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);
  // Guardian-link revocation follow-up: owner can withdraw sharing without
  // claiming arrival — distinct action/state from "mark safe" above.
  const [revoking,     setRevoking]     = useState(false);
  const [revoked,      setRevoked]      = useState(false);

  const checkInBy = formatDeadline(startedAt || Date.now(), durationMins);
  /** Once a status record exists its destination/duration are fixed on the
   *  backend, so the fields lock — the simpler, safer option than silently
   *  revoking and re-creating a link the guardian may already hold. */
  const fieldsLocked = !!journeyToken;

  useEffect(() => {
    getCircle()
      .then(contacts => setCircle(contacts))
      .catch(() => {})
      .finally(() => setLoading(false));
    // If journey was pre-created in head-out.tsx, build the status URL immediately
    if (preCreatedToken) {
      setStatusUrl(`${API_BASE}/api/journey/status/${preCreatedToken}`);
    }
  }, [preCreatedToken]);


  /** Create journey record on backend → get public status URL (skipped if already created) */
  const createJourneyRecord = useCallback(async (): Promise<string | null> => {
    // Reuse existing token (pre-created from head-out GPS session)
    if (statusUrl) return statusUrl;
    if (!authToken || !destination) return null;
    try {
      setCreating(true);
      setCreateError(null);
      const r = await fetch(`${API_BASE}/api/journey/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          destination: destination || 'a location',
          duration_mins: durationMins || 60,
        }),
      });
      if (!r.ok) throw new Error('Could not create status page');
      const data = await r.json();
      const url = `${API_BASE}${data.status_url}`;
      setStatusUrl(url);
      setJourneyToken(data.token);
      if (!startedAt) setStartedAt(Date.now());
      return url;
    } catch {
      setCreateError('Status link unavailable — the message will say there is no page to check.');
      return null;
    } finally {
      setCreating(false);
    }
  }, [authToken, destination, durationMins, statusUrl, startedAt]);

  const buildMessage = useCallback((pageUrl?: string | null) => {
    const dest = destination || 'a location';
    // Only promise live tracking when location sharing is genuinely running.
    const link = pageUrl
      ? `\n\n${gpsLive ? 'Track my journey live' : 'Check my journey status'}: ${pageUrl}`
      : '\n\n(Status link unavailable — I could not create one, so there is no page to check.)';
    return (
      `Hi, I'm heading to ${dest}. I plan to check in by ${checkInBy}.${link}\n\n` +
      `If you don't hear from me by then, please call me to confirm I'm safe.\n\n` +
      `(Sent via DHARA legal aid app)`
    );
  }, [destination, checkInBy, gpsLive]);

  /** One contact at a time, through the outbound guard — the user presses Send. */
  const prepareFor = useCallback(async (ct: Contact) => {
    if (!destination) { setPrepareError('Enter a destination first.'); return; }
    setPreparingId(ct.id);
    setPrepareError(null);
    try {
      const pageUrl = statusUrl ?? await createJourneyRecord();
      const body = buildMessage(pageUrl);
      const result = await composeSms([ct.phone], body);
      if (result === 'composer') {
        setPrepared(prev => new Set(prev).add(ct.id));
        return;
      }
      if (result === 'blocked' || result === 'simulated') {
        setPrepareError('No message was prepared — see the notice shown just now for the reason.');
        return;
      }
      // 'unavailable' (e.g. web has no SMS module) — fall back to the sms: link,
      // still through the guard so the same rails apply.
      const opened = await openExternal(`sms:${ct.phone}?body=${encodeURIComponent(body)}`);
      if (opened === 'opened') setPrepared(prev => new Set(prev).add(ct.id));
      else setPrepareError('No message was prepared — see the notice shown just now for the reason.');
    } catch {
      setPrepareError('Your SMS app could not be opened. You can copy the message and send it yourself.');
    } finally {
      setPreparingId(null);
    }
  }, [statusUrl, createJourneyRecord, buildMessage, destination]);

  const markSafe = useCallback(async () => {
    if (!journeyToken || !authToken) return;
    setMarkingSafe(true);
    setSafeError(null);
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/safe`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      // Only claim the update once the backend confirmed it.
      if (r.ok) setMarkedSafe(true);
      else setSafeError('Could not update your status page. Your guardian has NOT been told you arrived.');
    } catch {
      setSafeError('No connection, so your status page was not updated. Your guardian has NOT been told you arrived.');
    } finally {
      setMarkingSafe(false);
    }
  }, [journeyToken, authToken]);

  /** Owner withdraws sharing — distinct from markSafe: no claim of arrival,
   * just "stop showing anyone anything new from this link". Takes effect
   * immediately for every holder of the status link (direct or forwarded)
   * since the backend strips location on every page read once this is set. */
  const revokeSharing = useCallback(async () => {
    if (!journeyToken || !authToken) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      // Only claim sharing stopped once the backend confirmed it.
      if (r.ok) setRevoked(true);
      else setRevokeError('Could not withdraw sharing. The link may still show your location — try again.');
    } catch {
      setRevokeError('No connection, so sharing was not withdrawn. The link may still show your location — try again.');
    } finally {
      setRevoking(false);
    }
  }, [journeyToken, authToken]);

  // Only contacts who can actually receive a message.
  const messageable = circle.filter(ct => ct.notify !== false && !!ct.phone?.trim());
  const sent = prepared.size > 0;

  if (loading) return null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      testID="guardian-share-screen"
    >
      <ScreenHeader
        title="Notify your guardian"
        subtitle="Send a journey update — nothing is sent automatically"
      />

      {/* Journey details — editable; this screen is also opened directly from
          Women's Shield, where nothing is pre-filled. */}
      <View style={styles.journeyCard}>
        <Text style={styles.previewLabel}>Where are you going?</Text>
        <TextInput
          testID="guardian-destination-input"
          style={[styles.input, fieldsLocked && styles.inputLocked]}
          value={destInput}
          onChangeText={t => { setDestInput(t); if (prepareError) setPrepareError(null); }}
          editable={!fieldsLocked}
          placeholder="e.g. Library, friend's place, hostel"
          placeholderTextColor={c.muted}
          maxLength={80}
          accessibilityLabel="Where are you going"
        />
        <Text style={styles.previewLabel}>Check in within</Text>
        <View style={styles.chipRow}>
          {[15, 30, 60, 120].map(mins => (
            <Pressable
              key={mins}
              testID={`guardian-duration-${mins}`}
              disabled={fieldsLocked}
              style={[styles.chip, durationMins === mins && styles.chipOn, fieldsLocked && styles.inputLocked]}
              onPress={() => { setDurationMins(mins); baselineDurationRef.current = mins; setCustomDur(''); setDurError(null); }}
              accessibilityRole="button"
              accessibilityLabel={`Check in within ${mins} minutes`}
            >
              <Text style={[styles.chipTxt, durationMins === mins && styles.chipTxtOn]}>{mins} min</Text>
            </Pressable>
          ))}
          <TextInput
            testID="guardian-duration-custom"
            style={[styles.chipInput, fieldsLocked && styles.inputLocked]}
            value={customDur}
            editable={!fieldsLocked}
            onFocus={() => { baselineDurationRef.current = durationMins; }}
            onChangeText={t => {
              const digits = t.replace(/\D/g, '').slice(0, 4);
              setCustomDur(digits);
              if (!digits) { setDurError(null); setDurationMins(baselineDurationRef.current); return; }
              const n = parseInt(digits, 10);
              if (n < 1 || n > 1440) {
                // Fall back to what was in force before this edit — a half-typed
                // prefix of an invalid number (144 of 1441) is not a choice.
                setDurError('Choose between 1 and 1440 minutes.');
                setDurationMins(baselineDurationRef.current);
                return;
              }
              setDurError(null);
              setDurationMins(n);
            }}
            onBlur={() => {
              if (durError) {
                setCustomDur('');
                setDurError(null);
                setDurationMins(baselineDurationRef.current);
                return;
              }
              // Accepted on leaving the field — this becomes the new baseline.
              baselineDurationRef.current = durationMins;
            }}
            placeholder="Custom"
            placeholderTextColor={c.muted}
            keyboardType="number-pad"
            accessibilityLabel="Custom check-in minutes"
          />
        </View>
        {durError && <Text style={styles.errorTxt} testID="guardian-duration-error">{durError}</Text>}
        {fieldsLocked && (
          <Text style={styles.disclosureNote} testID="guardian-fields-locked">
            Your status link is already created, so the destination and time are fixed for it. End this journey and start a new one to change them.
          </Text>
        )}
      </View>

      {/* Journey preview card */}
      <View style={styles.journeyCard}>
        <View style={styles.journeyRow}>
          <Ionicons name="navigate-circle-outline" size={20} color={c.navy} />
          <Text style={[styles.journeyTxt, { flex: 1 }]}>{destination || 'Destination not set'}</Text>
        </View>
        <View style={styles.journeyRow}>
          <Ionicons name="time-outline" size={20} color={c.navy} />
          <Text style={styles.journeyTxt}>Check-in by {checkInBy}</Text>
        </View>
        {statusUrl && (
          <View style={styles.journeyRow}>
            <Ionicons name="link-outline" size={20} color={c.verifiedGreen ?? '#16a34a'} />
            <Text style={[styles.journeyTxt, { color: c.verifiedGreen ?? '#16a34a', fontSize: 12, flex: 1 }]}>
              {gpsLive
                ? 'Status page ready — it shows your area while sharing is on'
                : 'Status page ready — it shows your check-in status, not your location'}
            </Text>
          </View>
        )}
      </View>

      {/* Contact selector */}
      <Text style={styles.sectionLabel}>Prepare a message for each person</Text>
      {linkHostWarning && (
        <Text style={styles.errorTxt} testID="guardian-link-host-warning">{linkHostWarning}</Text>
      )}

      {messageable.length === 0 ? (
        <View style={styles.emptyCard} testID="guardian-no-contacts">
          <Ionicons name="people-outline" size={28} color={c.muted} />
          <Text style={styles.emptyTxt}>
            {circle.length === 0
              ? 'Your trusted circle is empty. Add someone with a phone number first.'
              : 'No one in your circle has notifications on with a phone number saved. Open your circle to add a number or tap the bell.'}
          </Text>
          <Pressable
            testID="guardian-add-circle"
            style={styles.safeBtn}
            onPress={() => router.push('/women/trusted-circle')}
            accessibilityRole="button"
            accessibilityLabel="Manage trusted circle"
          >
            <Text style={styles.safeBtnTxt}>Manage circle</Text>
          </Pressable>
        </View>
      ) : (
        messageable.map(ct => {
          const done = prepared.has(ct.id);
          return (
            <View key={ct.id} style={[styles.contactRow, done && styles.contactRowSelected]} testID={`guardian-contact-${ct.id}`}>
              <View style={[styles.avatar, done && styles.avatarSelected]}>
                {done
                  ? <Ionicons name="checkmark" size={16} color="#fff" />
                  : <Text style={styles.avatarTxt}>{ct.name.charAt(0).toUpperCase()}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactName}>{ct.name}</Text>
                <Text style={styles.contactPhone}>
                  {done ? 'Message prepared — press Send in your SMS app' : ct.phone}
                </Text>
              </View>
              <Pressable
                testID={`guardian-prepare-${ct.id}`}
                style={[styles.prepareBtn, (!destination || !!durError) && styles.sendBtnDisabled]}
                disabled={preparingId === ct.id || creating || !destination || !!durError}
                onPress={() => prepareFor(ct)}
                accessibilityRole="button"
                accessibilityLabel={`Prepare a message for ${ct.name}`}
              >
                {preparingId === ct.id
                  ? <ActivityIndicator color={c.navy} size="small" />
                  : <Text style={styles.prepareBtnTxt}>{done ? 'Again' : 'Prepare'}</Text>}
              </Pressable>
            </View>
          );
        })
      )}

      {!destination && messageable.length > 0 && (
        <Text style={styles.errorTxt} testID="guardian-need-destination">Enter a destination first.</Text>
      )}

      {prepareError && (
        <Text style={styles.errorTxt} testID="guardian-prepare-error">{prepareError}</Text>
      )}

      {/* Message preview */}
      <View style={styles.messagePreview}>
        <Text style={styles.previewLabel}>Message preview</Text>
        <Text style={styles.previewBody}>
          {buildMessage(statusUrl ?? (createError ? null : '[status link will be added]'))}
        </Text>
      </View>

      {createError && (
        <Text style={styles.errorTxt} testID="guardian-create-error">{createError}</Text>
      )}

      {sent && (
        <View style={styles.sentBanner} testID="guardian-sent-banner">
          <Ionicons name="checkmark-circle-outline" size={18} color={c.verifiedGreen} />
          <Text style={styles.sentTxt}>
            {`Message prepared for ${prepared.size} ${prepared.size === 1 ? 'person' : 'people'} — press Send in your SMS app for each one. DHARA cannot confirm delivery.`}
          </Text>
        </View>
      )}

      {/* Mark safe — shown after SMS is sent. Deliberately available even
          after "Withdraw sharing" was already used: revoking never claimed
          anything about arrival, so there is nothing to protect by hiding
          this — see journey_router.py::mark_safe() for the matching
          backend-side independence. */}
      {sent && journeyToken && !markedSafe && (
        <Pressable
          testID="guardian-mark-safe"
          style={styles.safeBtn}
          onPress={markSafe}
          disabled={markingSafe}
          accessibilityRole="button"
          accessibilityLabel="I have arrived safely"
        >
          {markingSafe
            ? <ActivityIndicator color={c.navy} size="small" />
            : <Ionicons name="shield-checkmark-outline" size={18} color={c.navy} />
          }
          <Text style={styles.safeBtnTxt}>
            {markingSafe ? 'Updating\u2026' : 'I have arrived safely \u2014 update my guardian'}
          </Text>
        </Pressable>
      )}

      {safeError && (
        <View style={styles.revokeSection} testID="guardian-safe-error">
          <Text style={styles.errorTxt}>{safeError}</Text>
          <Pressable style={styles.safeBtn} onPress={markSafe} disabled={markingSafe} testID="guardian-safe-retry" accessibilityRole="button">
            <Text style={styles.safeBtnTxt}>{markingSafe ? 'Trying again…' : 'Try again'}</Text>
          </Pressable>
        </View>
      )}

      {markedSafe && revoked && (
        <View style={styles.safeBanner} testID="guardian-safe-banner">
          <Ionicons name="shield-checkmark" size={18} color="#16a34a" />
          <Text style={styles.safeBannerTxt}>
            {'Status page updated \u2014 arrived safely. Sharing had already been turned off, so no location was shown for this update.'}
          </Text>
        </View>
      )}
      {markedSafe && !revoked && (
        <View style={styles.safeBanner} testID="guardian-safe-banner">
          <Ionicons name="shield-checkmark" size={18} color="#16a34a" />
          <Text style={styles.safeBannerTxt}>
            {'Status page updated \u2014 your guardian can see you are safe.'}
          </Text>
        </View>
      )}

      {/* Withdraw sharing — shown after SMS is sent, available independently
          of "I have arrived safely"; hidden once used (can't revoke twice)
          or once already marked safe (location is already hidden by then,
          so revoking adds nothing). The warning below is required reading
          BEFORE tapping — withdrawing also turns off the missed-check-in
          safety escalation tied to this same link (see journey_router.py's
          report_missed_checkin() docstring for why that is intentional). */}
      {sent && journeyToken && !markedSafe && !revoked && (
        <View style={styles.revokeSection}>
          <Text style={styles.revokeWarningTxt}>
            Note: if you withdraw sharing, your guardian will NOT be notified even if you miss your check-in — the missed-check-in alert is tied to this same link.
          </Text>
          <Pressable
            testID="guardian-revoke-sharing"
            style={styles.revokeSharingBtn}
            onPress={revokeSharing}
            disabled={revoking}
            accessibilityRole="button"
            accessibilityLabel="Withdraw location sharing for this link"
          >
            {revoking
              ? <ActivityIndicator color={c.error ?? '#dc2626'} size="small" />
              : <Ionicons name="lock-closed-outline" size={18} color={c.error ?? '#dc2626'} />
            }
            <Text style={styles.revokeSharingBtnTxt}>
              {revoking ? 'Withdrawing\u2026' : 'Withdraw sharing for this link'}
            </Text>
          </Pressable>
        </View>
      )}

      {revokeError && (
        <View style={styles.revokeSection} testID="guardian-revoke-error">
          <Text style={styles.errorTxt}>{revokeError}</Text>
          <Pressable style={styles.revokeSharingBtn} onPress={revokeSharing} disabled={revoking} testID="guardian-revoke-retry" accessibilityRole="button">
            <Text style={styles.revokeSharingBtnTxt}>{revoking ? 'Trying again…' : 'Try again'}</Text>
          </Pressable>
        </View>
      )}

      {revoked && (
        <View style={styles.revokedBanner} testID="guardian-revoked-banner">
          <Ionicons name="lock-closed" size={18} color={c.error ?? '#dc2626'} />
          <Text style={styles.revokedBannerTxt}>
            Sharing withdrawn — the status link no longer shows your location to anyone, including anyone it was forwarded to. Missed-check-in alerts for this link are also off now; you can still tap &ldquo;I have arrived safely&rdquo; below at any time.
          </Text>
        </View>
      )}

      <Text style={styles.disclosureNote}>
        Nothing is sent automatically. DHARA opens your SMS app with a pre-filled message for one person at a time; you read it and press Send yourself, and delivery is not confirmed. Status pages expire after 24 hours.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 16 },
  journeyCard: {
    backgroundColor: c.surface, borderRadius: 14, borderWidth: 1,
    borderColor: c.lines, padding: 16, gap: 10,
  },
  journeyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  journeyTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  sectionLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginTop: 4 },
  emptyCard: {
    backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines,
    padding: 20, gap: 10, alignItems: 'center',
  },
  emptyTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, textAlign: 'center' },
  linkTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: c.surface, borderRadius: 14, borderWidth: 1.5, borderColor: c.lines,
  },
  contactRowSelected: { borderColor: c.navy, backgroundColor: c.navySoft },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: c.navySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSelected: { backgroundColor: c.navy },
  avatarTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  contactName: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  contactPhone: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2 },
  prepareBtn: {
    minHeight: 44, minWidth: 84, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: c.navy, backgroundColor: c.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  prepareBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  input: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12,
    paddingHorizontal: 14, minHeight: 48, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink,
  },
  inputLocked: { opacity: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: c.navy, backgroundColor: c.surface,
  },
  chipOn: { backgroundColor: c.navy },
  chipTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  chipTxtOn: { color: '#fff' },
  chipInput: {
    minHeight: 44, minWidth: 90, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1,
    borderColor: c.lines, backgroundColor: c.surface, fontFamily: theme.fonts.body,
    fontSize: 13, color: c.ink,
  },
  messagePreview: {
    backgroundColor: c.surfaceTertiary ?? '#F4F4F6', borderRadius: 12,
    borderWidth: 1, borderColor: c.lines, padding: 14, gap: 6,
  },
  previewLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  previewBody: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 20 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
  sentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F0FFF4', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: c.verifiedGreen,
  },
  sentTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, flex: 1 },
  safeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.navySoft, borderRadius: 14, paddingVertical: 14,
    paddingHorizontal: 18, borderWidth: 1.5, borderColor: c.navy,
  },
  safeBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  safeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F0FFF4', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#16a34a',
  },
  safeBannerTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, flex: 1 },
  revokeSection: { gap: 8 },
  revokeWarningTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17, paddingHorizontal: 4 },
  revokeSharingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FCEBE9', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: c.error ?? '#dc2626',
  },
  revokeSharingBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.error ?? '#dc2626' },
  revokedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FCEBE9', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: c.error ?? '#dc2626',
  },
  revokedBannerTxt: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, flex: 1, lineHeight: 19 },
  errorTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: '#dc2626', textAlign: 'center' },
  disclosureNote: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    textAlign: 'center', lineHeight: 18,
  },
});
