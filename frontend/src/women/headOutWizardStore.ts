/**
 * headOutWizardStore.ts — draft state shared across the Head Out wizard steps
 * (Choose Destination -> Set Arrival Radius -> Trusted Circle & Rules).
 *
 * Persisted so an interrupted wizard (app backgrounded mid-flow, a stray
 * back-navigation) doesn't silently lose what the user already picked.
 * Cleared once a journey actually starts — this store only ever holds an
 * in-progress DRAFT, never the active session itself (that remains
 * AsyncStorage's ws_head_out_session, owned by head-out.tsx).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DestinationValue } from './DestinationPicker';

const STORE_KEY = 'dhara_head_out_wizard_draft';

const EMPTY_DESTINATION: DestinationValue = { label: '', radiusMeters: 200 };

interface HeadOutWizardState {
  destination: DestinationValue;
  selectedRecipientIds: string[];
  setDestination: (d: DestinationValue) => void;
  setSelectedRecipientIds: (ids: string[]) => void;
  reset: () => void;
}

export const useHeadOutWizard = create<HeadOutWizardState>()(
  persist(
    (set) => ({
      destination: EMPTY_DESTINATION,
      selectedRecipientIds: [],
      setDestination: (d) => set({ destination: d }),
      setSelectedRecipientIds: (ids) => set({ selectedRecipientIds: ids }),
      reset: () => set({ destination: EMPTY_DESTINATION, selectedRecipientIds: [] }),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
