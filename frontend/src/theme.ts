/**
 * DHARA design system — navy / gold / cream (Emmy UI Redesign tokens).
 * Fraunces = display serif, Hind = body (Latin + Devanagari).
 * Existing keys are preserved (remapped to the new palette) so older screens
 * keep working; new screens use the semantic names (navy, cream, gold, ink…).
 */
export const theme = {
  colors: {
    // ── Core surfaces ──────────────────────────────────────────────
    background: '#FBF7EE',       // cream app background
    surface: '#FFFFFF',          // white cards
    surfaceSecondary: '#F4EFE3', // soft cream chip
    surfaceTertiary: '#EFE8D8',
    onSurface: '#17212B',        // ink
    onSurfaceSecondary: '#505B68', // muted text
    onSurfaceTertiary: '#6B7682',
    surfaceInverse: '#14365A',
    onSurfaceInverse: '#FFFFFF',

    // ── Brand navy ─────────────────────────────────────────────────
    navy: '#14365A',
    deepNavy: '#0E2740',
    brand: '#14365A',
    brandPrimary: '#14365A',
    onBrandPrimary: '#FFFFFF',
    brandSecondary: '#7A5B17',
    onBrandSecondary: '#FFFFFF',
    brandTertiary: '#1D4A78',
    onBrandTertiary: '#FFFFFF',
    primary: '#14365A',
    primaryMid: '#1D4A78',

    // ── Gold ───────────────────────────────────────────────────────
    gold: '#D3B675',
    goldSoft: '#EADFC2',
    goldMuted: '#F6EFDD',
    darkGold: '#7A5B17',
    onGold: '#14365A',
    accent: '#D3B675',
    accentDark: '#7A5B17',

    // ── On-navy helpers ────────────────────────────────────────────
    onNavyMuted: '#C7D2E0',
    navySoft: '#E7EDF4',
    navyOverlay: 'rgba(255,255,255,0.12)',
    shadow: 'rgba(14,39,64,0.12)',

    // ── Status ─────────────────────────────────────────────────────
    cream: '#FBF7EE',
    ink: '#17212B',
    muted: '#505B68',
    lines: '#E7DFCC',
    success: '#1F6B4A',
    successSoft: '#E7F1EB',
    verifiedGreen: '#1F6B4A',
    warning: '#7A5B17',
    error: '#B42318',
    emergencyRed: '#B42318',
    emergencyDeep: '#7A160F',
    info: '#1D4A78',

    // ── Borders ────────────────────────────────────────────────────
    border: '#E7DFCC',
    borderStrong: '#D8CCB0',
    divider: '#EFE8D8',

    // ── v2.2 package tokens (design-tokens.json, UI revision v2.2) ──
    // Added 21 Nov 2026, rollout phase 1. Additive only: nothing above
    // this line changed, and no screen consumes these yet. Later rollout
    // phases (each behind its own EXPO_PUBLIC_UI_V22_P* flag) start
    // using them; until then they are inert constants.
    goldText: '#8A6A1E',        // gold-coloured text on cream/white (4.5:1)
    goldTextStrong: '#6B4F10',  // small gold text (7:1)
    sand: '#F1ECDD',
    greenBg: '#F1F8F4',
    redBg: '#FDF0EE',
    redDeep: '#7F1D1D',
    focusRing: '#14365A',
    disabledBg: '#E3DDCD',
    disabledFg: '#505B68',
  },
  // ── v2.2 consent-state colours (design-tokens.json "semantic") ────
  // fg/bg pairs for consent chips: agreed / not given / withdrawn /
  // pending / error. Unused until the consent-settings rollout phase.
  consentState: {
    agreed: { fg: '#14522F', bg: '#E3F1E9' },
    notGiven: { fg: '#3A444F', bg: '#ECE7DA' },
    withdrawn: { fg: '#7F1D1D', bg: '#FDF0EE' },
    pending: { fg: '#6B4F10', bg: '#F6EFD9' },
    error: { fg: '#7F1D1D', bg: '#FDF0EE' },
  },
  // Compatibility aliases for auth / FIR / legal document screens.
  dhara: {
    navy: '#14365A',
    navyLight: '#1D4A78',
    gold: '#D3B675',
    goldDark: '#7A5B17',
    cream: '#FBF7EE',
    textPrimary: '#14365A',
    textSecondary: '#505B68',
    textOnNavy: '#FFFFFF',
    textOnNavyMuted: '#C7D2E0',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 8, md: 14, lg: 20, xl: 28, pill: 999, cardLg: 16 },
  // ── v2.2 layout tokens (design-tokens.json) ───────────────────────
  // touchTarget.min: minimum tap-target size; breakpoints: the package's
  // phone/tablet/desktop widths. Inert until later rollout phases.
  touchTarget: { min: 48 },
  breakpoints: { phone: 0, tablet: 768, desktop: 1100 },
  fonts: {
    // display = Fraunces serif
    display: 'FrauncesSemiBold',
    displayRegular: 'Fraunces',
    displayBold: 'FrauncesBold',
    displayBlack: 'FrauncesBlack',
    // body = Hind
    body: 'Hind',
    bodyMedium: 'HindMedium',
    bodySemiBold: 'HindSemiBold',
    bodyBold: 'HindBold',
    bodyLight: 'HindLight',
  },
} as const;
