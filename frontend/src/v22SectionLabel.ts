import type { TextStyle } from 'react-native';
import { theme } from './theme';
import { UI_V22_TYPE } from './uiV22Flags';

/**
 * The v2.2 design's section label: the small uppercase line above a group
 * ("SAFETY", "YOUR DATA RIGHTS", "TRY SAYING"). 30 of the 57 design screens
 * use it, and they all use these values.
 *
 * Only the type is set here. Each call site keeps its own margins, because
 * spacing belongs to that screen's layout, not to the label.
 */
export const V22_SECTION_LABEL: TextStyle = {
  fontFamily: theme.fonts.bodyBold,
  fontSize: 12,
  fontWeight: '700',
  color: theme.colors.muted,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
};

/**
 * Wraps a label style: with the flag on, the shared type wins; with it off,
 * the site's own style is returned unchanged, so the screen looks exactly
 * as it does today.
 */
export function v22SectionLabel(own: TextStyle): TextStyle {
  return UI_V22_TYPE ? { ...own, ...V22_SECTION_LABEL } : own;
}
