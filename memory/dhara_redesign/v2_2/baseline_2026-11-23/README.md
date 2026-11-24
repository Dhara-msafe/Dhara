# Baseline — the live app before the v2.2 screen work

Captured 23 Nov 2026 from the preview (VM HEAD at the time), at the
emergent-workspace-9/11 tip, with the v2.2 flags **off** except those
already merged. These are the "before" images for step S0.

Widths: 390 (phone), 768 (tablet), 1280 (desktop). Captured in a frame of
that width so the app sees the real viewport.

| File | Screen |
|---|---|
| `home_390.png`, `home_768.png`, `home_1280.png` | Home |
| `emergency_390.png`, `emergency_1280.png` | Emergency |
| `women-shield_390.png` | Women's Shield |
| `rights_390.png` | Rights |
| `all-help_390.png` | All help |
| `myfiles_390.png` | My files (empty state) |

**Not included on purpose:** Me, My Data and Settings. Those screens show
the test account's name and email, and personal data should not be
committed to the repo. Capture them locally when a step needs them.

**Seen while capturing (not fixed here):** at 1280 the Home content column
leaves a white gap to the left of the cream page and the navy header stops
short of it. Worth a look during step S4.

## Test and type baseline

Measured twice, because the branch tip moved between the screenshots and this
commit. **Use the second set** — it is the base Sai builds from.

At `b068704` (when the screenshots were taken):
540 run, 531 pass, **9 fail**.

At `4b99b83` (the current tip, re-measured 23 Nov):

- **Tests:** 554 run, 546 pass, **8 fail**, in 4 files:
  `approvedStep_export_branches` (2), `b06_qa_mode_banner_web_recheck` (1),
  `b126_typed_destination_geocode` (2), `headout_current_location` (3).
  Five of the eight are Head Out and location tests, in files Sindhu's chat is
  working in. `b93_encrypt_draft_notices_women_shield_data` failed at the
  older tip and passes now.
- **TypeScript:** `tsc --noEmit` gives **11 errors** in 5 files —
  `app/(tabs)/myfiles.tsx` (5), `src/notetaker/steps/ConsentStep.tsx` (3),
  `src/notetaker/steps/InputStep.tsx` (1), and 2 import-extension errors in
  `src/women/__tests__/safetyTriggerCoordinator.test.ts`.
  One of these looks like a real latent bug rather than a typing nit:
  `InputStep.tsx(152,12): Cannot find name 'ALLOWED_EXT'`. It is not a UI
  item and is not Sai's to fix inside a screen step.

Every step must leave both numbers unchanged: **8 failures, 11 type errors**.
A step that changes either one needs an explanation before it is merged.
