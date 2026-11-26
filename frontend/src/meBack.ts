/**
 * Back for a screen that may have been opened from Me (26 Nov 2026, Vivek).
 *
 * Opened from a Me row (the link carries ?from=me): Back always returns to
 * Me. With history that is the screen behind it (Me pushed it); with none
 * (a reload on web, a deep link) it replaces to Me, so Back never sticks.
 * Opened from anywhere else: `otherwise` runs, i.e. the screen's own rule
 * (back to where it came from).
 */
type BackRouter = { canGoBack: () => boolean; back: () => void; replace: (href: any) => void };

export const ME_ROUTE = '/(tabs)/me';

export function backToMe(router: BackRouter) {
  if (router.canGoBack()) router.back();
  else router.replace(ME_ROUTE);
}

export function backFromMe(router: BackRouter, from: string | string[] | undefined, otherwise: () => void) {
  const f = Array.isArray(from) ? from[0] : from;
  if (f === 'me') backToMe(router);
  else otherwise();
}
