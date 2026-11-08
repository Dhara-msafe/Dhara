/**
 * useLivePosition — foreground-only, DISPLAY-ONLY live position.
 *
 * Contract (do not break):
 *  • Nothing is uploaded. The coordinates never leave this hook's consumer —
 *    they are drawn on the map on this device and used, only once permission
 *    is already granted, to bias address suggestions.
 *  • Foreground only: no background task, no geofence, no persistence. The
 *    watcher stops on unmount and whenever the app leaves the foreground.
 *  • Separate from the journey GPS upload flow (EXPO_PUBLIC_GO1B_GPS) and
 *    from guardian-share — this hook touches neither.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

export type LivePositionStatus =
  | 'idle'        // not asked yet
  | 'asking'      // permission dialog / first fix in flight
  | 'granted'     // watching
  | 'denied'      // refused, can ask again
  | 'blocked'     // refused and the OS will not ask again → Settings
  | 'unavailable';// no location service on this device/browser

export type LivePoint = { latitude: number; longitude: number; accuracy: number | null };

export function useLivePosition() {
  const [status, setStatus] = useState<LivePositionStatus>('idle');
  const [point, setPoint] = useState<LivePoint | null>(null);
  const subRef = useRef<Location.LocationSubscription | null>(null);
  const aliveRef = useRef(true);

  const stop = useCallback(() => {
    // expo-location 19 on web throws "LocationEventEmitter.removeSubscription is
    // not a function" AFTER it has already cleared the browser watch — swallow it
    // so unmount/background never crashes the screen.
    try { subRef.current?.remove(); } catch { /* watch already cleared */ }
    subRef.current = null;
  }, []);

  const startWatching = useCallback(async () => {
    if (subRef.current) return;
    try {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          if (!aliveRef.current) return;
          setPoint({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: typeof loc.coords.accuracy === 'number' ? loc.coords.accuracy : null,
          });
          setStatus('granted');
        },
      );
      // The screen may have closed while the watcher was starting.
      if (!aliveRef.current) { try { sub.remove(); } catch {} return; }
      subRef.current = sub;
    } catch {
      if (aliveRef.current) setStatus('unavailable');
    }
  }, []);

  /** Call only after the user has tapped something that asks for their location. */
  const request = useCallback(async () => {
    setStatus('asking');
    try {
      const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!enabled) { setStatus('unavailable'); return; }

      const current = await Location.getForegroundPermissionsAsync();
      let granted = current.granted;
      let canAskAgain = current.canAskAgain;
      if (!granted && canAskAgain) {
        const asked = await Location.requestForegroundPermissionsAsync();
        granted = asked.granted;
        canAskAgain = asked.canAskAgain;
      }
      if (!granted) { setStatus(canAskAgain ? 'denied' : 'blocked'); return; }

      await startWatching();
    } catch {
      setStatus('unavailable');
    }
  }, [startWatching]);

  /** Start silently if permission was already granted earlier — no prompt. */
  const resumeIfAlreadyGranted = useCallback(async () => {
    try {
      const current = await Location.getForegroundPermissionsAsync();
      if (current.granted) await startWatching();
    } catch { /* no location service — stay idle */ }
  }, [startWatching]);

  const openSettings = useCallback(() => { Linking.openSettings().catch(() => {}); }, []);

  // Foreground only: pause the watcher in the background, resume on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') stop();
      else if (status === 'granted') void startWatching();
    });
    return () => sub.remove();
  }, [status, stop, startWatching]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; stop(); };
  }, [stop]);

  return {
    status,
    point,
    request,
    resumeIfAlreadyGranted,
    stop,
    openSettings,
    /** iOS has no app-settings deep link before the first prompt. */
    canOpenSettings: Platform.OS !== 'web',
  };
}
