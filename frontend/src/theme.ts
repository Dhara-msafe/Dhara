/**
 * DHARA design system — navy / gold / cream.
 * Redesign v3 (26 Nov 2026): colours, corners and fonts follow the approved
 * standalone.html prototype. Inter = titles and body; Fraunces = wordmark.
 * Existing keys are preserved (remapped to the new palette) so older screens
 * keep working; new screens use the semantic names (navy, cream, gold, ink…).
 */
export const theme = {
  colors: {
    // ── Core surfaces ──────────────────────────────────────────────
    background: '#FFFAF2',       // cream app background
    surface: '#FFFFFF',          // white cards
    surfaceSecondary: '#F7F1E4', // soft cream chip
    surfaceTertiary: '#EFE8D8',
    onSurface: '#102A45',        // ink
    onSurfaceSecondary: '#64788A', // muted text
    onSurfaceTertiary: '#64788A',
    surfaceInverse: '#082B4F',
    onSurfaceInverse: '#FFFFFF',

    // ── Brand navy ─────────────────────────────────────────────────
    navy: '#082B4F',
    deepNavy: '#061A30',
    brand: '#082B4F',
    brandPrimary: '#082B4F',
    onBrandPrimary: '#FFFFFF',
    brandSecondary: '#7A5B17',
    onBrandSecondary: '#FFFFFF',
    brandTertiary: '#0D436B',
    onBrandTertiary: '#FFFFFF',
    primary: '#082B4F',
    primaryMid: '#0D436B',

    // ── Gold ───────────────────────────────────────────────────────
    gold: '#E8B956',
    goldSoft: '#FCE9C5',
    goldMuted: '#FFF1D6',
    darkGold: '#7A5B17',
    onGold: '#102A45',
    accent: '#E8B956',
    accentDark: '#7A5B17',

    // ── On-navy helpers ────────────────────────────────────────────
    onNavyMuted: '#D7E5F5',
    navySoft: '#EEF3FC',
    navyOverlay: 'rgba(255,255,255,0.12)',
    shadow: 'rgba(4,23,40,0.16)',

    // ── Status ─────────────────────────────────────────────────────
    cream: '#FFFAF2',
    ink: '#102A45',
    muted: '#64788A',
    lines: '#E6DFD1',
    success: '#087951',
    successSoft: '#EDFAF2',
    verifiedGreen: '#087951',
    warning: '#7A5B17',
    error: '#C73236',
    emergencyRed: '#C73236',
    emergencyDeep: '#690F16',
    info: '#1E5BD0',

    // ── Borders ────────────────────────────────────────────────────
    border: '#E6DFD1',
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

    // ── Redesign v3 (26 Nov 2026) — values taken from the approved
    // standalone.html prototype's :root and panel/button rules. ─────────
    paper: '#FFFFFF',
    goldLight: '#FFF1D6',
    soft: '#EEF3FC',
    blue: '#1E5BD0',
    blueBg: '#EEF5FF',
    blueBorder: '#D2E1FD',
    warnBg: '#FFF4E6',
    warnBorder: '#F2D7A9',
    dangerBg: '#FFF0F0',
    dangerBorder: '#EFC7C7',
    successBg: '#EDFAF2',
    successBorder: '#BFE4D0',
    softRedBorder: '#ECB9B9',
    softRedText: '#B51B26',
    safeGreen: '#078B63',
    tileBg: '#F3F6FF',
    tileBorder: '#E4EAF6',
    fieldBorder: '#C8D6E3',
    outlineBorder: '#CAD7E4',
    sosRed: '#D84345',
    sosBorder: '#F79C9A',
    headerTagline: '#E9D5A9',
    tabInactive: '#5C7084',
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
    navy: '#082B4F',
    navyLight: '#0D436B',
    gold: '#E8B956',
    goldDark: '#7A5B17',
    cream: '#FFFAF2',
    textPrimary: '#082B4F',
    textSecondary: '#64788A',
    textOnNavy: '#FFFFFF',
    textOnNavyMuted: '#D7E5F5',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  // Redesign v3: button 12, field 11, tile 13, panel 17 (prototype values).
  radius: { sm: 8, md: 12, lg: 17, xl: 22, pill: 999, cardLg: 16, field: 11, tile: 13 },
  // Redesign v3 text scale. The prototype draws body text at 12-13; the app
  // uses 14 with nothing under 12 so it stays readable on a phone outdoors.
  type: { title: 24, greeting: 25, section: 17, panelTitle: 16, body: 14, button: 15, small: 12, eyebrow: 12, tab: 12 },
  // ── v2.2 layout tokens (design-tokens.json) ───────────────────────
  // touchTarget.min: minimum tap-target size; breakpoints: the package's
  // phone/tablet/desktop widths. Inert until later rollout phases.
  touchTarget: { min: 48 },
  breakpoints: { phone: 0, tablet: 768, desktop: 1100 },
  fonts: {
    // Redesign v3: Inter for titles and body; Fraunces only for the wordmark.
    brand: 'FrauncesBold',
    display: 'InterBold',
    displayRegular: 'InterSemiBold',
    displayBold: 'InterExtraBold',
    displayBlack: 'InterExtraBold',
    body: 'Inter',
    bodyMedium: 'InterMedium',
    bodySemiBold: 'InterSemiBold',
    bodyBold: 'InterBold',
    bodyLight: 'Inter',
  },
} as const;
