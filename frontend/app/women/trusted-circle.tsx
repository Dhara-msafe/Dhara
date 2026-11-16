import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Switch, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, saveCircle, type Contact } from '@/src/women/api';
import { openPhone } from '@/src/women/helpActions';
import { useAuth } from '@/src/auth';
import { inviteContact, listInvitations, revokeInvitation, type InviteLink, type Permissions } from '@/src/trustedCircle/api';

const TRUSTED_CIRCLE_RECIPIENT = process.env.EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT === 'true';

const c = theme.colors;
const TC_V2 = process.env.EXPO_PUBLIC_TRUSTED_CIRCLE_V2 === 'true';

// Matches the labels shown on the recipient's own invite screen
// (app/invite/[id].tsx PERM_LABEL) so owner and recipient see identical wording.
const PERM_FIELDS: { key: keyof Permissions; label: string }[] = [
  { key: 'journey_status', label: 'Journey status updates' },
  { key: 'expected_arrival', label: 'Expected arrival time' },
  { key: 'missed_checkin', label: 'Missed check-in alerts' },
  { key: 'temp_location', label: 'Temporary location (only while a journey is active)' },
  { key: 'emergency_requests', label: 'Emergency help requests' },
];
const DEFAULT_PERMS: Permissions = {
  journey_status: true, expected_arrival: true, missed_checkin: true,
  temp_location: false, emergency_requests: true,
};

