/**
 * Android's own Back (button or gesture) on a screen built as a hidden tab
 * (26 Nov 2026, Vivek).
 *
 * Settings, Chat history, Saved answers and Lawyer Mode are hidden tabs, and
 * a tab's default Back goes to the first tab (Home), not to the screen that
 * opened them. While such a screen is in focus, this sends Android's Back
 * to the same place as its on-screen arrow. iPhone has no system Back
 * button, so nothing changes there.
 */
import { useCallback, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

export function useAndroidBack(onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        latest.current();
        return true; // handled: the tab's own Back (to Home) does not run
      });
      return () => sub.remove();
    }, []),
  );
}
