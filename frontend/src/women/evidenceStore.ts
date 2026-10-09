import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { getOrCreateKey, encryptBytes, decryptBytes } from './evidenceCrypto';

export type EvidenceType = 'audio' | 'photo' | 'video';
// `iv` present → file on disk is AES-256-CTR ciphertext (S-B5). Items saved
// before this change have no `iv` — treated as legacy plaintext, never run
// through decryption, so nothing already on a citizen's device breaks.
export type RecordingItem = { id: string; uri: string; createdAt: string; type: EvidenceType; iv?: string; ext?: string };
const storageKey = (scope: string) => `dhara_local_recordings_${scope}`;

export async function loadRecordings(scope: string): Promise<RecordingItem[]> {
  const rows: any[] = JSON.parse(await AsyncStorage.getItem(storageKey(scope)) || '[]');
  // Back-compat: items saved before photo/video support have no `type` — they were all audio.
  return rows.map(r => ({ type: 'audio', ...r }));
}

async function saveItem(scope: string, uri: string, type: EvidenceType, ext: string): Promise<RecordingItem> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = new File(Paths.document, `dhara-evidence-${id}.enc`);
  const plainBytes = await new File(uri).bytes();
  const aesKey = await getOrCreateKey(scope);
  const { cipherBytes, iv } = await encryptBytes(plainBytes, aesKey);
  try {
    file.write(cipherBytes);
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
  const item: RecordingItem = { id, uri: file.uri, createdAt: new Date().toISOString(), type, iv, ext };
  try { await AsyncStorage.setItem(storageKey(scope), JSON.stringify([item, ...await loadRecordings(scope)])); }
  catch (error) { file.delete(); throw error; }
  return item;
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
export async function deleteRecording(scope: string, item: RecordingItem): Promise<void> {
  const remaining = (await loadRecordings(scope)).filter(row => row.id !== item.id);
  const file = new File(item.uri);
  if (file.exists) file.delete();
  await AsyncStorage.setItem(storageKey(scope), JSON.stringify(remaining));
}
export function releaseRecordings(_items: RecordingItem[]) { /* Native URIs are durable files. */ }
export function discardTemporaryRecording(uri: string | null) {
  if (!uri) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch {}
}

/**
 * S-B5: Decrypts an item into a throwaway cache file for preview/playback/
 * share, and returns its uri. Legacy plaintext items (no `iv`) are returned
 * as-is — nothing to decrypt. Caller MUST call `releaseDecryptedTempUri`
 * once done (e.g. on stop/unmount) so the plain copy doesn't linger on disk.
 */
export async function getDecryptedTempUri(scope: string, item: RecordingItem): Promise<string> {
  if (!item.iv) return item.uri; // legacy plaintext — pass through unchanged
  const aesKey = await getOrCreateKey(scope);
  const cipherBytes = await new File(item.uri).bytes();
  const plainBytes = decryptBytes(cipherBytes, aesKey, item.iv);
  const tempFile = new File(Paths.cache, `dhara-evidence-tmp-${item.id}-${Date.now()}.${item.ext || 'bin'}`);
  tempFile.write(plainBytes);
  return tempFile.uri;
}

/** Deletes a temp file produced by `getDecryptedTempUri`. Safe to call on a
 * legacy item's original uri too — it only removes files under the cache
 * directory's temp naming, callers should still gate on having decrypted. */
export function releaseDecryptedTempUri(uri: string, wasDecrypted: boolean) {
  if (!wasDecrypted) return; // legacy plaintext item — uri IS the real file, never delete it
  try { const file = new File(uri); if (file.exists) file.delete(); } catch {}
}
