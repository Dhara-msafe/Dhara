/**
 * Header title registry (27 Nov 2026).
 *
 * Inner pages used to show two rows: the DHARA bar, then a light row with
 * the back arrow and the page title. Now the focused page hands its title
 * and its back action to the DHARA bar, which shows them in one row:
 *
 *   [ < ]  DHARA                      [ SOS 112 ]
 *          Page title
 *
 * PageTitleRow registers here; AutoHeaderFrame reads. Only the focused
 * screen owns the entry, so a screen left behind in the stack cannot
 * overwrite the title of the one on top.
 *
 * Backup: EXPO_PUBLIC_HEADER_TITLE_IN_BAR=false brings the old two-row
 * layout back exactly as it was.
 */
import { createContext, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useFocusEffect } from 'expo-router';

export const HEADER_TITLE_IN_BAR = process.env.EXPO_PUBLIC_HEADER_TITLE_IN_BAR !== 'false';

export type HeaderTitleEntry = { title: string; onBack: () => void; backTestID: string; right?: ReactNode };

/** True below a DHARA bar that can show a page title (the tab layout's bar
 *  or the auto header). False on wide web and on screens with no bar. */
export const HeaderBarContext = createContext(false);

let current: HeaderTitleEntry | null = null;
let owner: object | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => current;

/** Call from a page's title row. While that page is focused, the DHARA bar
 *  shows its title and back arrow. */
export function useHeaderTitle(enabled: boolean, title: string, onBack: () => void, backTestID: string, right?: ReactNode): void {
  const id = useRef<object>({}).current;
  const back = useRef(onBack);
  back.current = onBack;
  const rightRef = useRef(right);
  rightRef.current = right;
  const publish = useCallback(() => {
    current = { title, backTestID, onBack: () => back.current(), right: rightRef.current };
    emit();
  }, [title, backTestID]);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    owner = id;
    publish();
    return () => {
      if (owner === id) { owner = null; current = null; emit(); }
    };
  }, [enabled, id, publish]));

  // The title or the right-hand control can change while the page stays
  // focused (list -> form, play -> stop), so republish after each render.
  // Only the bar listens to this store, so a page render cannot loop.
  useEffect(() => {
    if (enabled && owner === id) publish();
  });
}

/** The focused page's title entry, or null on pages without a title row. */
export function useHeaderTitleEntry(): HeaderTitleEntry | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
