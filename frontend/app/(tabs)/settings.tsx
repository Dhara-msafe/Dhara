import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, Platform, Switch, Animated, Linking, TextInput, ActivityIndicator } from 'react-native';
import { crossAlert } from '@/src/utils/crossAlert';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, API_BASE, Language, TtsVoiceMode } from '@/src/auth';
import { theme } from '@/src/theme';
import { SOSButton } from '@/src/components/SOSButton';
import { getPushPermissionState, enablePushNotifications, PushPermissionState } from '@/src/push';
import { t } from '@/src/i18n';

export default function Settings() {
  const { user, token, logout, language, setLanguage, autoSpeak, setAutoSpeak, ttsVolume, setTtsVolume, ttsVoiceMode, setTtsVoiceMode, refreshUser } = useAuth();
  const router = useRouter();
  const [langs, setLangs] = useState<Language[]>([]);
  const [showLang, setShowLang] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [termsText, setTermsText] = useState('');
  const [pushState, setPushState] = useState<PushPermissionState>('undetermined');
  const [pushTestBusy, setPushTestBusy] = useState(false);
  // Brief visual confirmation when language changes
  const [langConfirm, setLangConfirm] = useState<string | null>(null);
  const langFadeAnim = useRef(new Animated.Value(0)).current;

  // Account deletion — irreversible, so it requires re-entering the account
  // password before we call the backend (see handle_permissions/auth-bug
  // pattern of never dead-ending, but this action is intentionally final).
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const flashLangConfirm = (name: string) => {
    setLangConfirm(name);
    Animated.sequence([
      Animated.timing(langFadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(langFadeAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setLangConfirm(null));
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/reference/languages`).then(r => r.json()).then(setLangs);
    fetch(`${API_BASE}/api/legal/terms`).then(r => r.json()).then(d => setTermsText(d.text)).catch(() => {});
    refreshUser();
    if (Platform.OS !== 'web') {
      getPushPermissionState().then(setPushState);
    } else {
      setPushState('unsupported');
    }
  }, [refreshUser]);

  const onTogglePush = async (value: boolean) => {
    if (!value) {
      // The OS doesn't let an app silently revoke its own notification
      // permission — send the user to the one place that actually can.
      crossAlert(
        'Turn off notifications',
        'To stop notifications from Dhara, turn them off in your phone\'s Settings app.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    if (!token || !user) return;
    const result = await enablePushNotifications(token, user.id);
    if (result.granted) {
      setPushState('granted');
      return;
    }
    setPushState('denied');
    if (!result.canAskAgain) {
      crossAlert(
        'Notifications are blocked',
        'You previously denied notification permission for Dhara. Open Settings to turn it on.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
    }
  };

  // "Send test notification" — round-trips the SuprSend relay so the user (or
  // an operator on a device build) can verify their token was registered and
  // the backend can reach them. Rate-limited server-side to 1/min per user.
  const onSendTestPush = async () => {
    if (!token || pushTestBusy) return;
    setPushTestBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/push/self-test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) {
        crossAlert('Slow down', j?.detail || 'Please wait a minute and try again.');
      } else if (j?.status === 'sent') {
        crossAlert(
          'Test notification sent',
          'You should see a Dhara notification within a few seconds. If nothing arrives, verify permissions are on and that this is a real device build (Expo Go cannot receive push).',
        );
      } else {
        crossAlert(
          'Could not send test',
          j?.reason || 'The push relay is not reachable from this environment. This is expected in the dev pod; try again after deploying to a real Android build.',
        );
      }
    } catch (e: any) {
      crossAlert('Network error', e?.message || 'Please try again.');
    } finally {
      setPushTestBusy(false);
    }
  };

  const openDeleteModal = () => {
    setDeletePassword('');
    setDeleteError(null);
    setShowDeleteModal(true);
  };

  const submitDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    setDeleteError(null);
    setDeleteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/account/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data?.detail || 'Could not delete your account. Please try again.');
        setDeleteLoading(false);
        return;
      }
      setShowDeleteModal(false);
      await logout();
      router.replace('/login');
    } catch (e: any) {
      setDeleteError(e?.message || 'Network error. Please try again.');
      setDeleteLoading(false);
    }
  };

  const confirmLogout = () => {
    crossAlert('Sign out?', 'You will need to sign in again to continue.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="settings-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>{t('settings.title', language.code)}</Text>
        <Text style={styles.h2}>{t('settings.subtitle', language.code)}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarTxt}>{user?.name?.[0]?.toUpperCase() || 'G'}</Text></View>
          <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.name}>{user?.name}</Text>
              {user?.is_pro && (
                <View testID="profile-pro-badge" style={styles.proBadge}>
                  <Ionicons name="star" size={10} color={theme.colors.onBrandSecondary} />
                  <Text style={styles.proBadgeText}>PRO</Text>
                </View>
              )}
            </View>
            <Text style={styles.email}>{user?.email}</Text>
            {!!user?.phone && <Text style={styles.email} testID="profile-phone">{user.phone}</Text>}
          </View>
        </View>

        <Pressable
          testID="pro-upsell-card"
          style={[styles.upsell, user?.is_pro && { backgroundColor: theme.colors.brandTertiary }]}
          onPress={() => router.push('/upgrade')}
        >
          <Ionicons name="star" size={22} color={theme.colors.onBrandPrimary} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.upsellTitle}>{user?.is_pro ? 'Dhara Pro · Active' : 'Upgrade to Dhara Pro'}</Text>
            <Text style={styles.upsellSub}>{user?.is_pro ? 'Lawyer-consultation-style answers unlocked' : 'Lawyer-style depth · Drafts · Escalation paths'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onBrandPrimary} />
        </Pressable>

        <Text style={styles.section}>{t('settings.section.preferences', language.code)}</Text>

        <Pressable testID="pick-language" style={styles.row} onPress={() => setShowLang(true)}>
          <Ionicons name="language" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>{t('settings.language', language.code)}</Text>
            <Text style={styles.rowValue}>{language.native} · {language.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable testID="pick-state" style={styles.row} onPress={() => router.push('/state')}>
          <Ionicons name="location-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>{t('settings.state', language.code)}</Text>
            <Text style={styles.rowValue}>
              {user?.state_name
                ? `${user.state_name} · local rent, liquor and fine rules added`
                : 'Not set · tap to get rules that apply where you live'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        <View style={styles.row} testID="row-auto-speak">
          <Ionicons name="volume-high-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>Answers spoken aloud automatically</Text>
            <Text style={styles.rowValue}>
              {autoSpeak ? 'On · replies read aloud after they finish' : 'Off · tap the speaker to hear a reply'}
            </Text>
          </View>
          <Switch
            testID="auto-speak-switch"
            value={autoSpeak}
            onValueChange={setAutoSpeak}
            trackColor={{ true: theme.colors.brandSecondary, false: theme.colors.borderStrong }}
            thumbColor={theme.colors.surface}
          />
        </View>

        {pushState !== 'unsupported' && (
          <>
          <View style={styles.row} testID="row-push-notifications">
            <Ionicons name="notifications-outline" size={22} color={theme.colors.brand} />
            <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
              <Text style={styles.rowTitle}>Push notifications</Text>
              <Text style={styles.rowValue}>
                {pushState === 'granted'
                  ? 'On · reminders about free questions and law updates'
                  : pushState === 'denied'
                  ? 'Off · blocked in phone Settings'
                  : 'Off · get reminders about free questions and law updates'}
              </Text>
            </View>
            <Switch
              testID="push-notifications-switch"
              value={pushState === 'granted'}
              onValueChange={onTogglePush}
              trackColor={{ true: theme.colors.brandSecondary, false: theme.colors.borderStrong }}
              thumbColor={theme.colors.surface}
            />
          </View>
          {pushState === 'granted' && (
            <Pressable
              testID="row-push-selftest"
              style={styles.row}
              onPress={onSendTestPush}
              disabled={pushTestBusy}
            >
              <Ionicons name="paper-plane-outline" size={22} color={theme.colors.brand} />
              <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                <Text style={styles.rowTitle}>Send test notification</Text>
                <Text style={styles.rowValue}>
                  Round-trip check via the push relay. Works only on real Android/iOS builds — not Expo Go or web.
                </Text>
              </View>
              {pushTestBusy
                ? <ActivityIndicator color={theme.colors.brand} />
                : <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceSecondary} />}
            </Pressable>
          )}
          </>
        )}

        <View style={styles.volumeCard} testID="row-tts-volume">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Ionicons
              name={ttsVolume === 0 ? 'volume-mute-outline' : ttsVolume < 0.5 ? 'volume-low-outline' : 'volume-high-outline'}
              size={22}
              color={theme.colors.brand}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Speaker volume</Text>
              <Text style={styles.rowValue}>How loud spoken answers play — {Math.round(ttsVolume * 100)}%</Text>
            </View>
          </View>
          <Slider
            testID="tts-volume-slider"
            style={{ width: '100%', height: 36, marginTop: theme.spacing.sm }}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={ttsVolume}
            onSlidingComplete={setTtsVolume}
            minimumTrackTintColor={theme.colors.brandSecondary}
            maximumTrackTintColor={theme.colors.borderStrong}
            thumbTintColor={theme.colors.brand}
          />
        </View>

        {/* ── Voice accent ────────────────────────────────────────────── */}
        <View style={styles.volumeCard} testID="row-voice-mode">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.md }}>
            <Ionicons name="mic-outline" size={22} color={theme.colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Voice accent</Text>
              <Text style={styles.rowValue}>Choose the accent used for spoken answers</Text>
            </View>
          </View>
          {(
            [
              { key: 'cloud',         label: 'Cloud TTS',      sub: 'High quality · uses credits', icon: 'cloud-outline' },
              { key: 'device-female', label: 'Device · Female', sub: 'Free · Indian accent (en-IN)', icon: 'woman-outline' },
              { key: 'device-male',   label: 'Device · Male',   sub: 'Free · Indian accent (en-IN)', icon: 'man-outline'   },
            ] as { key: TtsVoiceMode; label: string; sub: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[]
          ).map(({ key, label, sub, icon }) => (
            <Pressable
              key={key}
              testID={`voice-mode-${key}`}
              style={[styles.voiceModeRow, ttsVoiceMode === key && styles.voiceModeRowActive]}
              onPress={() => setTtsVoiceMode(key)}
            >
              <Ionicons
                name={icon}
                size={18}
                color={ttsVoiceMode === key ? theme.colors.onBrandPrimary : theme.colors.brand}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.voiceModeLabel, ttsVoiceMode === key && styles.voiceModeLabelActive]}>{label}</Text>
                <Text style={[styles.voiceModeSub, ttsVoiceMode === key && styles.voiceModeSubActive]}>{sub}</Text>
              </View>
              {ttsVoiceMode === key && (
                <Ionicons name="checkmark-circle" size={18} color={theme.colors.onBrandPrimary} />
              )}
            </Pressable>
          ))}
        </View>

        <Text style={styles.section}>Today&apos;s free usage</Text>
        <View style={styles.helpCard} testID="usage-card">
          {user?.is_pro ? (
            <View style={[styles.helpRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.helpLabel}>Daily questions</Text>
              <View style={[styles.helpNumBadge, { backgroundColor: theme.colors.brandTertiary }]}>
                <Text style={[styles.helpNum, { color: theme.colors.onBrandPrimary }]}>Unlimited · Pro</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.helpRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.helpLabel}>Questions left today (voice + text)</Text>
              <View style={styles.helpNumBadge}>
                <Text style={styles.helpNum}>
                  {user?.daily_queries_left ?? user?.daily_questions_left ?? '—'} / {user?.daily_queries_cap ?? user?.daily_questions_cap ?? 30}
                </Text>
              </View>
            </View>
          )}
        </View>

        <Text style={styles.section}>Tools</Text>

        <Pressable testID="profile-saved-answers" style={styles.row} onPress={() => router.push('/(tabs)/saved')}>
          <Ionicons name="bookmark-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Saved answers</Text><Text style={styles.rowSub}>Read your bookmarked legal information</Text></View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceSecondary} />
        </Pressable>
        <Pressable testID="profile-complaints" style={styles.row} onPress={() => router.push('/(tabs)/complaints')}>
          <Ionicons name="document-text-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Your complaints</Text><Text style={styles.rowSub}>Continue reports and view completed drafts</Text></View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceSecondary} />
        </Pressable>
        <Pressable testID="profile-legal-lookup" style={styles.row} onPress={() => router.push('/(tabs)/discover')}>
          <Ionicons name="search-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Legal lookup</Text><Text style={styles.rowSub}>Search sections and official sources</Text></View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceSecondary} />
        </Pressable>
        <Pressable testID="profile-chat-history" style={styles.row} onPress={() => router.push('/(tabs)/history')}>
          <Ionicons name="time-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Chat history</Text><Text style={styles.rowSub}>Revisit your conversations</Text></View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceSecondary} />
        </Pressable>
        <Pressable testID="open-drafts" style={styles.row} onPress={() => router.push('/drafts')}>
          <Ionicons name="document-text-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>Ready notices</Text>
            <Text style={styles.rowValue}>
              Cheque bounce · deposit refund · unpaid salary
              {user?.is_pro ? ' · unlimited' : ` · ${user?.drafts_remaining ?? 1} free left`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable testID="open-fraud-checklist" style={styles.row} onPress={() => router.push('/fraud-checklist')}>
          <Ionicons name="shield-half-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>Cyber fraud golden hour</Text>
            <Text style={styles.rowValue}>Timed checklist · call 1930 · free for everyone</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>Emergency Helplines</Text>

        {/* The red SOS button lives here on the Settings tab. It opens the
            one-tap dialer sheet for every national helpline. */}
        <View style={styles.sosRow} testID="sos-row">
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Emergency SOS</Text>
            <Text style={styles.rowValue}>One tap to call 112, police, women or child helpline</Text>
          </View>
          <SOSButton variant="floating" inline />
        </View>
        <View style={styles.helpCard}>
          <HelpRow label="Police" number="112" />
          <HelpRow label="Cyber Fraud (report fast)" number="1930" />
          <HelpRow label="Women's Helpline" number="181" />
          <HelpRow label="Legal Aid (NALSA)" number="15100" />
          <HelpRow label="Child Helpline" number="1098" />
          <HelpRow label="Human Rights Commission" number="14433" />
        </View>

        <Text style={styles.section}>Legal</Text>

        {/* Data & Privacy — DPDP compliance notice (below Account, above About) */}
        <Pressable
          testID="data-privacy-btn"
          style={styles.row}
          onPress={() => router.push('/settings/data-privacy' as any)}
        >
          <Ionicons name="shield-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>Data &amp; Privacy</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable testID="view-terms" style={styles.row} onPress={() => setShowTerms(true)}>
          <Ionicons name="document-text-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>Terms & Conditions</Text>
            <Text style={styles.rowValue}>Accepted v{user?.terms_version || '1.0'}{user?.terms_accepted_at ? ' · ' + new Date(user.terms_accepted_at).toLocaleDateString() : ''}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        {/* P0-Fix4: Privacy choices row */}
        <Pressable style={styles.row} onPress={() => router.push('/consent?mode=update' as any)}>
          <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>Privacy Choices</Text>
            <Text style={styles.rowValue}>Manage analytics & update preferences</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        {/* Phase 2: My Data portal — DPDP §17 / T&C v2.0 clause 10.3 */}
        <Pressable testID="my-data-button" style={styles.row} onPress={() => router.push('/my-data' as any)}>
          <Ionicons name="person-circle-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>My Data</Text>
            <Text style={styles.rowValue}>View, export, or delete your stored data</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        {/* Phase 2: Privacy Concern / Grievance — DPDP Ch. IV */}
        <Pressable testID="grievance-button" style={styles.row} onPress={() => router.push('/grievance' as any)}>
          <Ionicons name="flag-outline" size={22} color={theme.colors.brand} />
          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <Text style={styles.rowTitle}>Privacy Concern</Text>
            <Text style={styles.rowValue}>Raise a data access, correction, or deletion request</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>About</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutText}>
            {'Dhara is a free civic empowerment tool. \u201CDhara\u201D (धारा) means a section of law in Hindi — for every Indian citizen to know the exact section of the Bharatiya Nyaya Sanhita (BNS), the Constitution of India, and other laws that protects them.'}
            {'\n\n'}सत्य • अहिंसा • अधिकार{'\n\n'}
            Note: Dhara provides legal information — not legal advice. For serious matters, consult a lawyer or contact NALSA (15100) for free legal aid.
          </Text>
        </View>

        <View testID="copyright-block" style={styles.copyBlock}>
          <Text style={styles.copyLine}>© {new Date().getFullYear()} MSafe Solutions Inc.</Text>
          <Text style={styles.copySub}>Calviltech Digital Solutions Pvt Ltd · All rights reserved</Text>
        </View>

        <Pressable testID="logout-button" style={styles.logoutBtn} onPress={confirmLogout}>
          <Ionicons name="log-out-outline" size={20} color={theme.colors.error} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.section}>Danger Zone</Text>
        <Pressable testID="delete-account-button" style={styles.deleteBtn} onPress={openDeleteModal}>
          <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
          <Text style={styles.logoutText}>Delete my account</Text>
        </Pressable>
        <Text style={styles.deleteHint}>
          Permanently erases your account, chat history, bookmarks and drafts. This cannot be undone.
        </Text>
      </ScrollView>

      <PickerModal
        testID="lang-modal"
        visible={showLang}
        title="Choose language"
        onClose={() => setShowLang(false)}
        items={langs.map(l => ({ id: l.code, label: `${l.native} · ${l.name}`, data: l }))}
        selectedId={language.code}
        onSelect={(item) => {
          setLanguage(item.data);
          setShowLang(false);
          flashLangConfirm(item.data.native);
        }}
      />

      {/* Language-change confirmation toast */}
      {langConfirm !== null && (
        <Animated.View style={[styles.langToast, { opacity: langFadeAnim }]} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={16} color={theme.colors.onBrandPrimary} />
          <Text style={styles.langToastText}>Language set to {langConfirm}</Text>
        </Animated.View>
      )}

      <Modal visible={showTerms} animationType="slide" onRequestClose={() => setShowTerms(false)} testID="settings-terms-modal">
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }} edges={['top', 'bottom']}>
          <View style={styles.termsHeader}>
            <Text style={styles.termsHeaderTitle}>Terms & Conditions</Text>
            <Pressable testID="close-settings-terms" onPress={() => setShowTerms(false)} hitSlop={10}>
              <Ionicons name="close" size={28} color={theme.colors.onBrandPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
            <Text style={styles.termsBody}>{termsText}</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={showDeleteModal}
        transparent
        animationType="slide"
        onRequestClose={() => (deleteLoading ? null : setShowDeleteModal(false))}
        testID="delete-account-modal"
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => (deleteLoading ? null : setShowDeleteModal(false))}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="warning" size={20} color={theme.colors.error} />
              <Text style={[styles.sheetTitle, { color: theme.colors.error, marginBottom: 0 }]}>Delete account</Text>
            </View>
            <Text style={styles.deleteModalBody}>
              This permanently deletes your account, chat history, bookmarks, drafts and usage
              data. This cannot be undone. Enter your password to confirm.
            </Text>
            <TextInput
              testID="delete-password-input"
              style={styles.deletePasswordInput}
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder="Your password"
              placeholderTextColor={theme.colors.onSurfaceTertiary}
              secureTextEntry
              editable={!deleteLoading}
            />
            {!!deleteError && (
              <Text style={styles.error} testID="delete-account-error">{deleteError}</Text>
            )}
            <Pressable
              testID="confirm-delete-account-button"
              style={[styles.dangerConfirmBtn, deleteLoading && { opacity: 0.6 }]}
              disabled={deleteLoading}
              onPress={submitDeleteAccount}
            >
              {deleteLoading ? (
                <ActivityIndicator color={theme.colors.onBrandPrimary} />
              ) : (
                <Text style={styles.btnText}>Permanently delete my account</Text>
              )}
            </Pressable>
            <Pressable
              testID="cancel-delete-account-button"
              style={styles.cancelDeleteBtn}
              disabled={deleteLoading}
              onPress={() => setShowDeleteModal(false)}
            >
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function HelpRow({ label, number }: { label: string; number: string }) {
  return (
    <View style={styles.helpRow} testID={`help-${number}`}>
      <Text style={styles.helpLabel}>{label}</Text>
      <View style={styles.helpNumBadge}><Text style={styles.helpNum}>{number}</Text></View>
    </View>
  );
}

function PickerModal({ visible, title, onClose, items, selectedId, onSelect, testID }: any) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID={testID}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 500 }}>
            {items.map((it: any) => (
              <Pressable
                key={it.id}
                testID={`opt-${it.id}`}
                style={[styles.opt, selectedId === it.id && styles.optSel]}
                onPress={() => onSelect(it)}
              >
                <Text style={[styles.optText, selectedId === it.id && styles.optTextSel]}>{it.label}</Text>
                {selectedId === it.id && <Ionicons name="checkmark-circle" size={22} color={theme.colors.brand} />}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  header: { padding: theme.spacing.xl, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  h1: { fontFamily: theme.fonts.display, fontSize: 28, color: theme.colors.brand, fontWeight: '700' },
  h2: { color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl },
  profile: { flexDirection: 'row', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.brand, borderRadius: theme.radius.lg },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.brandSecondary, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: theme.colors.onBrandSecondary, fontWeight: '700', fontSize: 22 },
  name: { color: theme.colors.onBrandPrimary, fontSize: 17, fontWeight: '700' },
  email: { color: '#D1D5DB', marginTop: 2, fontSize: 13 },
  section: { fontFamily: theme.fonts.display, fontSize: 16, color: theme.colors.brand, marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
  volumeCard: { padding: theme.spacing.lg, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
  voiceModeRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, marginBottom: 6,
  },
  voiceModeRowActive: {
    backgroundColor: theme.colors.brand, borderColor: theme.colors.brand,
  },
  voiceModeLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.onSurface },
  voiceModeLabelActive: { color: theme.colors.onBrandPrimary },
  voiceModeSub: { fontSize: 12, color: theme.colors.onSurfaceSecondary, marginTop: 2 },
  voiceModeSubActive: { color: 'rgba(255,255,255,0.75)' },
  rowTitle: { color: theme.colors.onSurface, fontWeight: '600' },
  rowSub: { color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
  rowValue: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  sosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    minHeight: 64,
  },
  helpCard: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  helpRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
  helpLabel: { color: theme.colors.onSurface, fontSize: 15 },
  helpNumBadge: { backgroundColor: theme.colors.brandSecondary, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderRadius: theme.radius.pill },
  helpNum: { color: theme.colors.onBrandSecondary, fontWeight: '700' },
  aboutCard: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  aboutText: { color: theme.colors.onSurfaceSecondary, lineHeight: 22, fontSize: 13 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: theme.spacing.lg, marginTop: theme.spacing.xl, borderWidth: 1, borderColor: theme.colors.error, borderRadius: theme.radius.md },
  logoutText: { color: theme.colors.error, fontWeight: '700' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: theme.spacing.lg, marginTop: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border },
  deleteHint: { color: theme.colors.onSurfaceTertiary, fontSize: 12, marginTop: theme.spacing.sm, textAlign: 'center', paddingHorizontal: theme.spacing.md },
  deleteModalBody: { color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, marginTop: theme.spacing.md, marginBottom: theme.spacing.lg },
  deletePasswordInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  dangerConfirmBtn: {
    backgroundColor: theme.colors.error,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    marginTop: theme.spacing.lg,
    minHeight: 52,
  },
  cancelDeleteBtn: { alignItems: 'center', paddingVertical: theme.spacing.md, minHeight: 44 },
  link: { color: theme.colors.onSurfaceSecondary, fontSize: 15, fontWeight: '600' },
  copyBlock: { alignItems: 'center', marginTop: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  copyLine: { color: theme.colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  copySub: { color: theme.colors.onSurfaceTertiary, fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: theme.colors.brandSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill },
  proBadgeText: { color: theme.colors.onBrandSecondary, fontSize: 9, fontWeight: '800' },
  upsell: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.brandSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginTop: theme.spacing.md },
  upsellTitle: { color: theme.colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
  upsellSub: { color: '#FDE8DA', fontSize: 12, marginTop: 2 },
  termsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.brand },
  termsHeaderTitle: { color: theme.colors.onBrandPrimary, fontFamily: theme.fonts.display, fontSize: 20, fontWeight: '700' },
  termsBody: { color: theme.colors.onSurface, fontSize: 13, lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg, padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: 'center', marginBottom: theme.spacing.md },
  sheetTitle: { fontFamily: theme.fonts.display, fontSize: 20, color: theme.colors.brand, marginBottom: theme.spacing.md, fontWeight: '700' },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.md, marginBottom: 4 },
  optSel: { backgroundColor: theme.colors.surfaceSecondary },
  optText: { color: theme.colors.onSurface, fontSize: 15 },
  optTextSel: { color: theme.colors.brand, fontWeight: '700' },
  langToast: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  langToastText: { color: theme.colors.onBrandPrimary, fontSize: 13, fontWeight: '600' },
  error: { color: theme.colors.error, marginTop: theme.spacing.md, fontSize: 13, fontWeight: '600' },
  btnText: { color: theme.colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
