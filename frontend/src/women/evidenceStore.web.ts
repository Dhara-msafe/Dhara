import { getOrCreateKey, encryptBytes, decryptBytes } from './evidenceCrypto';

export type EvidenceType = 'audio' | 'photo' | 'video';
// `iv` present → `blob` in IndexedDB is AES-256-CTR ciphertext (S-B5).
// `uri` is intentionally left blank here — ciphertext must never be handed
// directly to <Image>/<Video>/<audio>; call `getDecryptedTempUri` first.
export type RecordingItem = { id: string; uri: string; createdAt: string; type: EvidenceType; iv?: string; ext?: string };
type Stored = { id: string; scope: string; blob: Blob; createdAt: string; type: EvidenceType; iv?: string; ext?: string };

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dhara-local-recordings', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Device storage is unavailable. Recording was not saved.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', mode);
    const req = action(tx.objectStore('recordings'));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Could not save changes to device storage.')); };
  });
}

export async function loadRecordings(scope: string): Promise<RecordingItem[]> {
  const rows = await transaction<Stored[]>('readonly', store => store.getAll());
  return rows
    .filter(row => row.scope === scope)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(row => ({ id: row.id, createdAt: row.createdAt, type: row.type || 'audio', iv: row.iv, ext: row.ext, uri: '' }));
}

async function saveItem(scope: string, uri: string, type: EvidenceType, ext: string): Promise<RecordingItem> {
  const sourceBlob = await (await fetch(uri)).blob();
  if (!sourceBlob.size) throw new Error(`The ${type} is empty. Please try again.`);
  const plainBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const aesKey = await getOrCreateKey(scope);
  const { cipherBytes, iv } = await encryptBytes(plainBytes, aesKey);
  const cipherBlob = new Blob([cipherBytes as unknown as BlobPart]);
  const row: Stored = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, scope, blob: cipherBlob, createdAt: new Date().toISOString(), type, iv, ext };
  await transaction('readwrite', store => store.put(row));
  return { id: row.id, createdAt: row.createdAt, type, iv, ext, uri: '' };
}
export async function saveRecording(scope: string, uri: string): Promise<RecordingItem> {
  return saveItem(scope, uri, 'audio', 'm4a');
}
export async function savePhoto(scope: string, uri: string): Promise<RecordingItem> {
  return saveItem(scope, uri, 'photo', 'jpg');
}
export async function saveVideo(scope: string, uri: string): Promise<RecordingItem> {
  return saveItem(scope, uri, 'video', 'mp4');
}
export async function deleteRecording(_scope: string, item: RecordingItem): Promise<void> {
  await transaction('readwrite', store => store.delete(item.id));
}
export function releaseRecordings(_items: RecordingItem[]) { /* no eagerly-created blob URLs to revoke anymore — see getDecryptedTempUri */ }
export function discardTemporaryRecording(uri: string | null) { if (uri) URL.revokeObjectURL(uri); }

/**
 * S-B5: Decrypts the stored ciphertext blob into a fresh `blob:` URL for
 * preview/playback/share. Legacy plaintext items (no `iv`, saved before
 * this change) are read back and handed out as-is. Caller MUST revoke the
 * returned URL via `releaseDecryptedTempUri` once done.
 */
export async function getDecryptedTempUri(scope: string, item: RecordingItem): Promise<string> {
  const rows = await transaction<Stored[]>('readonly', store => store.getAll());
  const row = rows.find(r => r.id === item.id);
  if (!row) throw new Error('This item could not be found on this device anymore.');
  if (!row.iv) return URL.createObjectURL(row.blob); // legacy plaintext
  const aesKey = await getOrCreateKey(scope);
  const cipherBytes = new Uint8Array(await row.blob.arrayBuffer());
  const plainBytes = decryptBytes(cipherBytes, aesKey, row.iv);
  return URL.createObjectURL(new Blob([plainBytes as unknown as BlobPart]));
}

export function releaseDecryptedTempUri(uri: string, _wasDecrypted: boolean) {
  URL.revokeObjectURL(uri);
}

/** S-B5: Returns the item's raw stored bytes — ciphertext for AES-encrypted
 * items, exactly as persisted — WITHOUT decrypting. This is the web
 * counterpart of evidenceStore.ts's native readEncryptedBytes(): both give
 * the Evidence Vault (evidenceBackup.ts) the same ciphertext-only bytes to
 * hash/anchor/upload, never plaintext. */
export async function readEncryptedBytes(item: RecordingItem): Promise<Uint8Array> {
  const rows = await transaction<Stored[]>('readonly', store => store.getAll());
  const row = rows.find(r => r.id === item.id);
  if (!row) throw new Error('This item could not be found on this device anymore.');
  return new Uint8Array(await row.blob.arrayBuffer());
}
