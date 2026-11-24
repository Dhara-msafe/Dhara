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
 * Phase 10: Consent settings and privacy (Settings > Data & privacy), look
 * only, for what already exists. Optional choices (Analytics, Service
 * updates) get an "Optional" badge and an Agreed / Not given state chip in
 * the theme's consentState colours (added in P1 for this phase); consent
 * history chips use the same colours and say the state in words; section
 * headers become small-caps labels; tap targets reach 48 px. No change to
 * what is stored, sent, defaulted or worded in the consent notice. Not in
 * this phase (own tickets): required-consent withdrawal, screen 58, a 5th
 * purpose, retention periods, Pro price.
 * Declared above P8 so it doesn't collide with flags appended at the end.
 */
export const UI_V22_P10 = process.env.EXPO_PUBLIC_UI_V22_P10 === 'true';

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

/**
 * One emergency entry per screen (owner, 22 Nov; B-122).
 * - Desktop frame: the sidebar "SOS · Emergency" is the one entry. Screen
 *   SOS pills (Women's Shield, All help, Family journey, the tab overlay)
 *   step aside inside the frame, and the top-bar SOS chip is not shown.
 * - Phones: the tab layout's SOS no longer floats over any tab screen (it
 *   covered "New chat" on Ask — B-122 — and headings/cards on Rights, My
 *   files, Me, Settings). Ask gets an SOS pill in its header row; Me and
 *   Settings keep their own SOS in the content; other tabs keep the red Help
 *   button (opens Emergency; docked with UI_V22_DOCK).
 */
export const UI_V22_ONE_SOS = process.env.EXPO_PUBLIC_UI_V22_ONE_SOS === 'true';

/**
 * My Data (client finding, 22 Nov): data-type labels read "Fir Drafts" /
 * "Otp Logs" (title-cased backend keys) and long values were cut off at
 * two lines ("Indefinite (legal ..."). With the flag: plain labels with
 * correct acronyms ("FIR drafts", "OTP logs") and values that wrap in full.
 */
export const UI_V22_MYDATA = process.env.EXPO_PUBLIC_UI_V22_MYDATA === 'true';

/**
 * 390px sweep fixes (22 Nov): text cut off on narrow phones.
 * - FIR draft "What happened?" tiles: title, description and BNS line may
 *   use two lines instead of being cut to one ("Domestic Violence",
 *   "Workplace Harassment", "BNS 74–75 · POSH 2013").
 * - Family journey header: the title "Support a family member" wraps to two
 *   lines instead of being cut off.
 */
export const UI_V22_SWEEP = process.env.EXPO_PUBLIC_UI_V22_SWEEP === 'true';

/**
 * One section-label style (v2.2 design, 23 Nov). The app had 24 different
 * styles for the same small uppercase label above a group (10-14px, weights
 * 700/800, letter-spacing 0.4-1.5, five colours). The design uses one:
 * 12px Hind bold, muted, slight letter-spacing. With the flag on, the quiet
 * labels share that one style; each site keeps its own margins, and the
 * deliberate accent/heading labels (navy, gold, brand) are left alone.
 */
export const UI_V22_TYPE = process.env.EXPO_PUBLIC_UI_V22_TYPE === 'true';

/**
 * Batch 2 — step S5 (Home & Ask: Home, Listening, Type instead, DHARA
 * understood, Your rights/Answer, Sources) needed NO code change: manifest
 * ids 6/7/8/10/12/13 are either already correct (Home's voice-first action
 * and labelled typing alternative) or are states merged into
 * app/(tabs)/index.tsx whose citation/verification handling already matches
 * what COPY_AND_CAPABILITY_AUDIT.csv calls for (DRAFT fallback, staleness
 * warning, IPC->BNS notice — not placeholder overclaims). No flag declared.
 */

/**
 * Step S6 (Rights & browse), one real fix of the four screens. Manifest ids
 * 28 (Rights library) and 29 (One right/RightDetail, inline accordion in
 * app/(tabs)/rights.tsx) needed no change — the mockup's search box doesn't
 * exist in the app (building it would be new functionality, out of scope)
 * and its "icon runtime error" was in the design file itself, not the app.
 * Id 30 (Dhara Engine) is placeholder sample content, audited clean, no
 * overclaiming copy. Id 20 (All help) is the one real item:
 * A11Y_CHECK_REPORT.md flags text clipping at 1.5x font scale on 4 screens
 * including Help, noting the fixed-width mockup canvases aren't responsive
 * and "this is expected to need real layout work in the app". With the flag
 * on, the help-card grid drops its numberOfLines clamp on title/sub so text
 * wraps instead of being cut with an ellipsis when the system font is
 * scaled up; the card grows to fit instead of a fixed minHeight.
 */
