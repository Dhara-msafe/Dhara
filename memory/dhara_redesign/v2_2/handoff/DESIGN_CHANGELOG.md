# Design changelog (v2.2 vs original)

## Global
- Faint greys (#8A94A0, #9AA3AD) replaced with #505B68 for 4.5:1 text contrast on cream.
- Low-opacity white text raised to .78 alpha minimum; gold text uses #8A6A1E or #6B4F10, never white on gold.
- Navigation buttons 44px to 48px; SOS pill 48px high, 56px wide minimum.
- Icon-only buttons given accessible names; selected states use a check or label, not colour alone.
- Reduced-motion rules added to all screens.

## Copy and capability corrections (reason: unsupported or unverifiable claims)
See COPY_AND_CAPABILITY_AUDIT.csv for each item. Highlights: "Police notified" removed; sharing and contact states only appear when the app reports them; no blanket on-device or end-to-end encryption claims; no sample ratings, cases won, verification claims or personal details; no 199/499 pricing.

## Screens
- 2 Choose language: native names first, search, selected state, clear of the sticky button.
- 4 Privacy & consent: nothing preselected; separate age, terms, processing and optional choices; pending-review note.
- 25 Emergency, 26 Record, 33 Women's Shield, 34 Silent alert, 38 Guardian share: claims removed, glow simplified, states separated.
- 28 Rights library: runtime error in the design file fixed (icon reference).
- 48 Pro: "Price to be confirmed".
- New 54-58: consent record, history, withdrawal, download, and the under-18 screen. Backend UNVERIFIED.

## Responsive references
Seven priority journeys as HTML/CSS: side rail on desktop, bottom tab bar on mobile, no promo sidebars on onboarding, consent, recording or emergency.
