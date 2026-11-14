import { theme } from '@/src/theme';

/**
 * Visible keyboard-focus ring (NF-UI-REV-01 batch, 14 Nov 2026).
 *
 * React Native Web's Pressable exposes `focused` in its style-callback form
 * (`style={(state) => ...}`) when an element receives keyboard focus (Tab
 * key) — it is always `false`/absent on iOS/Android touch, so this is a
 * no-op there by construction, not by a platform check.
 * `outlineWidth/outlineColor/outlineStyle/outlineOffset` are web-only style
 * keys that React Native Web forwards to CSS `outline`; native RN silently
 * ignores them. `state` is typed loosely because @types/react-native's
 * PressableStateCallbackType does not (yet) declare `focused`/`hovered`,
 * even though react-native-web sets them at runtime.
 *
 * Usage: style={(state) => [baseStyle, focusRingStyle(state)]}
 */
export const focusRingStyle = (state: { pressed: boolean; focused?: boolean }) =>
  state.focused
    ? {
        outlineWidth: 2,
        outlineColor: theme.colors.navy,
        outlineStyle: 'solid' as const,
        outlineOffset: 2,
      }
    : null;