export const UI_V22_S6 = process.env.EXPO_PUBLIC_UI_V22_S6 === 'true';
 /**
 * Step S3 (Safety core, v2.2 design, 23 Nov handover). Visual-only reskin of
 * the Officer card (id 27, cream/navy light theme), Emergency (id 25) and
 * Record proof + its PIN gate (id 26), to the authoritative v2.2 design
 * package (memory/dhara_redesign/v2_2/editable_screens/). No new
 * functionality: the real 112 dialler wiring and any app-wide PIN system
 * stay out of scope per the v2.2 screen manifest (ids 15, 25). Three
 * screens originally scoped into this group by the generic handover doc
 * — Silent alert (id 34), Safety phrases (id 35) and Guardian share
 * (id 38) — turned out to be "Copy correction" only per screen-manifest.csv
 * (the authoritative scope document); they were fixed directly with no
 * flag, so they are not behind UI_V22_S3/S4 at all. Presentation-only,
 * reversible.
 */
export const UI_V22_S3 = process.env.EXPO_PUBLIC_UI_V22_S3 === 'true';

/**
 * Step S4 (Shield tools, v2.2 design, 23 Nov handover). Visual-only reskin
 * of Panic lesson (id 36), Safety plan (id 37) and Women's Shield (id 33)
 * to the new dark "Shield mode" palette (see shieldTheme.ts) that the
 * v2.2 design introduces for this screen group. Presentation-only,
 * reversible.
 */
export const UI_V22_S4 = process.env.EXPO_PUBLIC_UI_V22_S4 === 'true';

/**
 * Keep the focused input visible above the keyboard (client report, 23 Nov).
 *
 * Nine screens wrap their content in React Native's KeyboardAvoidingView
 * with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`. On
 * Android `undefined` means the component does nothing at all, so the
 * keyboard covers the field being typed in and everything below it. That
 * used to be survivable because `softwareKeyboardLayoutMode: "resize"`
 * made the window shrink, but the app now runs edge to edge
 * (`KeyboardProvider preserveEdgeToEdge` in app/_layout.tsx) and an
 * edge-to-edge window does not resize for the keyboard.
 *
 * With the flag on, those screens use the keyboard-controller
 * KeyboardAvoidingView already shipping on the Ask tab, which handles
 * Android properly. With it off, every screen keeps exactly today's
 * component and props. Presentation only: no input, value, submit or
 * navigation behaviour changes either way.
 */
export const UI_INPUT_INSET = process.env.EXPO_PUBLIC_UI_INPUT_INSET === 'true';

/**
 * Batch 3 — step S7 (Files & drafting: My files, File a complaint, The
 * letter, Letter saved/not sent, Ready notices, Your action plan, Photo of
 * a paper) needed one real fix out of seven screens. My files, Ready
 * notices (app/drafts/index.tsx — the manifest corrects the tracking
 * sheet's route, which had Ready notices and Letter saved/not sent
 * swapped), Missing-screen-adjacent audits, Your action plan and Photo of
 * a paper (Scan) were all already on the v2.2 cream/navy/gold theme
 * (theme.ts) with no overclaiming copy and no stray auto-redirect out of
 * the scan flow. Letter saved/Your letter are explicitly "existing
 * behaviour to preserve" (both states of app/drafts/[type].tsx) — no
 * change. A11Y_CHECK_REPORT.md flagged touch targets under 48px in
 * FirDraft; the one concrete, verifiable match in the live code is the
 * "Add more files" attach button (44x44, no hitSlop). With the flag on, it
 * gets hitSlop={2}, reaching the 48px effective target; off, it's
 * unchanged.
 */
export const UI_V22_S7 = process.env.EXPO_PUBLIC_UI_V22_S7 === 'true';

/**
 * Step S8 (Missing & alerts: Missing person, Missing interview, Alerts)
 * needed no code change. Missing person and Missing interview already use
 * the v2.2 theme tokens (theme.colors.primary/error/background match the
 * mockups' navy/red/cream exactly). Alerts' manifest item ("Sample alerts
 * removed") refers to the mockup's own placeholder data — the live
 * screen (app/alerts/index.tsx) already fetches real alerts/invitations
 * from the API with an honest "Nothing here yet." empty state, no
 * hardcoded sample rows. No flag declared.
 */

/**
 * Batch 4 — step S9 (Me & settings: Me, Me and settings, Edit profile, Data
 * privacy) needed NO code change. Me (manifest ids 19/44, app/(tabs)/me.tsx)
 * is already on the v2.2 theme tokens — its background/navy/error colours
 * match Me.dc.html and Settings.dc.html exactly — with no sample data and no
 * overclaiming copy. Edit profile (id45, "Sample personal details removed")
 * already uses the signed-in user's real name/email with safe fallbacks, no
 * hardcoded sample. Data privacy (id46, "no blanket on-device or end-to-end
 * claims") already says "stored on DHARA's servers (encrypted at rest)",
 * the qualified wording the manifest calls for. "Me and settings"
 * (app/(tabs)/settings.tsx) has no screen-manifest entry of its own — the
 * manifest's "Settings.dc.html" design file maps to id19 (Me/me.tsx), not to
 * this route — and was audited clean of any overclaiming copy regardless.
 * No flag declared.
 */

