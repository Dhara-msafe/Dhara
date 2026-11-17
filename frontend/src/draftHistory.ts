/**
 * Draft history — every notice a user creates is kept on the device so it can
 * be reopened, copied and re-sent later without spending another draft from the
 * quota (regenerating from history never calls /api/drafts/consume).
 *
 * Device-only by design: a legal notice contains names, addresses and amounts,
 * and there is no product reason to keep that on the server.
 *
 * B-93 (D-27): that same reasoning means it must not sit in plaintext on the
 * device either -- it's stored encrypted at rest (AES-256-CTR, the same
 * primitives already used for the Evidence Locker's files, reused here for a
 * small JSON blob via evidenceCrypto's encryptText/decryptText). A device-
 * level key is used (not per logged-in user) since this store was never
 * scoped per-account to begin with -- encrypting it doesn't change who can
 * see what, only that it's no longer plaintext on disk. Anything saved
 * before this change (a bare JSON array, no envelope) is still read back
 * correctly -- it is simply never re-encrypted until next written.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateKey, encryptText, decryptText } from './women/evidenceCrypto';
import { accountKey } from './accountStorage';

// D-09 / B-17 (17 Nov 2026): stored per account (src/accountStorage.ts), and
// each account's history is encrypted with that account's own key scope, so
// one account's notices are neither listed nor decryptable for another.
// The pre-D-09 shared copy is parked unread (see accountStorage.ts).
const STORE = 'dhara_draft_history_v1';
const KEY_SCOPE = 'draft_history';
const scopeFor = (storageKey: string) => `${KEY_SCOPE}_${storageKey.slice(STORE.length + 1)}`;
const MAX = 25;

export type DraftHistoryItem = {
  id: string;
  type: string;
  title: string;
  text: string;
  lang: 'en' | 'hi';
  created_at: string;
};

type StoredEnvelope = { v: 2; iv: string; cipher: string };

function isEnvelope(v: unknown): v is StoredEnvelope {
  return !!v && typeof v === 'object' && (v as any).v === 2
    && typeof (v as any).iv === 'string' && typeof (v as any).cipher === 'string';
}

export async function loadHistory(): Promise<DraftHistoryItem[]> {
  return loadFor(await accountKey(STORE));
}

async function loadFor(storageKey: string | null): Promise<DraftHistoryItem[]> {
  if (!storageKey) return [];
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed; // legacy plaintext — unchanged, no data loss
    if (isEnvelope(parsed)) {
      const key = await getOrCreateKey(scopeFor(storageKey));
      const plainText = decryptText(parsed.cipher, key, parsed.iv);
      return JSON.parse(plainText);
    }
    return [];
  } catch {
    return [];
  }
}

async function persist(storageKey: string | null, items: DraftHistoryItem[]): Promise<void> {
  if (!storageKey) return; // nobody signed in: never write a shared copy
  const key = await getOrCreateKey(scopeFor(storageKey));
  const { cipherHex, iv } = await encryptText(JSON.stringify(items), key);
  const envelope: StoredEnvelope = { v: 2, iv, cipher: cipherHex };
  await AsyncStorage.setItem(storageKey, JSON.stringify(envelope));
}

export async function addToHistory(
  item: Omit<DraftHistoryItem, 'id' | 'created_at'>,
): Promise<DraftHistoryItem[]> {
  const storageKey = await accountKey(STORE);
  if (!storageKey) return [];
  const items = await loadFor(storageKey);
  const next = [
    { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString() },
    ...items,
  ].slice(0, MAX);
  await persist(storageKey, next);
  return next;
}

export async function removeFromHistory(id: string): Promise<DraftHistoryItem[]> {
  const storageKey = await accountKey(STORE);
  if (!storageKey) return [];
  const items = (await loadFor(storageKey)).filter((i) => i.id !== id);
  await persist(storageKey, items);
  return items;
}

export async function findInHistory(id: string): Promise<DraftHistoryItem | undefined> {
  return (await loadHistory()).find((i) => i.id === id);
}
