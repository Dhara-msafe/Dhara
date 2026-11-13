# Accessibility and responsive check report

Run date: 2026-11-13. Method: automated DOM probes in headless Chromium (Playwright) against the design files and the 7 responsive previews. These are design-reference checks. They are not an accessibility audit of the live app and do not establish WCAG conformance.

## Performed
| Check | Scope | Result |
|---|---|---|
| Text contrast (4.5:1 normal, 3:1 large), alpha blended on solid backgrounds | 57 design screens | 9 text items remain below threshold: single letters "W" and "C" on coloured tiles in FirDraft, Notices and Rights (3.27 and 4.11); native-script letter chips in Main (3.4, 3.46); step number "1" in Notetaker (3.72, 10px); Splash footnote (4.29, 12px). Others were fixed. |
| Contrast, previews | 7 pages x 6 widths | 0 below threshold on solid backgrounds |
| Touch targets under 48px | 57 screens | 50 remain across 17 screens: StatePick (12), Settings (6), FirDraft, Rights and VisitorHelp (4 each), Circle and GuardianShare (3 each), the rest 1-2 each. SOS, nav buttons and icon buttons were raised to 48px |
| Touch targets, previews | 7 pages x 6 widths | 0 under 48px |
| Accessible names and labels | 57 screens | 0 unnamed buttons or unlabeled inputs flagged after fixes |
| Names and states | previews | Semantic HTML, labelled inputs, aria-live status areas, skip link, aria-current. Checkbox rows expose aria-checked |
| Enlarged text, 1.5x font multiplication | 57 fixed screens | 4 screens show clipping: Help, Settings (My trusted people), Splash, Women's Shield. Fixed 390px canvases are not responsive, so this is expected to need real layout work in the app |
| Enlarged text, 200% root size | previews, 6 widths | No horizontal overflow except 03-home-ask at 320 and 360 px |
| Horizontal overflow at default size | previews, 6 widths | None |
| Reduced motion | CSS rule present on all screens | Rule present only; not visually verified |
| Interaction click-through | consent, withdrawal, download screens | Worked in a headless browser. This does not show the live app works |

## NOT performed
- Real screen readers (VoiceOver, TalkBack, NVDA). Screen-reader states are checked only as DOM attributes.
- Physical Android device and iOS device testing; OS-level font scaling; Android navigation bar; safe areas.
- On-screen keyboard open on forms.
- Right-to-left layouts.
- Real translated label lengths and script font rendering across the supported languages.
- Contrast on gradient or image backgrounds (218 text items skipped because their background is not a single colour).
- Real keyboard focus order and focus trapping.
- Visual check of reduced-motion behaviour.
- Colour-blindness simulation.
- Touch behaviour on device (hit-testing, gestures).
- Any test of the live application.
