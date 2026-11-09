/**
 * headOutRecents.ts — local-only "recently used" Head Out destinations.
 *
 * There is no backend concept of a "recent destination" (only saved places,
 * via /api/safety/places). Recents live entirely on-device in AsyncStorage,
 * capped at RECENTS_CAP, most-recent-first, de-duplicated by normalised label.
 * A destination that's also a saved place is still recorded here independently
 * — the two lists are shown as separate tabs, matching how the user picked it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DestinationValue } from './DestinationPicker';

const RECENTS_KEY = 'dhara_head_out_recents_v1';
const RECENTS_CAP = 8;

export interface RecentDestination {
  label: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters: number;
  usedAt: string; // ISO-8601
}

function normLabel(s: string): string {
  return s.trim().toLowerCase();
}

export async function getRecentDestinations(): Promise<RecentDestination[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Record a destination as just-used. Moves an existing match to the front
 * instead of duplicating it. Failures are swallowed — recents are a
 * convenience list, never load-bearing for starting a journey. */
export async function recordRecentDestination(d: DestinationValue): Promise<void> {
  const label = d.label.trim();
  if (!label) return;
  try {
    const existing = await getRecentDestinations();
    const withoutMatch = existing.filter(r => normLabel(r.label) !== normLabel(label));
    const next: RecentDestination[] = [
      { label, latitude: d.latitude ?? null, longitude: d.longitude ?? null, radiusMeters: d.radiusMeters, usedAt: new Date().toISOString() },
      ...withoutMatch,
    ].slice(0, RECENTS_CAP);
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal — recents are best-effort.
  }
}