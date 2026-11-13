# Component specifications (reference)

Applies to the design references. Bindings to real components are UNVERIFIED.

| Component | Variants | States | Accessibility | Platform notes |
|---|---|---|---|---|
| Button (primary, secondary, danger) | normal, large (58px) | default, pressed, disabled, busy | Min 48px target, visible name, disabled uses aria-disabled | Android ripple; no scale animation under reduced motion |
| Checkbox row (consent) | required, optional | unchecked (default), checked, error | role checkbox with aria-checked; whole row tappable, 64px min | Text must wrap; never colour-only |
| Language row | with native and English name | default, selected (check + label) | Selected announced | Keep last item above sticky button |
| Top bar | with back, title, step count, SOS | normal | Back labelled; SOS 48px high | Quick exit discreet on safety screens |
| Status chip | Agreed, Not given, Withdrawn, Pending, Failed | - | Text plus colour | |
| Note (pending review) | info | - | Plain text, 14px min | Used on consent screens |
| Radio group (keep/delete) | - | selected | Fieldset and legend | |
| Download state area | idle, busy, ready, fail, offline | - | aria-live polite | |
| Navigation | mobile tab bar, tablet/desktop side rail | current page | aria-current | Number of tabs to be decided after mapping destinations (references disagree: three, four, five) |
| SOS | pill | - | Labelled, 48px, never covers a form field or primary action | Safe-area insets |

Safe areas, Android navigation bar and on-screen keyboard: sticky controls must reserve their own space; NOT tested on device.