/**
 * Step S10 (Entry: DHARA splash, How DHARA helps, Choose language, Choose
 * state), one real fix of the four screens. Splash (id1, app/index.tsx) is a
 * logo-and-spinner screen with no footnote/tagline text at all, so the
 * mockup's copy/contrast findings (Splash.dc.html has a CTA and a footer
 * line the live screen never built) don't apply — building them would be
 * new functionality. How DHARA helps (id3, excluded) was already built
 * fresh from Welcome.dc.html in an earlier stage with the corrected,
 * non-overclaiming copy (see the file's own header comment). Choose state
 * (id5, app/state.tsx) already has a selected-row checkmark, the shared
 * #505B68 placeholder-contrast token, and its one sub-48px touch target
 * (the skip/cancel button) already raised to 48px by the pre-existing
 * UI_REVISION_V1 flag. Choose language (id2, app/language.tsx) already
 * shows native names first and already has a working search field (the
 * manifest's claim that search "does NOT exist in the app" doesn't match
 * the live code — nothing to add there). The one real gap: Main.dc.html's
 * selected row shows both the "Selected" text label AND a small filled
 * checkmark badge; the live row only has the text. With the flag on, a
 * checkmark-circle icon renders next to "Selected" on the active row,
 * matching the design and reinforcing the state beyond color/text alone.
 */
export const UI_V22_S10 = process.env.EXPO_PUBLIC_UI_V22_S10 === 'true';

/**
 * Batch 5 — step S11 (Family & visitor: Family journey, Family contacts,
 * Visitor help) needed NO code change. Family journey (manifest id39,
 * "Renamed 'Support a family member'") is already titled that in
 * JourneyHeader, and keeps itself explicitly separate from legal-case
 * tracking — no "court updates" content anywhere. Family contacts (id40,
 * "Labelled icon buttons; 48px targets") already has accessibilityLabels on
 * every icon button in the shared src/familyJourney/ui.tsx chrome, and its
 * touch targets are already raised to 48px by the pre-existing
 * UI_REVISION_V1 flag (same pattern as Batch 4's Choose state skip button).
 * Visitor help (id53, "Visual only") is already on the shared theme tokens
 * (theme.colors.primary === navy) with its touch targets likewise already
 * raised via UI_REVISION_V1. No flag declared.
 */

/**
 * Step S12 (Advocate: Find advocate, Advocate profile, Case notes, IPC
 * lookup), one real fix of the four screens. Find advocate (id49), Advocate
 * profile (id50) and Case notes/Notetaker (id51) are all manifest
 * disposition "deferred" — the manifest's own change_summary for each says
 * only to confirm feature-flag gating before launch, not to make a visual
 * change. All three already redirect to Home when ADVOCATE_MODE_ENABLED is
 * off (see the B-97/B-87/B-121 comments in lawyer-home.tsx,
 * advocate-register.tsx and notetaker/index.tsx), so that open question is
 * already answered — no further work, and no visual redesign is in scope
 * for a "deferred" screen this batch. The copy audit's "Advocate ratings,
 * cases won, Bar Council verification -> Removed" concern is also already
 * satisfied: lawyer-home.tsx's verified/pending badge reads a real
 * `/api/advocate/profile/:id` fetch, not sample data, and nowhere shows a
 * rating or a "cases won" count. IPC lookup (id52, "retained... Visual
 * only") is the one real gap: its `safe` container hardcodes the legacy
 * off-brand `#FDFBF7`, one hex away from the v2.2 cream token
 * (`theme.colors.background`, `#FBF7EE`) that IPCLookup.dc.html and every
 * other v2.2 screen use. With the flag on, it reads the shared token
 * instead.
 */
export const UI_V22_S12 = process.env.EXPO_PUBLIC_UI_V22_S12 === 'true';

/**
 * Step S2 (Infra PR B — shared chrome: header, buttons, chips, cards,
 * bottom tabs; components/theme). Audited every shared-chrome component
 * against component-specifications.md ("Min 48px target" for Button; Top
 * bar/SOS entries) before any per-screen v2.2 batch touched them:
 *
 * - ScreenHeader.tsx (back + title, used by 25+ screens across the app,
 *   including women/*, notetaker/*, alerts/*, invite/*): the back button
 *   was 40x40, below the 48px minimum. This is the one real gap, and
 *   fixing it here — once, in the shared component — is why this infra
 *   step was meant to come before the per-screen batches.
 * - AppTabBar.tsx (bottom tabs): already compliant — each tab's
 *   `minHeight` is 52, the raised Ask button is 60x60. No change.
 * - SosPill.tsx (SOS pill, Quick exit pill, Chip, Divider): SOS and Quick
 *   exit are already 48px tall. The icon+label `Chip` here is a nav/filter
 *   chip (globe/language pill style), not the consent "Status chip" in
 *   component-specifications.md (Agreed/Not given/Withdrawn/Pending/
 *   Failed) — that one lives in the Consent screens (S13, on hold for
 *   legal sign-off), out of scope here. No change.
 *
 * Presentation-only, reversible: with the flag off, ScreenHeader keeps
 * today's 40x40 back button exactly as before.
 */
export const UI_V22_S2 = process.env.EXPO_PUBLIC_UI_V22_S2 === 'true';
