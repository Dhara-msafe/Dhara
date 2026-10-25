/**
 * useLocationUpload — F2b: Battery-aware location upload hook.
 *
 * Wraps `PATCH /api/journey/status/{token}/location` with:
 *   - Battery gate: if level ≤ 15 %, enqueue instead of uploading.
 *   - Failure handling: enqueue on network / server error.
 *   - Queue drain: on a successful upload, attempt to drain pending entries.
 *   - Last-gasp mode (F2c): bypass battery check entirely.
 *     Used when the app transitions to background — fires once per session.
 *
 * When GO1B_GPS_ENABLED is OFF, `journeyToken` will be null and all
 * operations are no-ops — safe to wire up unconditionally.
 */
import { useCallback } from 'react';
import * as Battery from 'expo-battery';
import { API_BASE } from '@/src/apiBase';
import { useLocationUploadQueue } from '@/src/safety/locationUploadQueue';

/** Battery fraction at or below which uploads are deferred (0.0 – 1.0). */
const BATTERY_GATE = 0.15;

// ── Module-level helpers (no React closure issues) ────────────────────────────

async function _rawUpload(
  authToken: string,
  journeyToken: string,
  lat: number,
  lng: number,
  accuracy: number,
  area: string,
): Promise<boolean> {
  try {
    const resp = await fetch(
      `${API_BASE}/api/journey/status/${journeyToken}/location`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ lat, lng, accuracy, area }),
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Drain the queue one entry at a time.
 * Stops on first failure so the remaining entries stay at the front
 * and are retried on the next successful upload.
 */
async function _drainQueue(authToken: string): Promise<void> {
  while (true) {
    const { queue } = useLocationUploadQueue.getState();
    if (queue.length === 0) break;
    const entry = queue[0];
    const ok = await _rawUpload(
      authToken,
      entry.journeyToken,
      entry.lat,
      entry.lng,
      entry.accuracy,
      entry.area,
    );
    if (!ok) break; // entry remains at front for next attempt
    // Pop the successfully uploaded front entry
    useLocationUploadQueue.setState((s) => ({ queue: s.queue.slice(1) }));
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLocationUpload(
  authToken: string | null,
  journeyToken: string | null,
) {
  const { enqueue } = useLocationUploadQueue();

  /**
   * Battery-aware upload (F2b).
   * • Reads battery level first.
   * • ≤ 15 %  → enqueue, skip network call.
   * • > 15 %  → upload; on failure enqueue; on success drain the queue.
   */
  const upload = useCallback(
    async (lat: number, lng: number, accuracy: number, area: string): Promise<void> => {
      if (!authToken || !journeyToken) return;

      // Battery gate
      try {
        const level = await Battery.getBatteryLevelAsync();
        // level is 0.0–1.0; returns -1 when unavailable (e.g. web / simulator)
        if (level >= 0 && level <= BATTERY_GATE) {
          enqueue({
            journeyToken,
            lat,
            lng,
            accuracy,
            area,
            capturedAt: new Date().toISOString(),
          });
          return;
        }
      } catch { /* non-fatal — proceed with upload */ }

      const ok = await _rawUpload(authToken, journeyToken, lat, lng, accuracy, area);
      if (!ok) {
        enqueue({
          journeyToken,
          lat,
          lng,
          accuracy,
          area,
          capturedAt: new Date().toISOString(),
        });
        return;
      }
      // Successful — drain any previously queued entries
      await _drainQueue(authToken);
    },
    [authToken, journeyToken, enqueue],
  );

  /**
   * Last-gasp upload (F2c) — bypass battery check.
   * Called when the app transitions to background with an active session.
   * Does not drain the queue (battery state is unknown at this point).
   */
  const lastGaspUpload = useCallback(
    async (
      lat: number,
      lng: number,
      accuracy: number | null,
      area: string,
    ): Promise<void> => {
      if (!authToken || !journeyToken) return;
      await _rawUpload(authToken, journeyToken, lat, lng, accuracy ?? 0, area);
    },
    [authToken, journeyToken],
  );

  return { upload, lastGaspUpload };
}
