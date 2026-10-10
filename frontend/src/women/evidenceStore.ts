import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { getOrCreateKey, encryptBytes, decryptBytes } from './evidenceCrypto';

export type EvidenceType = 'audio' | 'photo' | 'video';
// `iv` present → file on disk is AES-256-CTR ciphertext (S-B5). Items saved
// before this change have no `iv` — treated as legacy plaintext, never run
// through decryption, so nothing already on a citizen's device breaks.
// `recording_format_version` 2 → segmented recording (P0-B); segments are
// individual RecordingItems referenced by `session_id`. Version 1 / undefined
// = legacy single-file. Both coexist.
export type RecordingItem = {
  id: string; uri: string; createdAt: string; type: EvidenceType;
  iv?: string; ext?: string;
  recording_format_version?: number;
  session_id?: string;
  /** True when this item is a segment (not the parent recording) */
  is_segment?: boolean;
  /** Number of segments for a v2 parent item */
  segment_count?: number;
  /** Total approximate duration in ms for a v2 parent item */
  total_duration_ms?: number;
};
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
  // P0-B: If this is a v2 parent, also delete all its segment items.
  if (item.recording_format_version === 2 && item.session_id) {
    const segItems = remaining.filter(r => r.is_segment && r.session_id === item.session_id);
    for (const seg of segItems) {
      try { const f = new File(seg.uri); if (f.exists) f.delete(); } catch {}
    }
    const afterSegDelete = remaining.filter(r => !(r.is_segment && r.session_id === item.session_id));
    await AsyncStorage.setItem(storageKey(scope), JSON.stringify(afterSegDelete));
    return;
  }
  await AsyncStorage.setItem(storageKey(scope), JSON.stringify(remaining));
}

// ── P0-B: Segmented recording helpers ─────────────────────────────────────

/** Saves a single audio segment — same encryption as saveRecording but marks
 * the item as a segment so it's hidden from the top-level evidence list. */
export async function saveSegment(
  scope: string,
  uri: string,
  sessionId: string,
): Promise<RecordingItem> {
  const id = `seg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = new File(Paths.document, `dhara-evidence-${id}.enc`);
  const plainBytes = await new File(uri).bytes();
  const aesKey = await getOrCreateKey(scope);
  const { cipherBytes, iv } = await encryptBytes(plainBytes, aesKey);
  try { file.write(cipherBytes); }
  catch (error) { if (file.exists) file.delete(); throw error; }
  const item: RecordingItem = {
    id, uri: file.uri, createdAt: new Date().toISOString(), type: 'audio',
    iv, ext: 'm4a', is_segment: true, session_id: sessionId,
  };
  try { await AsyncStorage.setItem(storageKey(scope), JSON.stringify([...await loadRecordings(scope), item])); }
  catch (error) { file.delete(); throw error; }
  return item;
}

/** Creates a v2 parent RecordingItem that represents a completed segmented
 * recording. It has no encrypted file of its own — playback reads its
 * segments (which are individually encrypted). */
export async function createSegmentedParent(
  scope: string,
  sessionId: string,
  segmentCount: number,
  totalDurationMs: number,
): Promise<RecordingItem> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item: RecordingItem = {
    id, uri: '', createdAt: new Date().toISOString(), type: 'audio',
    recording_format_version: 2, session_id: sessionId,
    segment_count: segmentCount, total_duration_ms: totalDurationMs,
  };
  await AsyncStorage.setItem(storageKey(scope), JSON.stringify([item, ...await loadRecordings(scope)]));
  return item;
}

/** Returns all segment items for a given session, ordered by createdAt. */
export async function loadSegments(scope: string, sessionId: string): Promise<RecordingItem[]> {
  const all = await loadRecordings(scope);
  return all
    .filter(r => r.is_segment && r.session_id === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Loads only non-segment items for display in the evidence list. */
export async function loadVisibleRecordings(scope: string): Promise<RecordingItem[]> {
  const all = await loadRecordings(scope);
  return all.filter(r => !r.is_segment);
}

/** S-B5: Reads an item's raw bytes exactly as stored on disk (ciphertext for
 * AES-encrypted items) — the same `File` read pattern already proven to
 * work cross-platform by getDecryptedTempUri() below, reused here so the
 * Evidence Vault (evidenceBackup.ts) never re-implements file access with a
 * different, less-tested API. */
export async function readEncryptedBytes(item: RecordingItem): Promise<Uint8Array> {
  return await new File(item.uri).bytes();
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