export default function TrustedCircle() {
  const { token: authToken } = useAuth();
  const [list, setList] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(true);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Real invite/connection state from the backend (replaces the old
  // in-memory-only "invited" flag, which forgot everything on screen leave
  // and never reflected actual accept/decline/revoke status).
  const [sentInvites, setSentInvites] = useState<InviteLink[]>([]);
  const [draftPerms, setDraftPerms] = useState<Record<string, Permissions>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);

  useEffect(() => { getCircle().then(setList).catch(() => setStatus('Could not load contacts. Please reopen this screen.')).finally(() => setBusy(false)); }, []);

  const refreshInvites = () => {
    if (!authToken || !TRUSTED_CIRCLE_RECIPIENT) return;
    listInvitations(authToken, 'sent').then(setSentInvites);
  };
  useEffect(refreshInvites, [authToken]);

  const inviteFor = (ct: Contact) => sentInvites.find(inv => inv.contact_phone === ct.phone);

  const sendInvite = async (ct: Contact) => {
    if (!authToken) return;
    setInviteBusyId(ct.id);
    try {
      const perms = draftPerms[ct.id] || DEFAULT_PERMS;
      await inviteContact(authToken, { name: ct.name, phone: ct.phone, permissions: perms, relationship: ct.relationship });
      refreshInvites();
      setExpandedId(null);
      setStatus(`Invitation sent to ${ct.name} with the permissions you chose.`);
    } catch {
      setStatus('Could not send invitation. Try again.');
    } finally {
      setInviteBusyId(null);
    }
  };

  const revoke = async (invite: InviteLink) => {
    if (!authToken) return;
    setInviteBusyId(invite.id);
    try {
      await revokeInvitation(authToken, invite.id);
      refreshInvites();
      setStatus(`Access revoked. ${invite.contact_name} can no longer see your Safety Alerts.`);
    } finally {
      setInviteBusyId(null);
    }
  };

  const add = async () => {
    const number = phone.replace(/[\s()-]/g, '');
    if (!name.trim() || !/^\+?\d{10,15}$/.test(number)) { setStatus('Enter a name and a valid phone number (10–15 digits).'); return; }
    if (TC_V2 && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setStatus('Enter a valid email address or leave it blank.'); return; }
    if (busy || list.length >= 3) return;
    if (list.some(ct => ct.phone === number)) { setStatus('This number is already in your circle.'); return; }
    const newContact: Contact = { id: Date.now().toString(), name: name.trim(), phone: number, notify: true };
    if (TC_V2 && email.trim()) newContact.email = email.trim();
    if (relationship.trim()) newContact.relationship = relationship.trim();
    const next = [...list, newContact];
    setBusy(true);
    try { await saveCircle(next); setList(next); setName(''); setPhone(''); setEmail(''); setRelationship(''); setStatus('Contact saved on this device. No message has been sent.'); }
    catch { setStatus('Could not save contact. Please try again.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return;
    const next = list.filter(x => x.id !== id); setBusy(true);
    try { await saveCircle(next); setList(next); setStatus('Contact removed.'); }
    catch { setStatus('Could not remove contact. Please try again.'); }
    finally { setBusy(false); }
  };
  const toggleNotify = async (id: string) => {
    if (busy) return;
    const next = list.map(x => x.id === id ? { ...x, notify: x.notify === false } : x);
    setBusy(true);
    try { await saveCircle(next); setList(next); setStatus('Updated. This only changes what Silent alert suggests — nothing was sent.'); }
    catch { setStatus('Could not update this contact. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} testID="trusted-circle-screen">
      <ScreenHeader title="Trusted circle" subtitle="Up to 3 people · stored only on this phone" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
        <Text testID="circle-disclosure" style={styles.note}>Contacts are saved on this device. DHARA does not automatically alert them or monitor journeys. Tap the bell to choose whether a contact is suggested in Silent alert, or kept for calling only. Use Silent alert to prepare an SMS, then press Send in your messaging app.</Text>
        {!!status && <Text testID="circle-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>}

        {list.map(ct => (
          <View key={ct.id} style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{ct.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{ct.name}{ct.relationship ? ` · ${ct.relationship}` : ''}</Text>
              <Text style={styles.rowPhone}>{ct.phone}</Text>
              {TC_V2 && !!ct.email && <Text style={styles.rowEmail}>{ct.email}</Text>}
              <Text style={styles.rowNotify}>{ct.notify === false ? 'Call only' : 'Notified in Silent alert'}</Text>
            </View>
            <Pressable testID={`circle-toggle-notify-${ct.id}`} disabled={busy} onPress={() => toggleNotify(ct.id)} style={styles.iconBtn}>
              <Ionicons name={ct.notify === false ? 'notifications-off-outline' : 'notifications-outline'} size={20} color={ct.notify === false ? c.muted : c.navy} />
            </Pressable>
            <Pressable testID={`circle-call-${ct.id}`} onPress={async () => setStatus(await openPhone(ct.phone))} style={styles.iconBtn}><Ionicons name="call-outline" size={20} color={c.navy} /></Pressable>
            <Pressable testID={`circle-remove-${ct.id}`} disabled={busy} onPress={() => remove(ct.id)} style={styles.iconBtn}><Ionicons name="trash-outline" size={20} color={c.error} /></Pressable>
          </View>
        ))}

        {TRUSTED_CIRCLE_RECIPIENT && list.map(ct => {
          const invite = inviteFor(ct);
          const isBusy = inviteBusyId === ct.id || (!!invite && inviteBusyId === invite.id);

          if (invite?.status === 'accepted') {
            const shared = PERM_FIELDS.filter(f => invite.permissions?.[f.key]).map(f => f.label);
            return (
              <View key={`invite-${ct.id}`} style={styles.inviteRow}>
                <Text style={styles.connectedTxt}>
                  Connected — sharing: {shared.length ? shared.join(', ') : 'nothing yet'}
                </Text>
                <Pressable testID={`circle-revoke-${ct.id}`} disabled={isBusy} onPress={() => revoke(invite)} style={styles.revokeBtn}>
                  <Text style={styles.revokeBtnTxt}>{isBusy ? 'Revoking…' : 'Revoke access'}</Text>
                </Pressable>
              </View>
            );
          }
          if (invite?.status === 'pending') {
            return (
              <View key={`invite-${ct.id}`} style={styles.inviteRow}>
                <Text style={styles.inviteSentTxt}>Invitation sent to {ct.name} — waiting for them to respond.</Text>
              </View>
            );
          }
          if (invite?.status === 'declined' || invite?.status === 'revoked') {
            const isExpanded = expandedId === ct.id;
            const perms = draftPerms[ct.id] || DEFAULT_PERMS;
            const noticeTxt = invite.status === 'declined'
              ? `${ct.name} declined this invitation.`
              : `Connection with ${ct.name} was revoked.`;
            if (!isExpanded) {
              return (
                <View key={`invite-${ct.id}`} style={styles.inviteRow}>
                  <Text style={styles.inviteSentTxt}>{noticeTxt}</Text>
                  <Pressable
                    testID={`circle-reinvite-${ct.id}`}
                    disabled={!authToken}
                    onPress={() => setExpandedId(ct.id)}
                  >
                    <Text style={styles.inviteLinkTxt}>Invite {ct.name} again →</Text>
                  </Pressable>
                </View>
              );
            }
            // Re-invite always creates a BRAND NEW invitation record on the
            // backend (fresh id, status "pending") — the old declined/revoked
            // record is left untouched for history; its id/token is never
            // reused, and its (possibly now-stale) permissions never carry
            // over automatically — the owner re-chooses permissions below.
            return (
              <View key={`invite-${ct.id}`} style={styles.permPanel}>
                <Text style={styles.permPanelTitle}>Choose what {ct.name} can see</Text>
                {PERM_FIELDS.map(f => (
                  <View key={f.key} style={styles.permToggleRow}>
                    <Text style={styles.permToggleLabel}>{f.label}</Text>
                    <Switch
                      testID={`circle-perm-${f.key}-${ct.id}`}
                      accessibilityLabel={`${f.label} for ${ct.name}`}
                      value={!!perms[f.key]}
                      onValueChange={(v) => setDraftPerms(cur => ({ ...cur, [ct.id]: { ...perms, [f.key]: v } }))}
                    />
                  </View>
                ))}
                <View style={styles.permActionsRow}>
                  <Pressable testID={`circle-perm-cancel-${ct.id}`} style={styles.permCancelBtn} onPress={() => setExpandedId(null)}>
                    <Text style={styles.permCancelTxt}>Cancel</Text>
                  </Pressable>
                  <Pressable testID={`circle-perm-send-${ct.id}`} disabled={isBusy} style={styles.permSendBtn} onPress={() => sendInvite(ct)}>
                    <Text style={styles.permSendTxt}>{isBusy ? 'Sending…' : 'Send invitation'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          }

          const isExpanded = expandedId === ct.id;
          const perms = draftPerms[ct.id] || DEFAULT_PERMS;
          if (!isExpanded) {
            return (
              <View key={`invite-${ct.id}`} style={styles.inviteRow}>
                <Pressable testID={`circle-invite-${ct.id}`} disabled={!authToken} onPress={() => setExpandedId(ct.id)}>
                  <Text style={styles.inviteLinkTxt}>Invite {ct.name} to see your Safety Alerts in DHARA →</Text>
                </Pressable>
              </View>
            );
          }
          return (
            <View key={`invite-${ct.id}`} style={styles.permPanel}>
              <Text style={styles.permPanelTitle}>Choose what {ct.name} can see</Text>
              {PERM_FIELDS.map(f => (
                <View key={f.key} style={styles.permToggleRow}>
                  <Text style={styles.permToggleLabel}>{f.label}</Text>
                  <Switch
                    testID={`circle-perm-${f.key}-${ct.id}`}
                    accessibilityLabel={`${f.label} for ${ct.name}`}
                    value={!!perms[f.key]}
                    onValueChange={(v) => setDraftPerms(cur => ({ ...cur, [ct.id]: { ...perms, [f.key]: v } }))}
                  />
                </View>
              ))}
              <View style={styles.permActionsRow}>
                <Pressable testID={`circle-perm-cancel-${ct.id}`} style={styles.permCancelBtn} onPress={() => setExpandedId(null)}>
                  <Text style={styles.permCancelTxt}>Cancel</Text>
                </Pressable>
                <Pressable testID={`circle-perm-send-${ct.id}`} disabled={isBusy} style={styles.permSendBtn} onPress={() => sendInvite(ct)}>
                  <Text style={styles.permSendTxt}>{isBusy ? 'Sending…' : 'Send invitation'}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        {list.length < 3 && (
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>Add a person</Text>
            <TextInput testID="circle-name" value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={c.muted} style={styles.input} />
            <TextInput testID="circle-phone" value={phone} onChangeText={setPhone} placeholder="Phone number" placeholderTextColor={c.muted} keyboardType="phone-pad" style={styles.input} />
            <TextInput testID="circle-relationship" value={relationship} onChangeText={setRelationship} placeholder="Relationship (e.g. Friend, Family) — optional" placeholderTextColor={c.muted} style={styles.input} />
            {TC_V2 && <TextInput testID="circle-email" value={email} onChangeText={setEmail} placeholder="Email address (optional)" placeholderTextColor={c.muted} keyboardType="email-address" autoCapitalize="none" style={styles.input} />}
            <Pressable testID="circle-add" disabled={busy} style={styles.addBtn} onPress={add}><Text style={styles.addBtnTxt}>{busy ? 'Please wait…' : 'Add to circle'}</Text></Pressable>
          </View>
        )}
        {list.length >= 3 && <Text style={styles.full}>Circle full (3 of 3). Remove one to add another.</Text>}
        <Pressable testID="circle-prepare-alert" style={[styles.addBtn, { marginTop: 20 }]} onPress={() => router.dismissTo('/women/silent-alert')}><Text style={styles.addBtnTxt}>Prepare silent alert</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  note: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 14, marginBottom: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.navy },
  rowName: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  rowPhone: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted },
  rowEmail: { fontFamily: theme.fonts.body, fontSize: 12, color: c.navy, marginTop: 1 },
  rowNotify: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addCard: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, marginTop: 6 },
  addTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink, marginBottom: 12 },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontFamily: theme.fonts.body, fontSize: 16, color: c.ink, marginBottom: 12 },
  addBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  addBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  full: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, marginTop: 8 },
  inviteRow: { marginTop: -6, marginBottom: 10, paddingLeft: 56 },
  inviteLinkTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12.5, color: c.navy },
  inviteSentTxt: { fontFamily: theme.fonts.body, fontSize: 12.5, color: c.muted },
  connectedTxt: { fontFamily: theme.fonts.body, fontSize: 12.5, color: c.success, marginBottom: 6 },
  revokeBtn: { alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#FCEBE9', borderRadius: 999 },
  revokeBtnTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12.5, color: c.error },
  permPanel: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 14, padding: 14, marginTop: -6, marginBottom: 12 },
  permPanelTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 10 },
  permToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  permToggleLabel: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, paddingRight: 12 },
  permActionsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  permCancelBtn: { flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, borderWidth: 1, borderColor: c.lines },
  permCancelTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
  permSendBtn: { flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: c.navy },
  permSendTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: '#fff' },
});