import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Zip, ZipPassThrough } from 'fflate';
import { getOrCreateKey, encryptBytes, decryptBytes } from './evidenceCrypto';
import { listPendingTemps } from './evidencePendingTemp';

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

/**
 * Maximum file size (bytes) the in-memory encryption path can safely buffer
 * without risking an OOM crash on a 128 MB-heap Android device.
 *
 * Derivation (conservative floor):
 *   128 MB minimum Android heap
 *   −  50 MB JS runtime + React Native bridge + UI state headroom
 *   =  78 MB available for one operation.
 *   An encrypt or decrypt cycle holds TWO equal-sized Uint8Arrays at peak
 *   (plain + cipher), so the safe per-file limit is 78 / 2 = 39 MB.
 *   We use 24 MB — 38 % below that floor — to leave headroom for GC jitter
 *   and concurrent bridge allocations.
 *
 * Normal DHARA evidence items never approach this limit:
 *   • Audio segments: 5 s × 128 kbps AAC ≈ 78 KB each
 *   • Photos:         JPEG, typically 2–15 MB
 *   • Video clips:    ~14 MB per 30 s at 4 Mbps H.264 (safe)
 *                     ~29 MB per 60 s at 4 Mbps H.264 (safe)
 *                     ~36 MB per 30 s at 10 Mbps H.264 → first clip that
 *                       would trip this guard
 *
 * Future: a FileHandle-based chunked encryption/decryption path will remove
 * this ceiling entirely. Design tracked in
 * /app/memory/dhara_evidence/EVIDENCE_OOM_DESIGN.md
 */
export const MAX_INLINE_BYTES = 24 * 1024 * 1024; // 24 MB

export async function loadRecordings(scope: string): Promise<RecordingItem[]> {
  const rows: any[] = JSON.parse(await AsyncStorage.getItem(storageKey(scope)) || '[]');
  // Back-compat: items saved before photo/video support have no `type` — they were all audio.
  return rows.map(r => ({ type: 'audio', ...r }));
}

async function saveItem(scope: string, uri: string, type: EvidenceType, ext: string): Promise<RecordingItem> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = new File(Paths.document, `dhara-evidence-${id}.enc`);
  // OOM guard: check file size before allocating the buffer. The native
  // `File.size` getter returns 0 when the file is absent or unreadable, so a
  // zero result is treated as "unknown" and we proceed (bytes() will throw its
  // own error if the file really is gone).
  const sourceFile = new File(uri);
  const fileSize = (sourceFile as any).size as number ?? 0;
  if (fileSize > MAX_INLINE_BYTES) {
    throw new Error(
      `This ${type} is too large to save (${Math.round(fileSize / (1024 * 1024))} MB). ` +
      `The maximum supported size is ${Math.round(MAX_INLINE_BYTES / (1024 * 1024))} MB.`
    );
  }
  const plainBytes = await sourceFile.bytes();
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
  const all = await loadRecordings(scope);
  // A v2 (segmented) parent has no file of its own — `uri` is ''. Constructing
  // a File from an empty uri throws, which used to abort the whole delete and
  // left segmented recordings undeletable on device.
  const isV2Parent = item.recording_format_version === 2 && !!item.session_id;
  const segments = isV2Parent ? all.filter(r => r.is_segment && r.session_id === item.session_id) : [];
  const removeIds = new Set([item.id, ...segments.map(s => s.id)]);
  const remaining = all.filter(row => !removeIds.has(row.id));
  // Persist the new list FIRST: if this write fails, nothing is half-deleted —
  // the item stays listed and its file is still on disk.
  await AsyncStorage.setItem(storageKey(scope), JSON.stringify(remaining));
  for (const row of [item, ...segments]) {
    if (!row.uri) continue;
    try { const f = new File(row.uri); if (f.exists) f.delete(); } catch {}
  }
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
  // OOM guard — same derivation as saveItem above.
  const segFile = new File(uri);
  const segSize = (segFile as any).size as number ?? 0;
  if (segSize > MAX_INLINE_BYTES) {
    throw new Error(
      `Audio segment is too large to commit (${Math.round(segSize / (1024 * 1024))} MB). ` +
      `Max ${Math.round(MAX_INLINE_BYTES / (1024 * 1024))} MB.`
    );
  }
  const plainBytes = await segFile.bytes();
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
  // OOM guard: cipher and plain buffers are both live at peak during decryptBytes().
  const encFile = new File(item.uri);
  const encSize = (encFile as any).size as number ?? 0;
  if (encSize > MAX_INLINE_BYTES) {
    throw new Error(
      `This recording is too large to preview on this device ` +
      `(${Math.round(encSize / (1024 * 1024))} MB). ` +
      `Maximum previewable size is ${Math.round(MAX_INLINE_BYTES / (1024 * 1024))} MB.`
    );
  }
  const cipherBytes = await encFile.bytes();
  const plainBytes = decryptBytes(cipherBytes, aesKey, item.iv);
  const tempFile = new File(Paths.cache, `dhara-evidence-tmp-${item.id}-${Date.now()}.${item.ext || 'bin'}`);
  tempFile.write(plainBytes);
  return tempFile.uri;
}

