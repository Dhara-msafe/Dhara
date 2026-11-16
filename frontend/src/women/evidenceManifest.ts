import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as aesjs from 'aes-js';
import { getOrCreateKey, encryptText, decryptText } from './evidenceCrypto';

/**
 * S-B5: Tamper-evident hash chain for the Evidence Locker.
 *
 * Every anchored item's SHA-256 is linked to the previous item's chain hash
 * (chainHash = SHA256(prevHash|sha256|id|createdAt)), so altering or
 * removing an earlier item breaks the chain for everything after it — a
 * citizen (or an officer later) can verify nothing was altered. The chain
 * lives per scope (per logged-in user, or "device" for guests), stored
 * locally; only hashes + timestamps are ever sent to the server (see
 * evidenceBackup.ts), never the file content.
 */

const MANIFEST_KEY_PREFIX = 'dhara_evidence_manifest_v1_';
export const GENESIS_HASH = '0'.repeat(64);

export type AnchorReceipt = { receiptId: string; serverTime: string; signature: string };
export type GpsPoint = { lat: number; lng: number; accuracy?: number };
export type BackupInfo = { storagePath: string; uploadedAt: string };
export type ManifestEntry = {
  id: string; sha256: string; prevHash: string; chainHash: string;
  createdAt: string; type: string; ext?: string; size: number;
  gps?: GpsPoint | null; anchor?: AnchorReceipt | null; backup?: BackupInfo | null;
  /** Set when the local copy was deleted from this device (see markManifestDeleted). */
  deletedAt?: string | null;
};

function toHex(bytes: Uint8Array): string { return aesjs.utils.hex.fromBytes(bytes); }

/** SHA-256 of raw bytes — run on the ciphertext already on disk. The server
 * never needs or sees the plaintext to verify this hash. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

// B-93 (D-27): `gps` is the one field on a manifest entry that is itself
// personal data (precise location of recorded evidence) rather than a hash
// or timestamp, so it's encrypted at rest here -- transparently, at the
// read/write boundary only. Every exported function above still takes and
// returns a plain ManifestEntry with a plain `gps: GpsPoint | null`; nothing
// about the public API changes. Reuses the same per-scope AES key already
// used for this scope's evidence files (evidenceCrypto.ts), so no new key
// material. An entry written before this change has no `gpsEnc` envelope and
// is passed through unchanged (legacy plaintext `gps`, if any, still reads
// back fine) -- it is simply encrypted the next time it's written.
type StoredManifestEntry = Omit<ManifestEntry, 'gps'> & {
  gps?: GpsPoint | null;
  gpsEnc?: { iv: string; cipher: string } | null;
};

async function readManifest(scope: string): Promise<ManifestEntry[]> {
  const raw = await AsyncStorage.getItem(`${MANIFEST_KEY_PREFIX}${scope}`);
  const stored: StoredManifestEntry[] = raw ? JSON.parse(raw) : [];
  if (!stored.some(e => e.gpsEnc)) return stored as ManifestEntry[]; // nothing to decrypt
  const key = await getOrCreateKey(scope);
  return stored.map(e => {
    if (!e.gpsEnc) return e as ManifestEntry;
    const { gpsEnc, ...rest } = e;
    try {
      const gps = JSON.parse(decryptText(gpsEnc.cipher, key, gpsEnc.iv)) as GpsPoint;
      return { ...rest, gps } as ManifestEntry;
    } catch {
      // Fail safe, never crash the locker over an undecryptable GPS point —
      // the chain hash itself does not depend on gps, so nothing else breaks.
      return { ...rest, gps: null } as ManifestEntry;
    }
  });
}
async function writeManifest(scope: string, entries: ManifestEntry[]): Promise<void> {
  const needsKey = entries.some(e => e.gps);
  const key = needsKey ? await getOrCreateKey(scope) : null;
  const stored: StoredManifestEntry[] = await Promise.all(entries.map(async e => {
    if (!e.gps) {
      const { gps, ...rest } = e;
      return { ...rest, gps: null };
    }
    const { gps, ...rest } = e;
    const { cipherHex, iv } = await encryptText(JSON.stringify(gps), key!);
    return { ...rest, gpsEnc: { iv, cipher: cipherHex } };
  }));
  await AsyncStorage.setItem(`${MANIFEST_KEY_PREFIX}${scope}`, JSON.stringify(stored));
}

export async function getManifestEntry(scope: string, id: string): Promise<ManifestEntry | null> {
  const entries = await readManifest(scope);
  return entries.find(e => e.id === id) || null;
}

/** Appends a new link to this scope's chain for `itemBytes` (the ciphertext
 * already on disk) and returns the computed entry. Does NOT contact the
 * server — call anchorItem() in evidenceBackup.ts afterwards for an
 * independent timestamp receipt. */
export async function appendToChain(
  scope: string,
  item: { id: string; type: string; ext?: string; createdAt: string },
  itemBytes: Uint8Array,
  gps?: GpsPoint | null,
): Promise<ManifestEntry> {
  const entries = await readManifest(scope);
  const prevHash = entries.length ? entries[entries.length - 1].chainHash : GENESIS_HASH;
  const sha256 = await sha256Hex(itemBytes);
  const chainHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${prevHash}|${sha256}|${item.id}|${item.createdAt}`,
  );
  const entry: ManifestEntry = {
    id: item.id, sha256, prevHash, chainHash, createdAt: item.createdAt,
    type: item.type, ext: item.ext, size: itemBytes.length, gps: gps || null, anchor: null, backup: null,
  };
  await writeManifest(scope, [...entries, entry]);
  return entry;
}

/** Records the server's independent timestamp receipt against an
 * already-chained entry — does not change the hash chain itself. */
export async function saveAnchorReceipt(scope: string, id: string, receipt: AnchorReceipt): Promise<void> {
  const entries = await readManifest(scope);
  await writeManifest(scope, entries.map(e => (e.id === id ? { ...e, anchor: receipt } : e)));
}

/** Records a completed cloud backup against an already-chained entry. */
export async function saveBackupInfo(scope: string, id: string, backup: BackupInfo): Promise<void> {
  const entries = await readManifest(scope);
  await writeManifest(scope, entries.map(e => (e.id === id ? { ...e, backup } : e)));
}

/** The item's local copy has been deleted. The chain LINK itself must stay —
 * removing a link would break hash verification for every entry saved after
 * it — so the entry is tombstoned instead: it stops being listed in the
 * locker, and its location data (the only personal detail in the entry) is
 * dropped. Only the entry with this exact id is touched. */
export async function markManifestDeleted(scope: string, id: string): Promise<void> {
  const entries = await readManifest(scope);
  await writeManifest(
    scope,
    entries.map(e => (e.id === id ? { ...e, gps: null, deletedAt: new Date().toISOString() } : e)),
  );
}
