/**
 * Header SOS registry (redesign v3, stage 2).
 *
 * The bottom SOS strip is gone: SOS now sits at the top right of the header.
 * A screen whose header shows SOS calls useHeaderSosPresent() (the shared
 * SOS pills do it for you). While such a screen is focused, the floating SOS
 * button hides itself, so there is exactly one SOS on screen. Screens that
 * have not been moved to the shared header yet still get the floating one.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';

let count = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => count > 0;

/** Call from a focused screen whose header shows an SOS control. */
export function useHeaderSosPresent(): void {
  useFocusEffect(useCallback(() => {
    count += 1; emit();
    return () => { count = Math.max(0, count - 1); emit(); };
  }, []));
}

/** True while the focused screen shows SOS in its header. */
export function useHeaderSosVisible(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
