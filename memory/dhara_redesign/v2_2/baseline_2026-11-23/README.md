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

## Test and type baseline at the same commit

- **Tests:** 540 run, **531 pass, 9 fail** — in 5 files:
  `approvedStep_export_branches` (2), `b06_qa_mode_banner_web_recheck` (1),
  `b126_typed_destination_geocode` (2), `b93_encrypt_draft_notices_women_shield_data` (1),
  `headout_current_location` (3). Five of the nine are Head Out tests, and
  that chat is working in those files.
- **TypeScript:** `tsc --noEmit` gives **11 errors** in 5 files —
  `app/(tabs)/myfiles.tsx` (5), `src/notetaker/steps/ConsentStep.tsx` (3),
  `src/notetaker/steps/InputStep.tsx` (1), and 2 import-extension errors in
  `src/women/__tests__/safetyTriggerCoordinator.test.ts`.
  One of these looks like a real latent bug rather than a typing nit:
  `InputStep.tsx(152,12): Cannot find name 'ALLOWED_EXT'`.

Every later step must keep these two numbers unchanged.
