/**
 * Saved answers ("bookmarks").
 *
 * Design rule: the DEVICE is the source of truth for reading. Everything is
 * written to AsyncStorage first so a saved answer opens instantly with no
 * network — the "standing in a police station with one bar of signal" case.
 * The server copy is only a sync target so the collection survives a reinstall
 * or a new phone.
 *
 * Each item carries a `client_id` generated on the device; the API is
 * idempotent on (user, client_id) so re-pushing a queue after being offline
 * never creates duplicates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountKey } from './accountStorage';

// D-09 / B-17: stored per account (see src/accountStorage.ts). Every exported
// function resolves this account's key ONCE at the start and passes it down,
// so a sync still running when the account changes can never read or write
// the next account's list (or push one account's answers into another's
// server copy).
const STORE = 'dhara_bookmarks_v1';

export type SavedCitation = {
  key: string;
  citation: string;
  short_label: string;
  act: string;
  official_text: string;
  source_url: string;
  verified_at: string;
};

export type Bookmark = {
  client_id: string;
  question: string;
  answer: string;
  language: string;
  citations: SavedCitation[];
  created_at: string;
  /** false while the item still has to be pushed to the server */
  synced: boolean;
  /** local tombstone — removed from the list once the server confirms */
  pending_delete?: boolean;
};

async function write(key: string | null, items: Bookmark[]) {
  if (!key) return; // nobody signed in: never write a shared copy
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

async function loadRaw(key: string | null): Promise<Bookmark[]> {
  if (!key) return [];
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function loadLocal(): Promise<Bookmark[]> {
  return (await loadRaw(await accountKey(STORE))).filter((i) => !i.pending_delete);
}

export async function isSaved(question: string, answer: string): Promise<boolean> {
  const items = await loadLocal();
  return items.some((i) => i.question === question && i.answer === answer);
}

export async function addBookmark(
  apiBase: string,
  token: string | null,
  b: Omit<Bookmark, 'client_id' | 'created_at' | 'synced'>,
): Promise<Bookmark[]> {
  const key = await accountKey(STORE);
  if (!key) return [];
  const items = await loadRaw(key);
  const item: Bookmark = {
    ...b,
    client_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    synced: false,
  };
  const next = [item, ...items];
  await write(key, next);
  // Fire-and-forget push; if it fails the item stays unsynced and the next
  // sync() attempt picks it up.
  if (token) {
    push(apiBase, token, key, item).catch(() => {});
  }
  return next.filter((i) => !i.pending_delete);
}

export async function removeBookmark(
  apiBase: string,
  token: string | null,
  clientId: string,
): Promise<Bookmark[]> {
  const key = await accountKey(STORE);
  if (!key) return [];
  const items = await loadRaw(key);
  let next = items.map((i) =>
    i.client_id === clientId ? { ...i, pending_delete: true } : i,
  );
  if (token) {
    try {
      await fetch(`${apiBase}/api/bookmarks/${clientId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      next = next.filter((i) => i.client_id !== clientId);
    } catch {
      // stays as a local tombstone; sync() retries the delete
    }
  } else {
    next = next.filter((i) => i.client_id !== clientId);
  }
  await write(key, next);
  return next.filter((i) => !i.pending_delete);
}

async function push(apiBase: string, token: string, key: string, item: Bookmark) {
  const res = await fetch(`${apiBase}/api/bookmarks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      client_id: item.client_id,
      question: item.question,
      answer: item.answer,
      language: item.language,
      citations: item.citations,
      created_at: item.created_at,
    }),
  });
  if (!res.ok) throw new Error('push failed');
  const items = await loadRaw(key);
  await write(key, items.map((i) => (i.client_id === item.client_id ? { ...i, synced: true } : i)));
}

/**
 * Two-way sync. Pushes local additions and deletions, then merges anything the
 * server has that this device does not (reinstall / second device). Silently
 * returns the local list if the network is unavailable — never throws.
 */
export async function syncBookmarks(apiBase: string, token: string | null): Promise<Bookmark[]> {
  if (!token) return loadLocal();
  const key = await accountKey(STORE);
  if (!key) return [];
  let items = await loadRaw(key);
  // 1. deletions first so a tombstoned item is not resurrected by the pull
  for (const t of items.filter((i) => i.pending_delete)) {
    try {
      await fetch(`${apiBase}/api/bookmarks/${t.client_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      items = items.filter((i) => i.client_id !== t.client_id);
    } catch {
      return items.filter((i) => !i.pending_delete);
    }
  }
  await write(key, items);
  // 2. push unsynced additions
  for (const u of items.filter((i) => !i.synced)) {
    try {
      await push(apiBase, token, key, u);
    } catch {
      return (await loadRaw(key)).filter((i) => !i.pending_delete);
    }
  }
  // 3. pull and merge
  try {
    const res = await fetch(`${apiBase}/api/bookmarks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('pull failed');
    const remote: any[] = await res.json();
    const local = await loadRaw(key);
    const known = new Set(local.map((i) => i.client_id));
    const added: Bookmark[] = remote
      .filter((r) => r.client_id && !known.has(r.client_id))
      .map((r) => ({
        client_id: r.client_id,
        question: r.question || '',
        answer: r.answer || '',
        language: r.language || 'en',
        citations: r.citations || [],
        created_at: r.created_at || new Date().toISOString(),
        synced: true,
      }));
    const merged = [...local, ...added]
      .filter((i) => !i.pending_delete)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    await write(key, merged);
    return merged;
  } catch {
    return (await loadRaw(key)).filter((i) => !i.pending_delete);
  }
}
