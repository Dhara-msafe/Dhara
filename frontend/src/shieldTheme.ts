/**
 * "Shield mode" — the dark palette introduced by the v2.2 design package
 * (memory/dhara_redesign/v2_2/editable_screens/) for the Shield-tools
 * screen group: Women's Shield, Silent alert, Safety phrases, Safety plan,
 * Guardian share. Gated behind UI_V22_S3 / UI_V22_S4 (see uiV22Flags.ts);
 * inert constants until a screen opts in. Values taken verbatim from the
 * design files' inline styles — not yet run through a contrast audit
 * beyond what the design package itself states.
 */
export const shieldColors = {
  // Screen background: linear-gradient(180deg, gradientTop 0%, gradientBottom 100%)
  gradientTop: '#2D1B4E',
  gradientBottom: '#1A0E30',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.78)',
  textFaint: 'rgba(255,255,255,0.6)',
  cardBg: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(255,255,255,0.1)',
  chipBg: 'rgba(255,255,255,0.1)',
  chipBorder: 'rgba(255,255,255,0.15)',
  divider: 'rgba(255,255,255,0.15)',
  tipBg: 'rgba(176,122,20,0.1)',
  tipBorder: 'rgba(176,122,20,0.2)',
  tipIcon: '#E8B956',
  sos: '#C73236',
  sosShadow: 'rgba(180,35,24,0.35)',
  // Per-step/badge accents used across the Shield-tools screens
  pink: '#E91E63',
  pinkSoft: 'rgba(233,30,99,0.15)',
  pinkSofter: 'rgba(233,30,99,0.08)',
  lavender: '#B39DDB',
  lavenderBg: '#5A4B9E',
  lavenderBgDeep: '#3D2E7E',
  gold: '#E8B956',
  goldBg: 'rgba(176,122,20,0.15)',
  rose: '#F48FB1',
  green: '#4CAF50',
  greenBg: 'rgba(31,107,74,0.15)',
} as const;

export const shieldGradient = {
  colors: [shieldColors.gradientTop, shieldColors.gradientBottom] as const,
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
};
