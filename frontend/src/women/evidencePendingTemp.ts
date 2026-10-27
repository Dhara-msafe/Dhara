/**
 * evidencePendingTemp.ts — BATCH A2 Step 1
 *
 * Tracks temporary (un-encrypted, recorder-produced) audio files that have NOT
 * yet been proven to exist as an encrypted copy in the evidence store.
 *
 * Contract:
 *   1. A temp file is registered as "pending" the moment the recorder stops.
 *   2. It is only cleared — and only then deleted from disk — after its
 *      encrypted copy has been saved AND read back successfully.
 *   3. Anything still pending on the next launch is recoverable evidence.
 *
 * Deliberately dependency-free (storage is injected) so it is unit-testable
 * with `node --test` against the real repo file, with no Expo/React runtime.
 */

export interface PendingTempStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface PendingTemp {
  uri: string;
  createdAt: string;
}

export const pendingTempKey = (scope: string) => `evidence_pending_temp_${scope}`;

export async function listPendingTemps(store: PendingTempStore, scope: string): Promise<PendingTemp[]> {
  try {
    const raw = await store.getItem(pendingTempKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e: any) => e && typeof e.uri === 'string');
  } catch {
    return [];
  }
}

/** Register a temp file as not-yet-proven-saved. Idempotent per uri. */
export async function markPendingTemp(store: PendingTempStore, scope: string, uri: string): Promise<void> {
  const list = await listPendingTemps(store, scope);
  if (list.some(e => e.uri === uri)) return;
  list.push({ uri, createdAt: new Date().toISOString() });
  await store.setItem(pendingTempKey(scope), JSON.stringify(list));
}

/** Clear a temp file — ONLY call once its encrypted copy was read back. */
export async function clearPendingTemp(store: PendingTempStore, scope: string, uri: string): Promise<void> {
  const list = await listPendingTemps(store, scope);
  const next = list.filter(e => e.uri !== uri);
  if (next.length === list.length) return;
  await store.setItem(pendingTempKey(scope), JSON.stringify(next));
}

/**
 * Navigation / background decision. A2 Step 1 rule: leaving the screen or
 * backgrounding the app must NEVER discard — it stops and saves instead.
 */
export function decideOnExit(s: { lockerRecording: boolean; owner: 'locker' | 'trigger' | null }):
  'stop-and-save' | 'leave-running' | 'noop' {
  if (s.lockerRecording || s.owner === 'locker') return 'stop-and-save';
  if (s.owner === 'trigger') return 'leave-running';
  return 'noop';
}
