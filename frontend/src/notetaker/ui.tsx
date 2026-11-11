/**
 * Shared UI pieces for the Advocate Consultation Notetaker screens:
 * ScreenHeader (navy header w/ back + optional right action),
 * StatusPill (consultation state badge), and ProgressSteps (stage tracker).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { theme } from '@/src/theme';
import type { ConsultationState, InputMethod } from './api';

const c = theme.colors;

export function ScreenHeader({
  title, subtitle, onBack, right,
}: { title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={headerStyles.header}>
      <Pressable
        onPress={onBack ?? (() => router.back())}
        style={headerStyles.backBtn}
        accessibilityLabel="Go back"
        hitSlop={8}
      >
        <Text style={headerStyles.backArrow}>‹</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={headerStyles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={headerStyles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const headerStyles = StyleSheet.create({
  header: {
    backgroundColor: c.navy, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 4,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  backArrow: { color: '#fff', fontSize: 28, lineHeight: 32, marginTop: -2 },
  title: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 17 },
  subtitle: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 1 },
});

// ── Status pill ───────────────────────────────────────────────────────────

const TONES = {
  muted:   { bg: '#F4EFE3', fg: '#505B68' },
  warning: { bg: '#FEF3C7', fg: '#92400E' },
  info:    { bg: '#E7EDF4', fg: '#1D4A78' },
  success: { bg: '#E7F1EB', fg: '#1F6B4A' },
  error:   { bg: '#FEE4E2', fg: '#B42318' },
} as const;

const STATE_META: Record<ConsultationState, { label: string; tone: keyof typeof TONES }> = {
  DRAFT:              { label: 'Draft', tone: 'muted' },
  CONSENT_PENDING:    { label: 'Awaiting consent', tone: 'warning' },
  READY:              { label: 'Ready for input', tone: 'info' },
  IMPORTING:          { label: 'Uploading', tone: 'info' },
  AUDIO_REVIEW:       { label: 'Audio ready', tone: 'info' },
  PROCESSING:         { label: 'Transcribing', tone: 'info' },
  TRANSCRIPT_REVIEW:  { label: 'Reviewing transcript', tone: 'info' },
  NOTE_DRAFT:         { label: 'Drafting note', tone: 'info' },
  APPROVED:           { label: 'Approved', tone: 'success' },
  FAILED:             { label: 'Failed', tone: 'error' },
  CANCELLED:          { label: 'Cancelled', tone: 'muted' },
  INTERRUPTED:        { label: 'Interrupted', tone: 'error' },
};

export function StatusPill({ state }: { state: ConsultationState }) {
  const meta = STATE_META[state] || { label: state, tone: 'muted' as const };
  const tone = TONES[meta.tone];
  return (
    <View style={[pillStyles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[pillStyles.text, { color: tone.fg }]}>{meta.label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, alignSelf: 'flex-start' },
  text: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11 },
});

// ── Progress steps ───────────────────────────────────────────────────────

const MANUAL_STAGES = ['Consent', 'Notes', 'Draft', 'Approved'];
const REVIEW_STAGES = ['Consent', 'Input', 'Review', 'Draft', 'Approved'];

export function getStages(inputMethod: InputMethod): string[] {
  return inputMethod === 'manual' ? MANUAL_STAGES : REVIEW_STAGES;
}

export function getStageIndex(state: ConsultationState, inputMethod: InputMethod): number {
  const manual = inputMethod === 'manual';
  switch (state) {
    case 'DRAFT':
    case 'CONSENT_PENDING':
      return 0;
    case 'READY':
    case 'IMPORTING':
    case 'AUDIO_REVIEW':
    case 'PROCESSING':
      return 1;
    case 'TRANSCRIPT_REVIEW':
      return manual ? 1 : 2;
    case 'NOTE_DRAFT':
      return manual ? 2 : 3;
    case 'APPROVED':
      return manual ? 3 : 4;
    default:
      return 0;
  }
}

export function ProgressSteps({ labels, activeIndex }: { labels: string[]; activeIndex: number }) {
  return (
    <View style={stepStyles.row}>
      {labels.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <View key={label} style={stepStyles.item}>
            <View style={stepStyles.dotRow}>
              <View style={[stepStyles.dot, done && stepStyles.dotDone, active && stepStyles.dotActive]}>
                <Text style={[
                  stepStyles.dotText,
                  done && stepStyles.dotTextDone,
                  active && stepStyles.dotTextActive,
                ]}>
                  {done ? '✓' : i + 1}
                </Text>
              </View>
              {i < labels.length - 1 && (
                <View style={[stepStyles.connector, done && stepStyles.connectorActive]} />
              )}
            </View>
            <Text style={[stepStyles.label, active && stepStyles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: c.surface },
  item: { flex: 1 },
  dotRow: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: c.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: c.navy },
  dotActive: { backgroundColor: c.gold },
  dotText: { fontSize: 11, fontFamily: theme.fonts.bodySemiBold, color: c.muted },
  dotTextDone: { color: '#fff' },
  dotTextActive: { color: c.navy },
  connector: { flex: 1, height: 2, backgroundColor: c.border, marginHorizontal: 2 },
  connectorActive: { backgroundColor: c.navy },
  label: { fontSize: 10, fontFamily: theme.fonts.body, color: c.muted, marginTop: 4 },
  labelActive: { color: c.navy, fontFamily: theme.fonts.bodySemiBold },
});
