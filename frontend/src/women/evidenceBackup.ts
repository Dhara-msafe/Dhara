import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE } from '../apiBase';
import { readEncryptedBytes, type RecordingItem } from './evidenceStore';
import {
  appendToChain, saveAnchorReceipt, saveBackupInfo, getManifestEntry,
  type GpsPoint, type ManifestEntry, type AnchorReceipt,
} from './evidenceManifest';

/**
 * S-B5: Network layer for the Evidence Locker's optional cloud features.
 * Local encryption + the hash chain (evidenceManifest.ts) already work
 * fully offline; anchoring and backup are opt-in, per item, and require
 * connectivity only at the moment the citizen taps the button.
 */

const base = `${API_BASE}/api/evidence`;
const CHUNK_SIZE = 256 * 1024; // 256KB raw per chunk, sent base64-encoded

/** Uint8Array -> base64, used only on web where expo-file-system's legacy
 * module (needed for native's positional chunk reads below) has no web
 * implementation at all — btoa() is a standard browser global instead. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000; // avoid call-stack limits on String.fromCharCode for large arrays
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** NF-04: every route behind `${base}` (anchor, upload/init, upload/chunk,
 * upload/complete) requires current_user server-side (401 "Missing token"
 * with no Authorization header at all — see dependencies.py's
 * current_user) — this is real per-user evidence data, not a public
 * lookup. The caller must pass its auth token; the header is omitted
 * entirely when token is null/empty, matching the authHeaders() pattern
 * used elsewhere (src/trustedCircle/api.ts). */
function authHeader(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function anchorItem(
  scope: string,
  item: RecordingItem,
  gps: GpsPoint | null | undefined,
  token: string | null,
): Promise<{ entry: ManifestEntry; receipt: AnchorReceipt }> {
  const bytes = await readEncryptedBytes(item);
  const entry = await appendToChain(
    scope,
    { id: item.id, type: item.type, ext: item.ext, createdAt: item.createdAt },
    bytes,
    gps,
  );
  const res = await fetch(`${base}/anchor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify({
      item_id: item.id, scope, type: item.type,
      manifest_hash: entry.sha256, chain_hash: entry.chainHash, prev_hash: entry.prevHash,
      device_time: item.createdAt,
      gps: gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null,
    }),
  });
  if (!res.ok) throw new Error('Could not reach the server to timestamp this evidence. Try again when you have signal.');
  const data = await res.json();
  const receipt: AnchorReceipt = { receiptId: data.receipt_id, serverTime: data.server_time, signature: data.signature };
  await saveAnchorReceipt(scope, item.id, receipt);
  return { entry: { ...entry, anchor: receipt }, receipt };
}

/** Uploads the already-encrypted file (ciphertext) in chunks to Emergent
 * Object Storage — the server only ever handles AES-256 ciphertext, never
 * the plaintext recording/photo/video. Requires the item to be anchored
 * first so the backup is tied to a verified hash. */
export async function backupItem(
  scope: string,
  item: RecordingItem,
  onProgress: ((fraction: number) => void) | undefined,
  token: string | null,
): Promise<ManifestEntry> {
  const manifestEntry = await getManifestEntry(scope, item.id);
  if (!manifestEntry) throw new Error('Anchor this item before backing it up.');

  const isWeb = Platform.OS === 'web';
  const size = manifestEntry.size || 0;
  const totalChunks = isWeb ? 1 : Math.max(1, Math.ceil(size / CHUNK_SIZE));

  const initRes = await fetch(`${base}/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify({
      item_id: item.id, scope, total_chunks: totalChunks, ext: item.ext || 'bin',
      iv: item.iv || '', manifest_hash: manifestEntry.sha256,
    }),
  });
  if (!initRes.ok) throw new Error('Could not start the backup. Check your connection and try again.');
  const { session_id } = await initRes.json();

  // Web has no legacy-FileSystem implementation at all, so it reads the
  // whole (already in-memory-sized) file once via the same proven-working
  // File API as anchorItem(), then sends it as a single chunk. Native reads
  // true byte-range chunks straight off disk via the legacy FileSystem API.
  const webBytes = isWeb ? await readEncryptedBytes(item) : null;

  for (let i = 0; i < totalChunks; i++) {
    const data_b64 = isWeb
      ? bytesToBase64(webBytes as Uint8Array)
      : await FileSystem.readAsStringAsync(item.uri, {
          encoding: FileSystem.EncodingType.Base64,
          position: i * CHUNK_SIZE,
          length: Math.min(CHUNK_SIZE, size - i * CHUNK_SIZE),
        });
    let attempt = 0;
    for (;;) {
      try {
        const chunkRes = await fetch(`${base}/upload/chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({ session_id, index: i, data_b64 }),
        });
        if (!chunkRes.ok) throw new Error(`chunk ${i} failed`);
        break;
      } catch {
        attempt++;
        if (attempt >= 3) throw new Error('Upload interrupted. Please try backing up again.');
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    onProgress?.((i + 1) / totalChunks);
  }

  const completeRes = await fetch(`${base}/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify({ session_id }),
  });
  if (!completeRes.ok) throw new Error('Could not finish the backup. Please try again.');
  const result = await completeRes.json();
  const backup = { storagePath: result.storage_path, uploadedAt: result.uploaded_at };
  await saveBackupInfo(scope, item.id, backup);
  return { ...manifestEntry, backup };
}
