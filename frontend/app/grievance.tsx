/**
 * Privacy Concern / Grievance Screen — DPDP Act 2023 Chapter IV
 * T&C v2.0: grievance redressal within 30 days; reference ID for follow-up.
 *
 * Users can raise: data access · data correction · data deletion ·
 *                  objection to processing · data breach · other
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
// B-70: this screen used to hardcode its own "grievance@calviltech.com" with
// no officer name -- a THIRD value, different from both the consent screen
// (Varuna Moses, varuna@calviltech.com via operatorIdentity.ts) and
// my-data.tsx's own hardcoded string. Reading the single source of truth
// instead of a separately hardcoded string here.
import { grievanceOfficerName, grievanceContactEmail, isGrievanceContactPlaceholder } from '@/src/operatorIdentity';

const CATEGORIES = [
  { key: 'data_access',     label: 'Access my data',       icon: 'eye-outline',           desc: 'Request a copy of all data held about you' },
  { key: 'data_correction', label: 'Correct my data',      icon: 'create-outline',        desc: 'Request an inaccuracy to be fixed' },
  { key: 'data_deletion',   label: 'Delete my data',       icon: 'trash-outline',         desc: 'Request erasure of your personal data' },
  { key: 'objection',       label: 'Object to processing', icon: 'hand-left-outline',     desc: 'Object to how we use your information' },
  { key: 'data_breach',     label: 'Report a breach',      icon: 'warning-outline',       desc: 'Report a suspected data security incident' },
  { key: 'other',           label: 'Other concern',        icon: 'chatbubble-outline',    desc: 'Any other privacy or data-related question' },
];

interface Ticket {
  ticket_id: string;
  category: string;
  description: string;
  status: 'received' | 'acknowledged' | 'resolved';
  created_at: string;
}

export default function GrievanceScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [step, setStep] = useState<'list' | 'form' | 'success'>('list');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newTicket, setNewTicket] = useState<{ ticket_id: string; message: string } | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!token) return;
    setLoadingTickets(true);
    try {
      const res = await fetch(`${API_BASE}/api/grievance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTickets(data.tickets ?? []);
    } catch {
      // offline — show empty list
    } finally {
      setLoadingTickets(false);
    }
  }, [token]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleSubmit = async () => {
    if (!selectedCategory) {
      Alert.alert('Choose a category', 'Please select what your concern is about.');
      return;
    }
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/grievance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category: selectedCategory, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Submit failed');
      setNewTicket({ ticket_id: data.ticket_id, message: data.message });
      setStep('success');
      fetchTickets(); // refresh list
    } catch (e: any) {
      Alert.alert('Could not submit', e.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (s: string) => {
    if (s === 'resolved')     return '#15803D';
    if (s === 'acknowledged') return theme.colors.primary;
    return '#92400E'; // received
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => (step === 'form' ? setStep('list') : router.back())}
          hitSlop={8}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.brand} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {step === 'form' ? 'New Privacy Concern' : 'Privacy Concerns'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── SUCCESS ── */}
      {step === 'success' && newTicket && (
        <ScrollView contentContainerStyle={styles.centerContent}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark-circle" size={56} color="#15803D" />
          </View>
          <Text style={styles.successTitle}>Concern raised</Text>
          <View style={styles.ticketIdBox}>
            <Text style={styles.ticketIdLabel}>Reference number</Text>
            <Text style={styles.ticketIdValue}>{newTicket.ticket_id}</Text>
          </View>
          <Text style={styles.successMsg}>{newTicket.message}</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
            onPress={() => setStep('list')}
          >
            <Text style={styles.primaryBtnText}>View all tickets</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ── FORM ── */}
      {step === 'form' && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.formHeading}>What is your concern about?</Text>
          <View style={styles.categoriesGrid}>
            {CATEGORIES.map(cat => (
              <Pressable
                key={cat.key}
                style={({ pressed }) => [
                  styles.categoryCard,
                  selectedCategory === cat.key && styles.categoryCardActive,
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => setSelectedCategory(cat.key)}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={20}
                  color={selectedCategory === cat.key ? theme.colors.brand : theme.colors.onSurfaceSecondary}
                />
                <Text style={[
                  styles.categoryLabel,
                  selectedCategory === cat.key && styles.categoryLabelActive,
                ]}>
                  {cat.label}
                </Text>
                <Text style={styles.categoryDesc}>{cat.desc}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.formLabel}>Additional details (optional)</Text>
          <TextInput
            style={styles.textArea}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            maxLength={2000}
            placeholder="Describe your concern in more detail…"
            placeholderTextColor={theme.colors.onSurfaceTertiary}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{description.length}/2000</Text>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              !selectedCategory && styles.primaryBtnDisabled,
              pressed && { opacity: 0.8 },
            ]}
            onPress={handleSubmit}
            disabled={!selectedCategory || submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.primaryBtnText}>Submit concern</Text>
            }
          </Pressable>

          <Text style={styles.legalNote}>
            We will acknowledge your concern within 48 hours and aim to resolve it
            within 30 days as required under the DPDP Act 2023.
            {!isGrievanceContactPlaceholder() && ` Grievance Officer: ${grievanceOfficerName}, ${grievanceContactEmail}`}
          </Text>
        </ScrollView>
      )}

      {/* ── LIST ── */}
      {step === 'list' && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Raise new button */}
          <Pressable
            testID="new-grievance-btn"
            style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.8 }]}
            onPress={() => {
              setSelectedCategory(null);
              setDescription('');
              setStep('form');
            }}
          >
            <Ionicons name="add-circle-outline" size={20} color={theme.colors.brand} />
            <Text style={styles.newBtnText}>Raise a new concern</Text>
          </Pressable>

          {loadingTickets ? (
            <ActivityIndicator
              size="large"
              color={theme.colors.brand}
              style={{ marginTop: 40 }}
            />
          ) : tickets.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="flag-outline" size={40} color={theme.colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No concerns raised yet</Text>
              <Text style={styles.emptySub}>
                You can request access to, correction of, or deletion of your data.
                All requests are acknowledged within 48 hours.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.listHeading}>Your tickets</Text>
              {tickets.map(t => (
                <View key={t.ticket_id} style={styles.ticketCard}>
                  <View style={styles.ticketTop}>
                    <Text style={styles.ticketId}>{t.ticket_id}</Text>
                    <View style={[styles.statusBadge, { borderColor: statusColor(t.status) }]}>
                      <Text style={[styles.statusText, { color: statusColor(t.status) }]}>
                        {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.ticketCategory}>
                    {CATEGORIES.find(c => c.key === t.category)?.label ?? t.category}
                  </Text>
                  {!!t.description && (
                    <Text style={styles.ticketDesc} numberOfLines={2}>{t.description}</Text>
                  )}
                  <Text style={styles.ticketDate}>
                    {new Date(t.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
  },
  backBtn: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.onSurface },
  scroll: { flex: 1 },
  // List
  listContent: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 40 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.brand,
    borderStyle: 'dashed',
  },
  newBtnText: { fontSize: 15, fontWeight: '700', color: theme.colors.brand },
  listHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.onSurfaceTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: theme.spacing.sm,
  },
  ticketCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  ticketTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketId: { fontSize: 12, fontWeight: '700', color: theme.colors.onSurfaceSecondary },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  ticketCategory: { fontSize: 14, fontWeight: '700', color: theme.colors.onSurface },
  ticketDesc: { fontSize: 13, color: theme.colors.onSurfaceSecondary, lineHeight: 18 },
  ticketDate: { fontSize: 11, color: theme.colors.onSurfaceTertiary, marginTop: 2 },
  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: 48, gap: 12, paddingHorizontal: theme.spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.onSurface },
  emptySub: { fontSize: 13, color: theme.colors.onSurfaceSecondary, textAlign: 'center', lineHeight: 20 },
  // Form
  formContent: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 48 },
  formHeading: { fontSize: 15, fontWeight: '700', color: theme.colors.onSurface },
  categoriesGrid: { gap: 8 },
  categoryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    gap: 2,
  },
  categoryCardActive: {
    borderColor: theme.colors.brand,
    backgroundColor: 'rgba(30, 58, 138, 0.04)',
  },
  categoryLabel: { fontSize: 14, fontWeight: '700', color: theme.colors.onSurface },
  categoryLabelActive: { color: theme.colors.brand },
  categoryDesc: { fontSize: 12, color: theme.colors.onSurfaceSecondary },
  formLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.onSurfaceSecondary },
  textArea: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    fontSize: 14,
    color: theme.colors.onSurface,
    minHeight: 100,
  },
  charCount: { fontSize: 11, color: theme.colors.onSurfaceTertiary, textAlign: 'right' },
  primaryBtn: {
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  legalNote: {
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    lineHeight: 17,
    textAlign: 'center',
  },
  // Success
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  successIconWrap: { marginBottom: theme.spacing.sm },
  successTitle: { fontSize: 22, fontWeight: '800', color: theme.colors.onSurface },
  ticketIdBox: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    width: '100%',
  },
  ticketIdLabel: { fontSize: 12, color: theme.colors.onSurfaceSecondary, fontWeight: '600' },
  ticketIdValue: { fontSize: 22, fontWeight: '900', color: theme.colors.brand, letterSpacing: 1 },
  successMsg: {
    fontSize: 13,
    color: theme.colors.onSurfaceSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
