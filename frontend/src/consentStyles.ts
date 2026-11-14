import { StyleSheet } from 'react-native';
import { theme } from './theme';
// NF-UI-REV-12 (Group J, DHARA UI Revision v2.2.1): presentation-only
// rollback flag. No consent-logic changes.
import { UI_REVISION_V1 } from './designRevision';

const colors = theme.colors;
export const consentStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  scroll: { flex: 1, minHeight: 0 },
  content: { padding: 20, paddingBottom: 32, width: '100%', maxWidth: 680, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  logoBox: { width: 44, height: 44 },
  title: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.primary },
  intro: { fontSize: 16, color: colors.onSurfaceSecondary, lineHeight: 24, marginBottom: 16 },
  sectionHeading: { fontSize: 18, fontWeight: '700', color: colors.primary, marginTop: 28, marginBottom: 12 },
  bodyText: { fontSize: 15, color: colors.onSurfaceSecondary, lineHeight: 23 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  bulletText: { flex: 1, fontSize: 15, color: colors.onSurfaceSecondary, lineHeight: 23 },
  infoBox: { backgroundColor: colors.surfaceSecondary, borderRadius: 10, borderWidth: 1, borderColor: colors.divider, padding: 14, marginTop: 16 },
  infoText: { fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 22 },
  radioGroup: { gap: 12 },
  radioBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 16, minHeight: 56 },
  radioSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceSecondary },
  radioLabel: { flex: 1, fontSize: 16, lineHeight: 24, color: colors.onSurface, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 24 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 48, paddingVertical: 12 },
  checkLabel: { flex: 1, fontSize: 15, color: colors.onSurfaceSecondary, lineHeight: 23 },
  termsLink: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 12 },
  linkText: { flexShrink: 1, fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  optionalHeading: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingVertical: 12, gap: 16, borderBottomWidth: 1, borderBottomColor: colors.divider },
  toggleLabel: { flex: 1, fontSize: 15, lineHeight: 23, color: colors.onSurfaceSecondary },
  footer: { flexShrink: 0, padding: 16, gap: 10, borderTopWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface },
  guidance: { fontSize: 13, lineHeight: 19, color: colors.onSurfaceSecondary, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, color: colors.error },
  continueBtn: { backgroundColor: colors.primary, borderRadius: 12, minHeight: 52, padding: 14, alignItems: 'center', justifyContent: 'center' },
  continueDisabled: { backgroundColor: colors.divider },
  continueText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '700' },
  disabledText: {
    // NF-UI-REV-12: onSurfaceTertiary on the disabled button's 'divider'
    // background measured ~3.79:1 — under 4.5:1. onSurfaceSecondary clears ~5.7:1.
    color: UI_REVISION_V1 ? colors.onSurfaceSecondary : colors.onSurfaceTertiary,
  },
  note: { fontSize: 13, lineHeight: 20, color: colors.onSurfaceTertiary, marginTop: 16 },
  pressed: { opacity: 0.75 },
  helpButtons: { gap: 8, marginTop: 12 },
  helpButton: { minHeight: 44, justifyContent: 'center' },
});