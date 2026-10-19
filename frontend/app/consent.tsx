/** Explicit age, terms and core-data consent. Optional purposes default to off. */
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import { consentStyles as styles } from '@/src/consentStyles';
import { grievanceOfficerName, grievanceContactEmail, isGrievanceContactPlaceholder } from '@/src/operatorIdentity';

const colors = theme.colors;

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

export default function ConsentScreen() {
  const router = useRouter();
  const { token, user, language, refreshUser } = useAuth();
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
  const submitting = useRef(false);
  const canContinue = age === '18+' && termsTicked && dataTicked;
  const guidance = age === 'under18' ? copy.under18
    : !age ? copy.ageRequired : !termsTicked ? copy.termsRequired
      : !dataTicked ? copy.dataRequired : copy.ready;

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
      router.replace(token ? '/(tabs)/home' : '/login');
    } catch {
      setSaveError(true);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} testID="consent-screen" lang={langCode}>
      <ScrollView testID="consent-scroll" style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Image source={require('../assets/images/dhara_icon.png')} style={styles.logoBox} resizeMode="contain" />
          <Text testID="consent-title" style={styles.title}>{strings.title}</Text>
        </View>
        <Text testID="consent-intro" style={styles.intro}>{strings.intro}</Text>
        <Pressable testID="consent-open-terms-top" accessibilityRole="button" onPress={() => setShowTerms(true)} style={styles.termsLink}>
          <Ionicons name="document-text-outline" size={20} color={colors.primary} />
          <Text style={styles.linkText}>{copy.termsLink}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
        <Text testID="consent-notice-version" style={styles.note}>Privacy notice · {CONSENT_NOTICE_VERSION}</Text>
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

        <Text testID="consent-age-heading" style={styles.sectionHeading}>{copy.ageHeading}</Text>
        <View style={styles.radioGroup}>
          {(['18+', 'under18'] as const).map(value => (
            <Pressable key={value} testID={value === '18+' ? 'consent-age-adult' : 'consent-age-under18'}
              aria-checked={age === value} aria-disabled={saving}
              accessibilityRole="radio" accessibilityState={{ checked: age === value, disabled: saving }} disabled={saving}
              style={({ pressed }) => [styles.radioBtn, age === value && styles.radioSelected, pressed && styles.pressed]}
              onPress={() => setAge(value)}>
              <Ionicons name={age === value ? 'radio-button-on' : 'radio-button-off'} size={22} color={age === value ? colors.primary : colors.onSurfaceTertiary} />
              <Text style={styles.radioLabel}>{value === '18+' ? strings.age_label : strings.age_under_label}</Text>
            </Pressable>
          ))}
        </View>
        {age === 'under18' && <View testID="consent-under18-notice" style={styles.infoBox}>
          <Text style={styles.bodyText}>{copy.under18}</Text>
          <View style={styles.helpButtons}>
            <Pressable testID="consent-emergency-help" accessibilityRole="button" onPress={() => setHelp('emergency')} style={styles.helpButton}><Text style={styles.linkText}>{copy.emergency}</Text></Pressable>
            <Pressable testID="consent-public-rights" accessibilityRole="button" onPress={() => setHelp('rights')} style={styles.helpButton}><Text style={styles.linkText}>{copy.rights}</Text></Pressable>
          </View>
        </View>}

        <View style={styles.divider} />
        <Pressable testID="consent-open-terms" accessibilityRole="button" onPress={() => setShowTerms(true)} style={styles.termsLink}>
          <Ionicons name="document-text-outline" size={20} color={colors.primary} />
          <Text style={styles.linkText}>{copy.termsLink}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
        <Pressable testID="consent-terms-checkbox" accessibilityRole="checkbox" aria-checked={termsTicked} aria-disabled={saving} accessibilityState={{ checked: termsTicked, disabled: saving }}
          disabled={saving} style={styles.checkRow} onPress={() => setTerms(v => !v)}>
          <Ionicons name={termsTicked ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
          <Text style={styles.checkLabel}>{strings.terms_checkbox}</Text>
        </Pressable>
        <Pressable testID="consent-data-checkbox" accessibilityRole="checkbox" aria-checked={dataTicked} aria-disabled={saving} accessibilityState={{ checked: dataTicked, disabled: saving }}
          disabled={saving} style={styles.checkRow} onPress={() => setData(v => !v)}>
          <Ionicons name={dataTicked ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
          <Text style={styles.checkLabel}>{strings.data_checkbox}</Text>
        </Pressable>

        <View style={styles.divider} />
        <Text testID="consent-optional-heading" style={styles.optionalHeading}>{strings.optional_heading}</Text>
        <View style={styles.toggleRow}>
          <Text testID="consent-analytics-label" style={styles.toggleLabel}>{strings.optional_analytics}</Text>
          <Switch testID="consent-analytics-switch" accessibilityLabel={strings.optional_analytics} disabled={saving} value={analytics} onValueChange={setAnalytics}
            trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.onBrandPrimary} />
        </View>
        <View style={styles.toggleRow}>
          <Text testID="consent-updates-label" style={styles.toggleLabel}>{strings.optional_updates}</Text>
          <Switch testID="consent-updates-switch" accessibilityLabel={strings.optional_updates} disabled={saving} value={updates} onValueChange={setUpdates}
            trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.onBrandPrimary} />
        </View>
        <Text testID="consent-disclaimer" style={styles.note}>{strings.disclaimer}</Text>
      </ScrollView>

      <View testID="consent-footer" style={styles.footer}>
        <Text testID="consent-continue-guidance" accessibilityLiveRegion="polite" style={styles.guidance}>{guidance}</Text>
        {saveError && <Text testID="consent-save-error" accessibilityRole="alert" style={styles.error}>{copy.saveError}</Text>}
        <Pressable testID="consent-continue-button" accessibilityRole="button" accessibilityLabel={strings.continue_button}
          aria-disabled={!canContinue || saving} aria-busy={saving}
          accessibilityState={{ disabled: !canContinue || saving, busy: saving }} disabled={!canContinue || saving}
          style={({ pressed }) => [styles.continueBtn, !canContinue && styles.continueDisabled, pressed && styles.pressed]} onPress={handleContinue}>
          {saving ? <ActivityIndicator testID="consent-saving" color={colors.onBrandPrimary} />
            : <Text testID="consent-continue-label" style={[styles.continueText, !canContinue && styles.disabledText]}>{strings.continue_button}</Text>}
        </Pressable>
      </View>
      <ConsentTermsModal visible={showTerms} onClose={() => setShowTerms(false)} copy={copy} />
      <ConsentPublicHelp mode={help} onClose={() => setHelp(null)} copy={copy} lang={language.code} />
    </SafeAreaView>
  );
}