/**
 * DHARA Family Journey — Phase 1 (Preview) on-device store.
 *
 * ISOLATION RULES (do not break):
 *  - Nothing in this module talks to any server, SMS, push, or location API.
 *  - It never imports from src/women/* except the READ-ONLY contact list
 *    (getCircle) used to populate the picker, and never writes to it.
 *  - Everything is stored on this device only, namespaced by the signed-in
 *    account id (same fail-closed pattern as src/women/api.ts) so a shared
 *    device never leaks one account's journey into another's.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { getActiveUserIdSync, whenAuthHydrated } from '../auth';

const ENABLED_KEY = 'fj_enabled_v1';
const JOURNEY_KEY = 'fj_journey_v1';

export type ContactSource = 'device' | 'invite';

/** One picked contact + its four independent sharing permissions.
 *  "Local-only" is the absence of the other three (the default). */
export type JourneyContact = {
  id: string;
  name: string;
  phone: string;
  source: ContactSource;
  arrival: boolean;
  missedCheckin: boolean;
  helpRequest: boolean;
};

export type JourneyStatus = 'draft' | 'active' | 'ended';

export type Journey = {
  id: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  returnAt: string;
  /** Optional check-in reminder interval, in minutes. null = no reminders. */
  checkinMins: number | null;
  contacts: JourneyContact[];
  status: JourneyStatus;
  startedAt: number | null;
  lastCheckinAt: number | null;
  arrivedAt: number | null;
  helpRequestedAt: number | null;
  endedAt: number | null;
};

export const CHECKIN_OPTIONS: { label: string; mins: number | null }[] = [
  { label: 'No reminders', mins: null },
  { label: 'Every 30 min', mins: 30 },
  { label: 'Every 1 hour', mins: 60 },
  { label: 'Every 2 hours', mins: 120 },
];

export function isLocalOnly(ct: JourneyContact): boolean {
  return !ct.arrival && !ct.missedCheckin && !ct.helpRequest;
}

export function emptyJourney(): Journey {
  return {
    id: `fj_${Date.now()}`,
    destination: '',
    departAt: '',
    arriveAt: '',
    returnAt: '',
    checkinMins: null,
    contacts: [],
    status: 'draft',
    startedAt: null,
    lastCheckinAt: null,
    arrivedAt: null,
    helpRequestedAt: null,
    endedAt: null,
  };
}

async function scopedKey(base: string): Promise<string | null> {
  await whenAuthHydrated();
  const uid = getActiveUserIdSync();
  return uid ? `${base}_${uid}` : null;
}

// ── App-wide switch ───────────────────────────────────────────────────────
/** Every mounted useFamilyJourneyEnabled() hook, so flipping the switch on one
 *  screen immediately hides/shows the feature on Home, Me and everywhere else
 *  without needing an app reload. */
const enabledListeners = new Set<(on: boolean) => void>();

/** Family Journey ships ON for everyone; this is the safety net to turn the
 *  whole feature off app-wide. */
export async function isFamilyJourneyEnabled(): Promise<boolean> {
  try {
    const key = await scopedKey(ENABLED_KEY);
    if (!key) return true;
    const raw = await AsyncStorage.getItem(key);
    return raw !== '0';
  } catch {
    return true;
  }
}

export async function setFamilyJourneyEnabled(on: boolean): Promise<void> {
  enabledListeners.forEach(fn => fn(on));
  try {
    const key = await scopedKey(ENABLED_KEY);
    if (!key) return;
    await AsyncStorage.setItem(key, on ? '1' : '0');
  } catch {}
}

// ── Journey record (one at a time in Phase 1) ─────────────────────────────
export async function loadJourney(): Promise<Journey | null> {
  try {
    const key = await scopedKey(JOURNEY_KEY);
    if (!key) return null;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Journey) : null;
  } catch {
    return null;
  }
}

export async function saveJourney(j: Journey): Promise<void> {
  try {
    const key = await scopedKey(JOURNEY_KEY);
    if (!key) return; // fail closed — never persist without a known identity
    await AsyncStorage.setItem(key, JSON.stringify(j));
  } catch {}
}

export async function clearJourney(): Promise<void> {
  try {
    const key = await scopedKey(JOURNEY_KEY);
    if (!key) return;
    await AsyncStorage.removeItem(key);
  } catch {}
}

// ── Hooks ─────────────────────────────────────────────────────────────────
export function useFamilyJourneyEnabled() {
  const [enabled, setEnabledState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    isFamilyJourneyEnabled().then(v => {
      if (!alive) return;
      setEnabledState(v);
      setLoaded(true);
    });
    // Stay in sync with the switch wherever it is flipped (hub, Data & Privacy).
    const listener = (on: boolean) => { if (alive) setEnabledState(on); };
    enabledListeners.add(listener);
    return () => { alive = false; enabledListeners.delete(listener); };
  }, []);

  const update = useCallback(async (on: boolean) => {
    await setFamilyJourneyEnabled(on);
  }, []);

  return { enabled, loaded, setEnabled: update };
}

/** Minutes until the next check-in is due. Negative = check-in not received yet. */
export function nextCheckinDueAt(j: Journey): number | null {
  if (!j.checkinMins || j.status !== 'active' || j.arrivedAt) return null;
  const from = j.lastCheckinAt ?? j.startedAt;
  if (!from) return null;
  return from + j.checkinMins * 60 * 1000;
}
