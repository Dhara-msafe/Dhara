/**
 * Guardian screen — PR-1B full
 * ─────────────────────────────
 * Opens via the dhara://guardian/{token} deep link or direct navigation.
 *
 * Auth gate: viewer must be signed in to see any journey data.
 * Gate A:    viewer must be an accepted trusted_circle_link recipient for
 *            the specific journey identified by this token.
 * Gate B:    accepted recipients receive HISTORICAL_ONLY access —
 *            traveller name, destination, timestamps, status.
 *            No live coordinates or area name at this level.
 *
 * Token hardening:
 *  - 410 → expired link
 *  - 403 → not authorized
 *  - 404 → journey not found
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useAuth } from '@/src/auth';
import { API_BASE } from '@/src/apiBase';

const c = theme.colors;

// ── Types ─────────────────────────────────────────────────────────────────────

type GuardianData =
  | {
      kind: 'active';
      access_level: string;
      traveller_display: string;
      destination: string;
      started_at: string;
      expected_checkin_at: string;
      status: 'in_progress';
      safe_at: null;
    }
  | {
      kind: 'closed';
      access_level: string;
      traveller_display: string;
      status: 'safe' | string;
      closed_at: string | null;
    };

type ScreenState =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  | { phase: 'error'; code: 403 | 404 | 410 | 0; message: string }
  | { phase: 'data'; data: GuardianData };

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return iso.slice(0, 16); }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GuardianScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { token: authToken } = useAuth() as any;

  const [state, setState] = useState<ScreenState>({ phase: 'loading' });

  const fetchJourney = useCallback(async () => {
    if (!authToken) {
      setState({ phase: 'unauthenticated' });
      return;
    }
    setState({ phase: 'loading' });
    try {
      const resp = await fetch(`${API_BASE}/api/journey/${token}/guardian`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (resp.status === 410) {
        setState({ phase: 'error', code: 410, message: 'This journey link has expired (links are valid for 24 hours).' });
        return;
      }
      if (resp.status === 404) {
        setState({ phase: 'error', code: 404, message: 'Journey not found. This link may no longer exist.' });
        return;
      }
      if (resp.status === 403) {
        setState({ phase: 'error', code: 403, message: 'You are not listed as a trusted recipient for this journey.' });
        return;
      }
      if (!resp.ok) {
        setState({ phase: 'error', code: 0, message: 'Could not load journey details. Please try again.' });
        return;
      }

      const json = await resp.json();
      if (json.status === 'in_progress') {
        setState({
          phase: 'data',
          data: { kind: 'active', ...json },
        });
      } else {
        setState({
          phase: 'data',
          data: { kind: 'closed', ...json },
        });
      }
    } catch {
      setState({ phase: 'error', code: 0, message: 'Could not reach server. Please check your connection.' });
    }
  }, [authToken, token]);

  useEffect(() => {
    if (authToken === undefined) return; // auth not yet resolved
    if (!authToken) {
      setState({ phase: 'unauthenticated' });
      return;
    }
    fetchJourney();
  }, [authToken, fetchJourney]);

  // ── Render ────────────────────────────────────────────────────────────────

  const renderBody = () => {
    switch (state.phase) {

      case 'loading':
        return (
          <View style={styles.centeredBlock}>
            <ActivityIndicator size="large" color={c.navy} />
            <Text style={styles.loadingTxt}>Loading journey details…</Text>
          </View>
        );

      case 'unauthenticated':
        return (
          <View style={styles.centeredBlock} testID="guardian-unauthenticated">
            <View style={styles.iconWrap}>
              <Ionicons name="lock-closed-outline" size={40} color={c.navy} />
            </View>
            <Text style={styles.cardTitle}>Sign in to view</Text>
            <Text style={styles.cardBody}>
              This is a private journey link. Sign in to DHARA to see the details shared with you.
            </Text>
            <Pressable
              testID="guardian-signin-btn"
              style={styles.primaryBtn}
              onPress={() => router.push('/login')}
              accessibilityRole="button"
              accessibilityLabel="Sign in to DHARA"
            >
              <Ionicons name="person-circle-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnTxt}>Sign in to DHARA</Text>
            </Pressable>
          </View>
        );

      case 'error':
        return (
          <View style={styles.centeredBlock} testID={`guardian-error-${state.code}`}>
            <View style={styles.iconWrap}>
              <Ionicons
                name={state.code === 410 ? 'time-outline' : state.code === 403 ? 'shield-outline' : 'alert-circle-outline'}
                size={40}
                color={state.code === 403 ? c.emergencyRed : c.darkGold}
              />
            </View>
            <Text style={styles.cardTitle}>
              {state.code === 410 ? 'Link expired' : state.code === 403 ? 'Not authorized' : 'Journey not found'}
            </Text>
            <Text style={styles.cardBody}>{state.message}</Text>
            {state.code === 0 && (
              <Pressable style={styles.outlineBtn} onPress={fetchJourney} accessibilityRole="button">
                <Ionicons name="refresh-outline" size={16} color={c.navy} />
                <Text style={styles.outlineBtnTxt}>Try again</Text>
              </Pressable>
            )}
          </View>
        );

      case 'data': {
        const { data } = state;

        if (data.kind === 'closed') {
          const isSafe = data.status === 'safe';
          return (
            <View
              testID="guardian-closed-card"
              style={[styles.journeyCard, isSafe ? styles.cardSafe : styles.cardRevoked]}
            >
              <View style={styles.cardHeaderRow}>
                <Ionicons
                  name={isSafe ? 'checkmark-circle' : 'information-circle-outline'}
                  size={28}
                  color={isSafe ? c.verifiedGreen : c.muted}
                />
                <Text style={[styles.cardStatusLabel, isSafe && styles.safeTxt]}>
                  {isSafe ? 'Arrived safely' : 'Sharing has ended'}
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Traveller</Text>
              <Text style={styles.fieldValue}>{data.traveller_display || '—'}</Text>

              {data.closed_at && (
                <>
                  <Text style={styles.fieldLabel}>{isSafe ? 'Marked safe at' : 'Sharing ended at'}</Text>
                  <Text style={styles.fieldValue}>{_fmt(data.closed_at)}</Text>
                </>
              )}

              <Text style={styles.disclosureNote}>
                {isSafe
                  ? 'The traveller confirmed they arrived safely. No further updates will be shared.'
                  : 'Location sharing for this journey has been withdrawn.'}
              </Text>
            </View>
          );
        }

        // Active journey — HISTORICAL_ONLY
        return (
          <View testID="guardian-active-card" style={styles.journeyCard}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="navigate-circle-outline" size={28} color={c.navy} />
              <Text style={styles.cardStatusLabel}>Journey in progress</Text>
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Traveller</Text>
              <Text style={styles.fieldValue}>{data.traveller_display || '—'}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Destination</Text>
              <Text style={styles.fieldValue}>{data.destination || '—'}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Journey started</Text>
              <Text style={styles.fieldValue}>{_fmt(data.started_at)}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Expected check-in by</Text>
              <Text style={styles.fieldValue}>{_fmt(data.expected_checkin_at)}</Text>
            </View>

            <Pressable
              style={styles.outlineBtn}
              onPress={fetchJourney}
              accessibilityRole="button"
              accessibilityLabel="Refresh journey status"
            >
              <Ionicons name="refresh-outline" size={16} color={c.navy} />
              <Text style={styles.outlineBtnTxt}>Refresh</Text>
            </Pressable>

            <Text style={styles.disclosureNote}>
              You can see this journey because {data.traveller_display} added you to their trusted circle.
            </Text>
          </View>
        );
      }
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      testID="guardian-screen"
    >
      <ScreenHeader
        title="Guardian view"
        subtitle="Journey details shared with you"
      />
      {renderBody()}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: c.background },
  content:        { padding: 20, gap: 16 },

  centeredBlock: {
    backgroundColor: c.surface, borderRadius: 18, borderWidth: 1,
    borderColor: c.lines, padding: 28, alignItems: 'center', gap: 12,
  },
  iconWrap:   { marginBottom: 4 },
  loadingTxt: { fontFamily: theme.fonts.body, fontSize: 15, color: c.muted, marginTop: 8 },
  cardTitle:  { fontFamily: theme.fonts.displayBold, fontSize: 20, color: c.ink, textAlign: 'center' },
  cardBody:   { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, textAlign: 'center', lineHeight: 20 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.navy, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 24, marginTop: 4,
  },
  primaryBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },

  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: c.navy, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 20, alignSelf: 'center', marginTop: 8,
  },
  outlineBtnTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.navy },

  journeyCard: {
    backgroundColor: c.surface, borderRadius: 18, borderWidth: 1,
    borderColor: c.lines, padding: 20, gap: 4,
  },
  cardSafe:    { borderColor: c.verifiedGreen, backgroundColor: '#F0FAF4' },
  cardRevoked: { borderColor: c.lines },

  cardHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
  },
  cardStatusLabel: {
    fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.navy,
  },
  safeTxt: { color: c.verifiedGreen },

  fieldRow:   { gap: 2, marginVertical: 2 },
  fieldLabel: {
    fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.muted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  fieldValue: { fontFamily: theme.fonts.bodyMedium, fontSize: 16, color: c.ink },

  divider: { height: 1, backgroundColor: c.lines, marginVertical: 8 },

  disclosureNote: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    lineHeight: 17, marginTop: 12, textAlign: 'center',
  },
});
