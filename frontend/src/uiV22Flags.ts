/**
 * v2.2 rollout presentation flags shared by more than one file.
 *
 * Each flag is presentation-only and reversible: only the exact string
 * 'true' turns it on, so an unset variable keeps today's UI. Same pattern as
 * src/designRevision.ts. Single-file flags stay next to the code they gate
 * (P2 in DesktopFrame.tsx, P3 in how-it-helps.tsx, P4 in consent.tsx,
 * P5 banner in MarqueeBanner.tsx).
 */

/**
 * Phase 8: Women's Shield and journey naming.
 * - Women's Shield: safety tools before "Know your rights"
 * - the dead "Safe-journey check-in" switch row is removed (it only stored
 *   ws_checkin_enabled on the device; nothing ever read it)
 * - Discreet mode switch announces its real on/off state with a neutral name
 * - one name for the journey feature: "Head out safely" (Home card, profile)
 * - FIR draft Domestic Violence tile: "498A" (old IPC) -> plain wording
 * - All help: Police & FIR gets its own description (was copied from
 *   Women's Shield)
 * Declared here, above the later phases, to keep merges with P7 clean.
 */
export const UI_V22_P8 = process.env.EXPO_PUBLIC_UI_V22_P8 === 'true';

/**
 * Phase 5b: tidy Home.
 * - Home grid drops its "All help" tile (the "All help" link above the grid stays).
 * - Home's empty "My files" card ("No cases yet — tap to start your first
 *   complaint") is hidden; the "Start your first case" card in "For you
 *   right now" is the one start action.
 * - Desktop, on Home only: the right rail's "Start your first case" card and
 *   the sidebar "Help journeys" list are hidden (Home already shows both).
 * - Desktop, everywhere: the "Get the app" card is hidden until launch (its
 *   "available on Android and iOS" text and placeholder QR are not true yet).
 */
export const UI_V22_P5_HOME = process.env.EXPO_PUBLIC_UI_V22_P5_HOME === 'true';

/**
 * Phase 6: one 112 message everywhere. Women's Shield helplines and the SOS
 * helpline sheet stop saying calling is "not yet active" / "will be enabled
 * in a future update" and use the Emergency screen's control instead: name
 * "Open dialler for <number>", same hint, the existing openPhone() call
 * (Outbound Guard: opens the dialler only, the user presses call; QA builds
 * simulate), a status line, and the number as selectable text (fallback).
 * Other 112 buttons and the Settings row take the same wording. All copy
 * lives in src/emergencyCopy.ts.
 */
export const UI_V22_P6 = process.env.EXPO_PUBLIC_UI_V22_P6 === 'true';

/**
 * Phase 7: Record (Evidence Locker). Microphone-denied and save-failed get
 * their own notice card with a next step (copy in src/recordCopy.ts) instead
 * of the same plain status line as every other message. Recording, saving,
 * pending-recovery and storage logic are unchanged.
 */
export const UI_V22_P7 = process.env.EXPO_PUBLIC_UI_V22_P7 === 'true';

/**
 * Floating buttons never cover content (client finding, 22 Nov: the bug
 * button covered "+ Rec" on Silent alert and values on My Data; the Help
 * pill cut off "Indefinite (legal ...)").
 * - Phones / narrow web: the Help pill and the bug-report button move out of
 *   the floating layer into a bottom dock that takes real layout space, so
 *   the screen ends above it and no row can sit underneath. The dock only
 *   appears on routes where at least one of the two is shown.
 * - Wide web (desktop frame): the floating Help pill is not shown; the
 *   sidebar "SOS · Emergency" is the one emergency entry.
 * - Bug-report button: shown only when a build sets
 *   EXPO_PUBLIC_ENABLE_ISSUE_REPORTER=true (test builds). Production builds,
 *   which do not set it, never show it.
 */
export const UI_V22_DOCK = process.env.EXPO_PUBLIC_UI_V22_DOCK === 'true';

/**
 * Phase 9: Head Out (look only; journey logic, alerts and server calls are
 * untouched). Owned by the Head Out feature session (#65).
 * - one name on all four screens: "Head out safely"
 * - active journey: green "Sharing is on" banner while the chosen people can
 *   see the journey (reads existing state only)
 * - 48 px minimum on the two 44 px Head Out controls
 * - FAB-safe bottom gutter on all Head Out screens, so no control is stuck
 *   under the floating Help pill / issue reporter (they sit ~140-244 px
 *   above the bottom on the right). The global FAB fix is the UI session's;
 *   this only touches Head Out files.
 * Desktop rail and the extra SOS on Head Out are already handled by P2
 * (its calm-route list covers /women/*).
 */
export const UI_V22_P9 = process.env.EXPO_PUBLIC_UI_V22_P9 === 'true';

/** Bottom gutter (px, on top of the safe-area inset) that keeps Head Out
 * controls scrollable clear of the floating-button band. */
export const HEADOUT_FAB_SAFE_GUTTER = 260;

/**
 * Head Out scroll-view bottom padding. The 260 px FAB-safe gutter applies
 * only with P9 on AND the bottom dock (UI_V22_DOCK) off: with the dock on,
 * the Help pill / bug button take real layout space, so the screen already
 * ends above them and each screen keeps its normal padding (`base`: 110 on
 * the wizard steps, which clears their fixed footer; 32 on the active screen).
 */
export function headOutBottomGutter(base: number): number {
  return UI_V22_P9 && !UI_V22_DOCK ? HEADOUT_FAB_SAFE_GUTTER : base;
}
