/**
 * Advocate mode — build flag.
 *
 * Kept in its own module (no imports) so every file that needs the flag --
 * screens, nav links, discover cards -- can read it without pulling in
 * anything else.
 *
 * B-97: D-14 (5 Nov) called for advocate/lawyer-facing features to be
 * hidden for Wave 1. When false (the default): the "For advocates" header
 * link, the "Find an advocate" discover card, and the "me.advocate" menu
 * item are all hidden, and the four advocate/lawyer screens
 * (/(tabs)/advocate, /advocate-register, /lawyer-home, /intakes) redirect
 * home instead of rendering -- including on a direct URL hit or refresh,
 * not just when reached via the (now-hidden) in-app links. Flip this on
 * for Wave 2 by setting EXPO_PUBLIC_ADVOCATE_MODE_V2=true.
 */
export const ADVOCATE_MODE_ENABLED = process.env.EXPO_PUBLIC_ADVOCATE_MODE_V2 === 'true';
