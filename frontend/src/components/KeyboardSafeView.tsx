/**
 * One wrapper for the screens whose KeyboardAvoidingView does nothing on
 * Android — see UI_INPUT_INSET in src/uiV22Flags.ts for why.
 *
 * Flag off: renders React Native's KeyboardAvoidingView with exactly the
 * props those screens use today, so the build is unchanged.
 * Flag on: renders the keyboard-controller one, which works on Android
 * edge-to-edge, with the behaviour each screen needs.
 *
 * Presentation only. It passes `style` and children straight through and
 * adds nothing else, so a screen's layout is the same in both branches
 * apart from the keyboard inset itself.
 */
import type { ReactNode } from 'react';
import { KeyboardAvoidingView as RNKeyboardAvoidingView, Platform, type ViewStyle, type StyleProp } from 'react-native';
import { KeyboardAvoidingView as KCKeyboardAvoidingView } from 'react-native-keyboard-controller';
import { UI_INPUT_INSET } from '@/src/uiV22Flags';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * 'padding' for a scrolling form or a modal sheet — the default.
   * 'translate-with-padding' for a screen with a composer pinned to the
   * bottom, the same value the Ask tab already uses.
   */
  behavior?: 'padding' | 'translate-with-padding';
  /** Kept for the screens that already set one (a header height, say). */
  keyboardVerticalOffset?: number;
  testID?: string;
};

export function KeyboardSafeView({
  children,
  style,
  behavior = 'padding',
  keyboardVerticalOffset = 0,
  testID,
}: Props) {
  if (!UI_INPUT_INSET) {
    // The exact props these screens shipped with. `undefined` on Android is
    // the bug, kept here deliberately so turning the flag off is a true
    // rollback rather than a different kind of broken.
    return (
      <RNKeyboardAvoidingView
        style={style}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
        testID={testID}
      >
        {children}
      </RNKeyboardAvoidingView>
    );
  }

  return (
    <KCKeyboardAvoidingView
      style={style}
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
      testID={testID}
    >
      {children}
    </KCKeyboardAvoidingView>
  );
}
