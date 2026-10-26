/**
 * shakeActivation.ts — D1-V shake-to-discreet detector
 *
 * Uses expo-sensors Accelerometer to detect a shake gesture.  On a
 * confirmed shake, the caller receives an `onShake` callback so it can
 * activate the privacy cover (same effect as the D1-V phrase trigger).
 *
 * DETECTION ALGORITHM:
 *   1. Subscribe to accelerometer at 60 Hz.
 *   2. Compute the instantaneous acceleration magnitude √(x²+y²+z²).
 *      At rest: ≈ 1 g (gravity).  During a shake: spikes above 2.5 g.
 *   3. Track the number of magnitude crossings above SHAKE_THRESHOLD within
 *      WINDOW_MS.  Three crossings in 600 ms = confirmed shake.
 *   4. After triggering, suppress for COOLDOWN_MS to prevent re-fires.
 *
 * PRIVACY CONTRACT:
 *   Accelerometer data is consumed locally; raw values are never stored,
 *   logged, or transmitted.  The subscription is released on unmount.
 *
 * NATIVE BUILD NOTE:
 *   Accelerometer access requires a development or production native build.
 *   In Expo Go the sensor data arrives normally; the shake detection works
 *   end-to-end in Expo Go already.  FLAG_SECURE (expo-screen-capture) is
 *   the only item in this module that requires a native build.
 */

import { useEffect, useRef } from 'react';
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Magnitude deviation above rest (1 g) that counts as one shake movement. */
const SHAKE_THRESHOLD_G = 1.5;

/** Number of threshold crossings required within WINDOW_MS to confirm a shake. */
const REQUIRED_CROSSINGS = 3;

/** Rolling window (ms) within which crossings must occur. */
const WINDOW_MS = 600;

/** Minimum time (ms) between two shake activations. */
const COOLDOWN_MS = 2500;

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseShakeDetectorOptions {
  /** Called once per confirmed shake (respects cooldown). */
  onShake: () => void;
  /**
   * When false, the accelerometer subscription is released and no shake
   * events fire.  Defaults to true.
   */
  enabled?: boolean;
}

/**
 * Attaches an accelerometer listener and calls `onShake` whenever a
 * confirmed shake gesture is detected.  Cleans up automatically on unmount.
 */
export function useShakeDetector({ onShake, enabled = true }: UseShakeDetectorOptions) {
  const crossingsRef   = useRef<number[]>([]);
  const lastFireRef    = useRef<number>(0);
  const lastMagnitude  = useRef<number>(1);
  // Keep a stable ref to onShake so the effect doesn't re-run on every render
  // even when the caller passes an inline function.
  const onShakeRef = useRef(onShake);
  onShakeRef.current  = onShake;

  useEffect(() => {
    if (!enabled) return;

    Accelerometer.setUpdateInterval(16); // ~60 Hz

    const handleUpdate = ({ x, y, z }: AccelerometerMeasurement) => {
      const mag = Math.sqrt(x * x + y * y + z * z);
      const now  = Date.now();

      // Count a crossing when the magnitude crosses the threshold from below.
      if (mag - 1 > SHAKE_THRESHOLD_G && lastMagnitude.current - 1 <= SHAKE_THRESHOLD_G) {
        crossingsRef.current.push(now);
      }
      lastMagnitude.current = mag;

      // Prune old crossings outside the window.
      crossingsRef.current = crossingsRef.current.filter(t => now - t < WINDOW_MS);

      // Confirm shake when enough crossings accumulated AND cooldown passed.
      if (
        crossingsRef.current.length >= REQUIRED_CROSSINGS &&
        now - lastFireRef.current > COOLDOWN_MS
      ) {
        crossingsRef.current = [];
        lastFireRef.current  = now;
        onShakeRef.current();
      }
    };

    const subscription = Accelerometer.addListener(handleUpdate);
    return () => subscription.remove();
  }, [enabled]); // onShake intentionally excluded — stable via ref
}
