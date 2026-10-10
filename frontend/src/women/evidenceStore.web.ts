import { getOrCreateKey, encryptBytes, decryptBytes } from './evidenceCrypto';

export type EvidenceType = 'audio' | 'photo' | 'video';
// `iv` present → `blob` in IndexedDB is AES-256-CTR ciphertext (S-B5).
// `uri` is intentionally left blank here — ciphertext must never be handed
// directly to <Image>/<Video>/<audio>; call `getDecryptedTempUri` first.
// `recording_format_version` 2 → segmented recording (P0-B).
export type RecordingItem = {
  id: string; uri: string; createdAt: string; type: EvidenceType;
  iv?: string; ext?: string;
  recording_format_version?: number;
  session_id?: string;
  is_segment?: boolean;
  segment_count?: number;
  total_duration_ms?: number;
};
type Stored = { id: string; scope: string; blob: Blob; createdAt: string; type: EvidenceType; iv?: string; ext?: string; is_segment?: boolean; session_id?: string; recording_format_version?: number; segment_count?: number; total_duration_ms?: number };

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
    .map(row => ({
      id: row.id, createdAt: row.createdAt, type: row.type || 'audio',
      iv: row.iv, ext: row.ext, uri: '',
      is_segment: row.is_segment, session_id: row.session_id,
      recording_format_version: row.recording_format_version,
      segment_count: row.segment_count, total_duration_ms: row.total_duration_ms,
    }));
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
  // P0-B: If v2 parent, also delete all segment rows
  if (item.recording_format_version === 2 && item.session_id) {
    const rows = await transaction<Stored[]>('readonly', store => store.getAll());
    const segIds = rows.filter(r => r.is_segment && r.session_id === item.session_id).map(r => r.id);
    // Delete parent + segments in one transaction
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      const store = tx.objectStore('recordings');
      store.delete(item.id);
      for (const id of segIds) store.delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Could not delete.')); };
    });
  }
  await transaction('readwrite', store => store.delete(item.id));
}
export function releaseRecordings(_items: RecordingItem[]) { /* no eagerly-created blob URLs to revoke anymore — see getDecryptedTempUri */ }
export function discardTemporaryRecording(uri: string | null) { if (uri) URL.revokeObjectURL(uri); }

// ── P0-B: Segmented recording helpers (web) ──────────────────────────────

/** Saves a single audio segment blob to IndexedDB. */
export async function saveSegment(scope: string, uri: string, sessionId: string): Promise<RecordingItem> {
  const sourceBlob = await (await fetch(uri)).blob();
  if (!sourceBlob.size) throw new Error('Segment is empty.');
  const plainBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const aesKey = await getOrCreateKey(scope);
  const { cipherBytes, iv } = await encryptBytes(plainBytes, aesKey);
  const cipherBlob = new Blob([cipherBytes as unknown as BlobPart]);
  const row: Stored = {
    id: `seg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    scope, blob: cipherBlob, createdAt: new Date().toISOString(),
    type: 'audio', iv, ext: 'webm', is_segment: true, session_id: sessionId,
  };
  await transaction('readwrite', store => store.put(row));
  return { id: row.id, createdAt: row.createdAt, type: 'audio', iv, ext: 'webm', uri: '', is_segment: true, session_id: sessionId };
}

/** Creates a v2 parent that references its segments by session_id. */
export async function createSegmentedParent(
  scope: string,
  sessionId: string,
  segmentCount: number,
  totalDurationMs: number,
): Promise<RecordingItem> {
  const row: Stored = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    scope, blob: new Blob([]), createdAt: new Date().toISOString(),
    type: 'audio', recording_format_version: 2, session_id: sessionId,
    segment_count: segmentCount, total_duration_ms: totalDurationMs,
  };
  await transaction('readwrite', store => store.put(row));
  return {
    id: row.id, createdAt: row.createdAt, type: 'audio', uri: '',
    recording_format_version: 2, session_id: sessionId,
    segment_count: segmentCount, total_duration_ms: totalDurationMs,
  };
}

/** Returns all segment items for a session. */
export async function loadSegments(scope: string, sessionId: string): Promise<RecordingItem[]> {
  const all = await loadRecordings(scope);
  return all
    .filter(r => r.is_segment && r.session_id === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Loads only non-segment items for display. */
export async function loadVisibleRecordings(scope: string): Promise<RecordingItem[]> {
  const all = await loadRecordings(scope);
  return all.filter(r => !r.is_segment);
}

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
