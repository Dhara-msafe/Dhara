import { StyleSheet } from 'react-native';
import { theme } from './theme';
// NF-UI-REV-12 (Group J, DHARA UI Revision v2.2.1): presentation-only
// rollback flag. No consent-logic changes.
import { UI_REVISION_V1 } from './designRevision';
import { v22SectionLabel } from './v22SectionLabel';

const colors = theme.colors;
export const consentStyles = StyleSheet.create({
  // ── Layout ─────────────────────────────────────────────────────────────────
  safe: { flex: 1, backgroundColor: colors.cream },
  scroll: { flex: 1, minHeight: 0 },
  content: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 680, alignSelf: 'center' },

  // ── Title area ─────────────────────────────────────────────────────────────
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  logoBox: { width: 40, height: 40 },
  stepEyebrow: v22SectionLabel({
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  }),
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 24,
    color: colors.navy,
    marginBottom: 10,
  },
  intro: { fontSize: 14, color: colors.muted, lineHeight: 21, marginBottom: 20 },

  // ── Section labels (eyebrow style) ────────────────────────────────────────
  sectionLabel: v22SectionLabel({
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 10,
  }),
  sectionHeading: { fontSize: 16, fontWeight: '700', color: colors.navy, marginTop: 18, marginBottom: 12 },

  // ── Checkbox-style rows (required items) ──────────────────────────────────
  // Visually: white card, full-width tap target, border highlights when checked
  checkCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: '#C9BFA6',
    borderRadius: 14,
    padding: 14,
    minHeight: 54,
    marginBottom: 10,
  },
  checkCardSelected: {
    borderColor: colors.verifiedGreen,
    backgroundColor: '#F1F8F4',
  },
  checkBoxIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    flexShrink: 0,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCardBody: { flex: 1 },
  checkCardTitle: {
    fontFamily: theme.fonts.bodySemiBold,
    fontSize: 13,
    color: colors.navy,
    lineHeight: 19,
  },
  checkCardSub: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginTop: 2,
  },

  // ── Legacy radio / check styles kept for compatibility ────────────────────
  bodyText: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 20 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  bulletText: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 20 },
  infoBox: { backgroundColor: colors.surfaceSecondary, borderRadius: 10, borderWidth: 1, borderColor: colors.divider, padding: 14, marginTop: 16 },
  infoText: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 19 },
  radioGroup: { gap: 12 },
  radioBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 16, minHeight: 50 },
  radioSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceSecondary },
  radioLabel: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.onSurface, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 48, paddingVertical: 12 },
  checkLabel: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 20 },
  termsLink: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 12 },
  linkText: { flexShrink: 1, fontSize: 13, lineHeight: 19, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },

  // ── Optional section ──────────────────────────────────────────────────────
  optionalHeading: v22SectionLabel({
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.muted,
    marginBottom: 10,
  }),
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingVertical: 12, gap: 16, borderBottomWidth: 1, borderBottomColor: colors.divider },
  toggleLabel: { flex: 1, fontSize: 13, lineHeight: 20, color: colors.onSurfaceSecondary },

  // ── "You get a record" card ───────────────────────────────────────────────
  recordCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.lines,
    borderRadius: 14,
    padding: 14,
    marginTop: 20,
  },
  recordCardText: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 19,
  },
  recordCardBold: {
    fontFamily: theme.fonts.bodyBold,
    color: colors.navy,
  },

  // ── DPDP / Pending legal review note ──────────────────────────────────────
  pendingNote: {
    backgroundColor: '#F1ECDD',
    borderWidth: 1.5,
    borderColor: '#E0D5B8',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  pendingNoteText: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  pendingNoteBold: {
    fontFamily: theme.fonts.bodyBold,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: { flexShrink: 0, padding: 16, gap: 10, borderTopWidth: 1, borderColor: colors.divider, backgroundColor: colors.cream },
  guidance: { fontSize: 12, lineHeight: 17, color: colors.onSurfaceSecondary, textAlign: 'center' },
  nothingSavedNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  error: { fontSize: 13, lineHeight: 18, color: colors.error },
  continueBtn: { backgroundColor: colors.navy, borderRadius: 16, minHeight: 54, padding: 14, alignItems: 'center', justifyContent: 'center' },
  continueDisabled: { backgroundColor: '#E3DDCD' },
  continueText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  disabledText: {
    // NF-UI-REV-12: onSurfaceTertiary on the disabled button's 'divider'
    // background measured ~3.79:1 — under 4.5:1. onSurfaceSecondary clears ~5.7:1.
    color: UI_REVISION_V1 ? colors.onSurfaceSecondary : colors.onSurfaceTertiary,
  },
  note: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceTertiary, marginTop: 16 },
  pressed: { opacity: 0.75 },
  helpButtons: { gap: 8, marginTop: 12 },
  helpButton: { minHeight: 44, justifyContent: 'center' },
});