export type RecordingItem = { id: string; uri: string; createdAt: string };
type Stored = { id: string; scope: string; blob: Blob; createdAt: string };
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
  return rows.filter(row => row.scope === scope).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(row => ({ id: row.id, createdAt: row.createdAt, uri: URL.createObjectURL(row.blob) }));
}
export async function saveRecording(scope: string, uri: string): Promise<RecordingItem> {
  const blob = await (await fetch(uri)).blob();
  if (!blob.size) throw new Error('The recording is empty. Please record again.');
  const row: Stored = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, scope, blob, createdAt: new Date().toISOString() };
  await transaction('readwrite', store => store.put(row));
  return { id: row.id, createdAt: row.createdAt, uri: URL.createObjectURL(blob) };
}
export async function deleteRecording(_scope: string, item: RecordingItem): Promise<void> {
  await transaction('readwrite', store => store.delete(item.id));
  URL.revokeObjectURL(item.uri);
}
export function releaseRecordings(items: RecordingItem[]) { items.forEach(item => URL.revokeObjectURL(item.uri)); }
export function discardTemporaryRecording(uri: string | null) { if (uri) URL.revokeObjectURL(uri); }