/** Explicit age, terms and core-data consent. Optional purposes default to off. */
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Switch, ActivityIndicator, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { consentStrings, CONSENT_NOTICE_VERSION } from '@/src/consentStrings';
import { consentCopy } from '@/src/consentCopy';
import { CONSENT_ANON_KEY, saveConsentLocally } from '@/src/consentStorage';
import { ConsentTermsModal } from '@/src/components/ConsentTermsModal';
import { ConsentPublicHelp } from '@/src/components/ConsentPublicHelp';
import { API_BASE, useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { updateConsentCache } from '@/src/analytics';
import { openStaticPage } from '@/src/outbound';
import { consentStyles as styles } from '@/src/consentStyles';
import { grievanceOfficerName, grievanceContactEmail, isGrievanceContactPlaceholder, privacyPolicyUrl } from '@/src/operatorIdentity';
// NF-UI-REV-12 (Group J, DHARA UI Revision v2.2.1): visible keyboard-focus
// ring only. No consent/age/purposes logic changes.
import { focusRingStyle } from '@/src/a11yFocus';

const colors = theme.colors;

/**
 * v2.2 rollout phase 4 (accessibility only, reversible). ON: every consent
 * control announces its name, role and on/off state to screen readers —
 * the age pair becomes a labelled radiogroup, the two required checkboxes
 * get explicit accessible names (today the name is derived from child
 * text, which some readers skip), and the two optional Switch controls
 * (kept as switches per owner decision, 21 Nov) get an explicit switch
 * role and checked state. OFF (the default, including when the env var is
 * unset): today's markup byte-for-byte. Defaults, visible labels, saved
 * records and layout are identical either way; consentStrings is untouched
 * (B-62). Same rollback pattern as src/designRevision.ts.
 */
const UI_V22_P4 = process.env.EXPO_PUBLIC_UI_V22_P4 === 'true';

const PLACEHOLDERS: Record<string, string> = {
  '{{DATA_LOCATION}}': 'India (cloud-hosted, encrypted at rest)',
  '{{GRIEVANCE_OFFICER_NAME}}': grievanceOfficerName,
  '{{GRIEVANCE_EMAIL}}': grievanceContactEmail,
};
// Fail-closed: if the officer name/email is still an unconfirmed
// placeholder, do not render the grievance officer line at all rather
// than show placeholder text to end users.
const showGrievanceLine = !isGrievanceContactPlaceholder();
const fillPlaceholders = (text: string) => Object.entries(PLACEHOLDERS)
  .reduce((s, [key, value]) => s.split(key).join(value), text);

// B-64 (24 Nov): on web the built-in Switch is already a real switch that
// reports on/off. Adding role + state on top wraps it in a second "switch"
// with no state, so screen readers heard 4 switches for 2 (one never saying
// on or off). Phones keep the explicit props (harmless repeats there).
const SWITCH_A11Y_PROPS = Platform.OS !== 'web';

export default function ConsentScreen() {
  const router = useRouter();
  const { mode, next } = useLocalSearchParams<{ mode?: string; next?: string }>();
  // B-81: this same screen is reused from Settings/Data & Privacy's "Withdraw
  // consent" action (routed as /consent?mode=update) for an ALREADY-signed-up,
  // already-consented user who only wants to flip their two optional
  // (analytics/updates) choices -- not redo age/terms/required-data consent.
  const isUpdateMode = mode === 'update';
  const { token, user, language, refreshUser, continueAsGuest } = useAuth();
  const langCode = consentStrings[language.code] ? language.code : 'en';
  const strings = consentStrings[langCode];
  const copy = consentCopy[langCode];
  const [age, setAge] = useState<'18+' | 'under18' | null>(null);
  const [termsTicked, setTerms] = useState(false);
  const [dataTicked, setData] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [updates, setUpdates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [help, setHelp] = useState<'emergency' | 'rights' | null>(null);
  const [updateSaved, setUpdateSaved] = useState(false);
  const submitting = useRef(false);
  // Only pre-fill the toggles from the user's CURRENT choices once -- a later
  // refreshUser() (e.g. after our own PATCH) must not silently stomp whatever
  // the person has since toggled on screen but not yet saved.
  const hydratedFromUser = useRef(false);
  useEffect(() => {
    if (!isUpdateMode || hydratedFromUser.current || !user) return;
    hydratedFromUser.current = true;
    setAnalytics(!!user.consent_purposes?.analytics);
    setUpdates(!!user.consent_purposes?.updates);
  }, [isUpdateMode, user]);
  const canContinue = age === '18+' && termsTicked && dataTicked;
  const guidance = age === 'under18' ? copy.under18
    : !age ? copy.ageRequired : !termsTicked ? copy.termsRequired
      : !dataTicked ? copy.dataRequired : copy.ready;

  // B-81: update-mode save — PATCH the two optional purposes via the
  // dedicated privacy-choices endpoint (DPDP right to withdraw), instead of
  // re-running first-time signup consent logging. This endpoint previously
  // existed on the backend (PATCH /api/user/privacy-choices) but nothing in
  // the app ever called it.
  async function handleSavePrivacyChoices() {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError(false);
    setUpdateSaved(false);
    try {
      const res = await fetch(`${API_BASE}/api/user/privacy-choices`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ analytics, updates }),
      });
      if (!res.ok) throw new Error('Request failed');
      updateConsentCache(analytics);
      await refreshUser();
      setUpdateSaved(true);
      setTimeout(() => setUpdateSaved(false), 4000);
    } catch {
      setSaveError(true);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (!canContinue || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      let anonId = await AsyncStorage.getItem(CONSENT_ANON_KEY);
      if (!anonId) {
        anonId = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        await AsyncStorage.setItem(CONSENT_ANON_KEY, anonId);
      }
      const purposes = { core: true, analytics, updates };
      await saveConsentLocally(purposes, user?.id);
      // Sync the in-memory analytics consent cache immediately so trackEvent
      // honours the user's choice without waiting for an async re-read.
      updateConsentCache(analytics);
      // Preserve the existing offline-first policy: local success unblocks the
      // screen; server logging is best-effort and cannot hang the Continue action.
      void fetch(`${API_BASE}/api/consent/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          notice_version: CONSENT_NOTICE_VERSION, purposes, language: langCode,
          age_confirmed_18: true, anon_id: user ? null : anonId,
          app_version: Constants.expoConfig?.version || '1.0.0',
        }),
      }).then(response => { if (response.ok && token) void refreshUser(); }).catch(() => {});
      // A known forward destination also works for direct links and updates.
      // Going back could return to another copy of the consent screen.
      // Web-preview fallback: after a route change the React AuthContext may
      // reset to null before re-hydrating from AsyncStorage (the in-memory
      // `token` state starts as null on every fresh mount on web).
      // Reading AsyncStorage directly here is safe — no data is modified.
      // On native `token` is always set by this point (AsyncStorage is sync-
      // hydrated on the native bridge), so the branch never fires there.
      let resolvedToken = token;
      if (!resolvedToken) {
        try {
          const raw = await AsyncStorage.getItem('gk_token');
          if (raw) resolvedToken = JSON.parse(raw) as string;
        } catch { /* storage unavailable; will redirect to login */ }
      }
      if (resolvedToken) { router.replace('/(tabs)/home'); return; }
      // 22 Nov (Vivek): the notice was opened by "Create an account" or
      // "Continue as guest" on a device that is already set up: carry on there.
      if (next === 'signup') { router.replace('/signup'); return; }
      if (next === 'guest') {
        try { await continueAsGuest(); router.replace('/(tabs)/home'); }
        catch { router.replace('/login'); }
        return;
      }
      router.replace('/login');
    } catch {
      setSaveError(true);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} testID="consent-screen" {...({ lang: langCode } as any)}>
      <ScrollView testID="consent-scroll" style={styles.scroll} contentContainerStyle={styles.content}>
        {isUpdateMode ? (
          // ── B-81: update mode — an already-consented user revisiting their
          // optional choices. No age/terms/required-data re-confirmation;
          // just show the CURRENT state of the two optional toggles. ──────
          <View style={styles.titleRow}>
            <Image source={require('../assets/images/dhara_mark.png')} style={styles.logoBox} resizeMode="contain" />
            <Text testID="consent-title" style={styles.title}>{copy.updateHeading}</Text>
          </View>
        ) : (
          <>
            {!user && !next && <Text style={styles.stepEyebrow}>STEP 3 OF 4</Text>}
            <View style={styles.titleRow}>
              <Image source={require('../assets/images/dhara_mark.png')} style={styles.logoBox} resizeMode="contain" />
              <Text testID="consent-title" style={styles.title}>{strings.title}</Text>
            </View>
            <Text testID="consent-intro" style={styles.intro}>{strings.intro}</Text>
            <Pressable testID="consent-open-terms-top" accessibilityRole="button" onPress={() => setShowTerms(true)} style={(s) => [styles.termsLink, focusRingStyle(s)]}>
              <Ionicons name="document-text-outline" size={20} color={colors.primary} />
              <Text style={styles.linkText}>{copy.termsLink}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </Pressable>
            <Text testID="consent-notice-version" style={styles.note}>Privacy notice · {CONSENT_NOTICE_VERSION}</Text>
            <Pressable
              testID="consent-read-full-privacy"
              accessibilityRole="link"
              accessibilityLabel={strings.read_full}
              onPress={() => openStaticPage(privacyPolicyUrl)}
              style={(s) => [styles.termsLink, focusRingStyle(s)]}>
              <Ionicons name="open-outline" size={20} color={colors.primary} />
              <Text style={styles.linkText}>{strings.read_full}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </Pressable>
            <Text testID="consent-collect-heading" style={styles.sectionHeading}>{strings.collect_heading}</Text>
            {strings.collect_items.map((item, i) => (
              <View key={item} style={styles.bulletRow}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
                <Text testID={`consent-collect-item-${i}`} style={styles.bulletText}>{item}</Text>
              </View>
            ))}
            <Text testID="consent-never-heading" style={styles.sectionHeading}>{strings.not_do_heading}</Text>
            {strings.not_do_items.map((item, i) => (
              <View key={item} style={styles.bulletRow}>
                <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                <Text testID={`consent-never-item-${i}`} style={styles.bulletText}>{item}</Text>
              </View>
            ))}
            <View style={styles.infoBox}><Text testID="consent-storage-notice" style={styles.infoText}>{fillPlaceholders(strings.storage)}</Text></View>
            <Text testID="consent-rights-heading" style={styles.sectionHeading}>{strings.rights_heading}</Text>
            <Text testID="consent-rights-notice" style={styles.bodyText}>{strings.rights_body}</Text>
            {showGrievanceLine && (
              <View style={styles.infoBox}><Text testID="consent-grievance-notice" style={styles.infoText}>{fillPlaceholders(strings.grievance)}</Text></View>
            )}

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>REQUIRED TO USE DHARA</Text>
            <Text testID="consent-age-heading" style={styles.sectionHeading}>{copy.ageHeading}</Text>
            <View style={styles.radioGroup}
              {...(UI_V22_P4 ? { accessibilityRole: 'radiogroup' as const, accessibilityLabel: copy.ageHeading, role: 'radiogroup' as const } : {})}>
              {(['18+', 'under18'] as const).map(value => (
                <Pressable key={value} testID={value === '18+' ? 'consent-age-adult' : 'consent-age-under18'}
                  {...(UI_V22_P4 ? { accessibilityLabel: value === '18+' ? strings.age_label : strings.age_under_label } : {})}
                  aria-checked={age === value} aria-disabled={saving}
                  accessibilityRole="radio" accessibilityState={{ checked: age === value, disabled: saving }} disabled={saving}
                  style={(state) => [styles.radioBtn, age === value && styles.radioSelected, state.pressed && styles.pressed, focusRingStyle(state)]}
                  onPress={() => setAge(value)}>
                  <Ionicons name={age === value ? 'radio-button-on' : 'radio-button-off'} size={22} color={age === value ? colors.primary : colors.onSurfaceTertiary} />
                  <Text style={styles.radioLabel}>{value === '18+' ? strings.age_label : strings.age_under_label}</Text>
                </Pressable>
              ))}
            </View>
            {age === 'under18' && <View testID="consent-under18-notice" style={styles.infoBox}>
              <Text style={styles.bodyText}>{copy.under18}</Text>
              <View style={styles.helpButtons}>
                <Pressable testID="consent-emergency-help" accessibilityRole="button" onPress={() => setHelp('emergency')} style={(s) => [styles.helpButton, focusRingStyle(s)]}><Text style={styles.linkText}>{copy.emergency}</Text></Pressable>
                <Pressable testID="consent-public-rights" accessibilityRole="button" onPress={() => setHelp('rights')} style={(s) => [styles.helpButton, focusRingStyle(s)]}><Text style={styles.linkText}>{copy.rights}</Text></Pressable>
              </View>
            </View>}

            <View style={styles.divider} />
            <Pressable testID="consent-open-terms" accessibilityRole="button" onPress={() => setShowTerms(true)} style={(s) => [styles.termsLink, focusRingStyle(s)]}>
              <Ionicons name="document-text-outline" size={20} color={colors.primary} />
              <Text style={styles.linkText}>{copy.termsLink}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </Pressable>
            <Pressable testID="consent-terms-checkbox" accessibilityRole="checkbox" aria-checked={termsTicked} aria-disabled={saving} accessibilityState={{ checked: termsTicked, disabled: saving }}
              {...(UI_V22_P4 ? { accessibilityLabel: strings.terms_checkbox } : {})}
              disabled={saving} style={(s) => [styles.checkRow, focusRingStyle(s)]} onPress={() => setTerms(v => !v)}>
              <Ionicons name={termsTicked ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
              <Text style={styles.checkLabel}>{strings.terms_checkbox}</Text>
            </Pressable>
            <Pressable testID="consent-data-checkbox" accessibilityRole="checkbox" aria-checked={dataTicked} aria-disabled={saving} accessibilityState={{ checked: dataTicked, disabled: saving }}
              {...(UI_V22_P4 ? { accessibilityLabel: strings.data_checkbox } : {})}
              disabled={saving} style={(s) => [styles.checkRow, focusRingStyle(s)]} onPress={() => setData(v => !v)}>
              <Ionicons name={dataTicked ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
              <Text style={styles.checkLabel}>{strings.data_checkbox}</Text>
            </Pressable>
          </>
        )}

        {isUpdateMode && (
          <Text testID="consent-update-intro" style={styles.intro}>{copy.updateIntro}</Text>
        )}
        <View style={styles.divider} />
        <Text testID="consent-optional-heading" style={styles.optionalHeading}>{strings.optional_heading}</Text>
        <View style={styles.toggleRow}>
          <Text testID="consent-analytics-label" style={styles.toggleLabel}>{strings.optional_analytics}</Text>
          <Switch testID="consent-analytics-switch" accessibilityLabel={strings.optional_analytics} disabled={saving} value={analytics} onValueChange={setAnalytics}
            {...(UI_V22_P4 ? (SWITCH_A11Y_PROPS ? { accessibilityRole: 'switch' as const, accessibilityState: { checked: analytics, disabled: saving } } : {}) : {})}
            trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.onBrandPrimary} />
        </View>
        <View style={styles.toggleRow}>
          <Text testID="consent-updates-label" style={styles.toggleLabel}>{strings.optional_updates}</Text>
          <Switch testID="consent-updates-switch" accessibilityLabel={strings.optional_updates} disabled={saving} value={updates} onValueChange={setUpdates}
            {...(UI_V22_P4 ? (SWITCH_A11Y_PROPS ? { accessibilityRole: 'switch' as const, accessibilityState: { checked: updates, disabled: saving } } : {}) : {})}
            trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.onBrandPrimary} />
        </View>
        {!isUpdateMode && <Text testID="consent-disclaimer" style={styles.note}>{strings.disclaimer}</Text>}
        {/* ── Design v2.2: "You get a record" card + DPDP/PIPEDA note ── */}
        {!isUpdateMode && (
          <>
            <View style={styles.recordCard}>
              <Text style={styles.recordCardText}>
                <Text style={styles.recordCardBold}>Your choices are logged. </Text>
                DHARA logs the terms version, timestamp, and each consent choice on the server for all users.
                {'\n\n'}
                <Text style={styles.recordCardBold}>Signed-in users</Text>
                {' '}can review and change their choices any time in Profile → My Data.{' '}
                <Text style={styles.recordCardBold}>Guest users</Text>
                {' '}cannot retrieve the log without signing in first.
              </Text>
            </View>
            <View style={styles.pendingNote}>
              <Text style={styles.pendingNoteText}>
                <Text style={styles.pendingNoteBold}>Pending legal and implementation review. </Text>
                This flow is intended to support rights under India's DPDP Act 2023. It is not a certification and has not been confirmed as sufficient.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {isUpdateMode ? (
        <View testID="consent-update-footer" style={styles.footer}>
          {updateSaved && <Text testID="consent-update-saved-banner" accessibilityLiveRegion="polite" style={styles.guidance}>{copy.updateSaved}</Text>}
          {saveError && <Text testID="consent-update-save-error" accessibilityRole="alert" style={styles.error}>{copy.updateSaveError}</Text>}
          <Pressable testID="consent-update-save-button" accessibilityRole="button" accessibilityLabel={copy.updateSaveButton}
            aria-disabled={saving} aria-busy={saving}
            accessibilityState={{ disabled: saving, busy: saving }} disabled={saving}
            style={(state) => [styles.continueBtn, state.pressed && styles.pressed, focusRingStyle(state)]} onPress={handleSavePrivacyChoices}>
            {saving ? <ActivityIndicator testID="consent-saving" color={colors.onBrandPrimary} />
              : <Text testID="consent-update-save-label" style={styles.continueText}>{copy.updateSaveButton}</Text>}
          </Pressable>
        </View>
      ) : (
        <View testID="consent-footer" style={styles.footer}>
          <Text testID="consent-continue-guidance" accessibilityLiveRegion="polite" style={styles.guidance}>{guidance}</Text>
          {saveError && <Text testID="consent-save-error" accessibilityRole="alert" style={styles.error}>{copy.saveError}</Text>}
          <Pressable testID="consent-continue-button" accessibilityRole="button"
            accessibilityLabel={canContinue ? 'Agree and continue' : 'Make the required choices above'}
            aria-disabled={!canContinue || saving} aria-busy={saving}
            accessibilityState={{ disabled: !canContinue || saving, busy: saving }} disabled={!canContinue || saving}
            style={(state) => [styles.continueBtn, !canContinue && styles.continueDisabled, state.pressed && styles.pressed, focusRingStyle(state)]} onPress={handleContinue}>
            {saving ? <ActivityIndicator testID="consent-saving" color={colors.onBrandPrimary} />
              : <Text testID="consent-continue-label" style={[styles.continueText, !canContinue && styles.disabledText]}>
                  {canContinue ? 'Agree and continue' : 'Make the required choices above'}
                </Text>}
          </Pressable>
          {!canContinue && (
            <Text style={styles.nothingSavedNote}>Nothing is saved until you press the button.</Text>
          )}
        </View>
      )}
      <ConsentTermsModal visible={showTerms} onClose={() => setShowTerms(false)} copy={copy} />
      <ConsentPublicHelp mode={help} onClose={() => setHelp(null)} copy={copy} lang={language.code} />
    </SafeAreaView>
  );
}