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
