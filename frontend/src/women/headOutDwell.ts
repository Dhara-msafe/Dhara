/**
 * Head Out DWELL detector — the last unbuilt box of the Final Flow sheet's
 * trigger row: "DWELL too long (no movement)" → a PRIVATE "Are you okay?"
 * check-in on her own screen.
 *
 * Deliberately in-app only (row-25 precedent, owner decision 21 Nov): a
 * dwell never alerts the Trusted Circle by itself — stillness is usually a
 * café, a bus stop, a friend's gate. The circle is only ever told by the
 * things she already controls: the missed-check-in deadline and "Need help".
 * The prompt's copy says exactly that.
 *
 * Pure TypeScript (no React/Expo imports), so it runs under `node --test`.
 */
import { haversineMeters } from '../utils/mapValidation';

/** Still for this long → ask her, once per stillness episode. */
export const DWELL_THRESHOLD_MS = 10 * 60 * 1000;
/** Movement below this distance is GPS jitter, not movement (the deviation
 * logic's heading-back margin uses the same order of magnitude). */
export const DWELL_RADIUS_METERS = 40;
/** Fixes worse than this can wander whole blocks on their own — they neither
 * start nor break a stillness episode. */
export const DWELL_MAX_ACCURACY_METERS = 50;

export interface DwellState {
  /** Where the current stillness episode is anchored. */
  anchorLat: number;
  anchorLng: number;
  /** When the episode began (ms epoch). */
  stillSinceMs: number;
  /** The prompt was shown for this episode — never nag twice for one episode. */
  prompted: boolean;
}

export interface DwellFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** When the fix was taken (ms epoch) — lastFixAt, the true capture time. */
  lastFixAt: number;
}

/**
 * Fold one fix into the dwell state. Returns the next state (or null when
 * there is nothing usable yet). Movement past the jitter radius starts a
 * fresh episode; an unusable fix changes nothing.
 */
export function updateDwell(state: DwellState | null, fix: DwellFix | null): DwellState | null {
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return state;
  if (fix.accuracy != null && fix.accuracy > DWELL_MAX_ACCURACY_METERS) return state;
  if (!state) {
    return { anchorLat: fix.latitude, anchorLng: fix.longitude, stillSinceMs: fix.lastFixAt, prompted: false };
  }
  const moved = haversineMeters(state.anchorLat, state.anchorLng, fix.latitude, fix.longitude);
  if (moved > DWELL_RADIUS_METERS) {
    // She moved: new episode anchored here, prompt armed again.
    return { anchorLat: fix.latitude, anchorLng: fix.longitude, stillSinceMs: fix.lastFixAt, prompted: false };
  }
  return state;
}

/** Should the private "Are you okay?" prompt be shown now? */
export function shouldPromptDwell(state: DwellState | null, nowMs: number): boolean {
  if (!state || state.prompted) return false;
  return nowMs - state.stillSinceMs >= DWELL_THRESHOLD_MS;
}

/** She answered (any answer) — this episode never prompts again. The next
 * prompt needs real movement first, then another full threshold of stillness. */
export function acknowledgeDwell(state: DwellState | null): DwellState | null {
  return state ? { ...state, prompted: true } : state;
}

/** Whole minutes still, for the prompt's copy ("about 10 minutes"). */
export function dwellMinutes(state: DwellState, nowMs: number): number {
  return Math.max(1, Math.round((nowMs - state.stillSinceMs) / 60000));
}
