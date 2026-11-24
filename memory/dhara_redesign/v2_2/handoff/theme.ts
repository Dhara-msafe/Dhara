// REFERENCE ONLY. Not tested application code.
// Assumptions (UNVERIFIED): React Native with Expo; versions unknown until the repository is inspected.
// Map these onto the app's existing theme mechanism rather than adding a new one.
export const colors = {
  cream: '#FBF7EE', ink: '#17212B', muted: '#505B68', navy: '#14365A', navyDeep: '#0E2740',
  gold: '#D3B675', goldText: '#8A6A1E', goldTextStrong: '#6B4F10', line: '#E7DFCC', card: '#FFFFFF',
  sand: '#F1ECDD', red: '#B42318', redDeep: '#7F1D1D', green: '#1F6B4A', greenBg: '#F1F8F4', redBg: '#FDF0EE',
} as const;
export const semantic = {
  agreed: { fg: '#14522F', bg: '#E3F1E9' }, notGiven: { fg: '#3A444F', bg: '#ECE7DA' },
  withdrawn: { fg: '#7F1D1D', bg: '#FDF0EE' }, pending: { fg: '#6B4F10', bg: '#F6EFD9' },
  error: { fg: '#7F1D1D', bg: '#FDF0EE' }, disabled: { fg: '#505B68', bg: '#E3DDCD' }, focusRing: '#14365A',
} as const;
export const typography = {
  headingFamily: 'Fraunces', bodyFamily: 'Hind',
  size: { body: 16, small: 14, caption: 13, h1: 28, h2: 22, button: 17 },
  lineHeight: { body: 1.4, heading: 1.15 },
} as const;
export const spacing = [4, 8, 10, 12, 14, 16, 20, 24, 28] as const;
export const radius = { card: 14, cardLg: 16, button: 16, pill: 999, screen: 28 } as const;
export const minTouchTarget = 48;
export const breakpoints = { tablet: 768, desktop: 1100 } as const;
