/**
 * locationUploadQueue.ts — F2a: Persisted retry queue for location uploads.
 *
 * Zustand store with persist middleware → AsyncStorage key `dhara_loc_queue`.
 * Capped at 20 entries; oldest entries are evicted when the cap is exceeded.
 *
 * Populated when:
 *   - Battery is at or below 15 % (F2b battery gate defers the upload)
 *   - An upload attempt fails (network unavailable / server error)
 * Drained when:
 *   - A subsequent upload succeeds with sufficient battery
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_CAP  = 20;
const STORE_KEY  = 'dhara_loc_queue';

// ── Public types ──────────────────────────────────────────────────────────────

export interface QueuedLocationEntry {
  /** Locally generated id — timestamp + random suffix */
  id: string;
  journeyToken: string;
  lat: number;
  lng: number;
  /** Accuracy in metres */
  accuracy: number;
  /** Reverse-geocoded area name (best-effort) */
  area: string;
  /** ISO-8601 timestamp when the fix was captured on-device */
  capturedAt: string;
}

interface LocationUploadQueueState {
  queue: QueuedLocationEntry[];
  /** Append an entry (id is assigned here). Oldest entry evicted if at cap. */
  enqueue: (entry: Omit<QueuedLocationEntry, 'id'>) => void;
  /** Remove all entries. */
  clearAll: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useLocationUploadQueue = create<LocationUploadQueueState>()(
  persist(
    (set) => ({
      queue: [],

      enqueue: (entry) =>
        set((state) => {
          const newEntry: QueuedLocationEntry = {
            ...entry,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          };
          const updated = [...state.queue, newEntry];
          // Evict oldest when over cap
          return {
            queue: updated.length > QUEUE_CAP ? updated.slice(-QUEUE_CAP) : updated,
          };
        }),

      clearAll: () => set({ queue: [] }),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