/**
 * E2: a v2 (segmented) parent item has no encrypted file of its own
 * (`uri: ''`). Earlier this concatenated the raw decrypted bytes of every
 * segment into one file — abandoned because independent .m4a containers
 * (each with their own moov/mdat atoms) don't reliably concatenate into a
 * single playable file. This now exports a .zip with each segment as its
 * own part-NN file, in order, so every segment plays correctly on its own.
 *
 * Memory: segments are decrypted ONE AT A TIME (never all held at once),
 * and the zip output is streamed straight to disk via File.writableStream()
 * as fflate produces it — the full zip is never held in memory either.
 * Compression is "store only" (ZipPassThrough, not ZipDeflate) since the
 * underlying .m4a audio is already compressed.
 * Storage format / encryption of the underlying segments is unchanged —
 * this only builds a throwaway .zip copy for the share sheet.
 * Caller MUST call releaseDecryptedTempUri(uri, true) when done.
 */
export async function getSegmentedShareZipUri(scope: string, item: RecordingItem): Promise<string> {
  if (!item.session_id) throw new Error('No segments found for this recording.');
  const segments = await loadSegments(scope, item.session_id);
  if (segments.length === 0) throw new Error('No segments found for this recording.');
  const aesKey = await getOrCreateKey(scope);
  const defaultExt = item.ext || segments[0]?.ext || 'm4a';
  const zipFile = new File(Paths.cache, `dhara-evidence-tmp-${item.id}-${Date.now()}.zip`);
  const writer = zipFile.writableStream().getWriter();

  await new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, data, final) => {
      if (err) { reject(err); return; }
      if (data) { void writer.write(data).catch(reject); }
      if (final) { void writer.close().then(resolve).catch(reject); }
    });
    (async () => {
      try {
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const cipherBytes = await new File(seg.uri).bytes();
          const plainBytes = seg.iv ? decryptBytes(cipherBytes, aesKey, seg.iv) : cipherBytes;
          const partName = `part-${String(i + 1).padStart(2, '0')}.${seg.ext || defaultExt}`;
          const entry = new ZipPassThrough(partName);
          zip.add(entry);
          entry.push(plainBytes, true); // one segment at a time — plainBytes drops out of scope right after
        }
        zip.end();
      } catch (e) {
        reject(e);
      }
    })();
  });
  return zipFile.uri;
}

/** Deletes a temp file produced by `getDecryptedTempUri`. Safe to call on a
 * legacy item's original uri too — it only removes files under the cache
 * directory's temp naming, callers should still gate on having decrypted. */
export function releaseDecryptedTempUri(uri: string, wasDecrypted: boolean) {
  if (!wasDecrypted) return; // legacy plaintext item — uri IS the real file, never delete it
  try { const file = new File(uri); if (file.exists) file.delete(); } catch {}
}

/**
 * EL-054: Sweep `Paths.cache` for orphaned decrypted-plaintext temp files
 * that survived an unexpected session termination (app kill, OS crash, force
 * close during playback or sharing).
 *
 * Safe to call at any time — it only deletes files matching the
 * `dhara-evidence-tmp-*` prefix; never touches the user's saved evidence.
 *
 * Skips any URI that is currently listed in the pending-temp set (recordings
 * that have been captured but not yet encrypted and committed — these are
 * recovery targets, NOT cleanup targets).
 *
 * Device-specific notes
 * ─────────────────────
 * • Native (Android / iOS): files in `Paths.cache` are transient OS storage.
 *   The OS CAN reclaim them under storage pressure even without this sweep,
 *   but that is not guaranteed.  This function provides a deterministic wipe.
 * • Web: not applicable — the web version uses in-memory `blob:` URLs which
 *   are automatically revoked on page unload.  This function is a no-op stub
 *   in `evidenceStore.web.ts`.
 */
export async function sweepOrphanedEvidenceTempFiles(scope: string): Promise<void> {
  try {
    const pending = await listPendingTemps(AsyncStorage, scope);
    const pendingSet = new Set(pending.map(p => p.uri));
    const entries = Paths.cache.list();
    for (const entry of entries) {
      const name = entry.uri.split('/').pop() ?? '';
      if (!name.startsWith('dhara-evidence-tmp-')) continue;
      if (pendingSet.has(entry.uri)) continue; // unsealed recorder output — keep for recovery
      try { new File(entry.uri).delete(); } catch { /* non-fatal */ }
    }
  } catch {
    // Best-effort; log nothing — the caller should not surface this to the user.
  }
}

/**
 * EL-054: Returns true if the pending-temp source file at `uri` still exists
 * on disk.  Used in the restart recovery loop so stale entries (source file
 * purged by the OS between sessions) are cleared rather than retried on every
 * cold start.
 *
 * Returns false on any error (treat as "gone — clean it up").
 */
export function pendingTempFileExists(uri: string): boolean {
  try { return new File(uri).exists; } catch { return false; }
}
