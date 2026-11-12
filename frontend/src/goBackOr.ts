import type { Href } from 'expo-router';

/**
 * NF-08 (12 Nov 2026): a screen opened directly (web refresh, shared link,
 * notification) has no history, so router.back() does nothing and the back
 * arrow is a dead end. Go back when there is somewhere to go, otherwise
 * replace with the screen this one normally opens from.
 */
export function goBackOr(
  router: { canGoBack: () => boolean; back: () => void; replace: (href: Href) => void },
  fallback: string,
) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as Href);
}
