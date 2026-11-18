# Evidence Store — Bounded-Memory Encryption Design

**Status**: DESIGN ONLY — the guard is implemented; chunked path is not  
**Author**: DHARA Agent  
**Date**: 2026-06

---

## 1. Current State

`evidenceStore.ts` encrypts and decrypts evidence files entirely in memory:

```typescript
// saveItem / saveSegment
const plainBytes  = await new File(uri).bytes();         // read whole file
const { cipherBytes } = await encryptBytes(plainBytes, aesKey, iv);
file.write(cipherBytes);

// getDecryptedTempUri
const cipherBytes = await new File(item.uri).bytes();
const plainBytes  = decryptBytes(cipherBytes, aesKey, item.iv);
```

Peak memory during one operation = 2 × fileSize (plain + cipher both live).

### Guard in place (June 2026)

`MAX_INLINE_BYTES = 24 MB` is checked before every `.bytes()` call.  Files
larger than this receive a user-readable error rather than a silent OOM crash.

Derivation:
```
128 MB min Android heap
−  50 MB JS/RN/UI overhead
=  78 MB available pool
÷   2   (plain + cipher both live at peak)
= 39 MB safe max
× 0.62  (38 % safety margin for GC jitter)
≈ 24 MB guard threshold
```

### What the guard protects

| Item type | Typical size | Hits guard? |
|---|---|---|
| Audio segment (5 s × 128 kbps AAC) | 78 KB | No |
| Photo (JPEG) | 2–15 MB | No |
| Short video (30 s @ 4 Mbps H.264) | 14 MB | No |
| Long video (60 s @ 4 Mbps H.264) | 29 MB | Yes |
| Long video (30 s @ 10 Mbps H.264) | 36 MB | Yes |

Videos longer than ~1 minute at typical mobile bitrates will be rejected.
Audio and photos are unaffected.

---

## 2. Chunked (Bounded-Memory) Path Design

### Why AES-256-CTR is chunk-friendly

CTR mode processes each 16-byte block independently: `Enc(nonce ‖ counter)`.  
The counter simply increments for each 16-byte block.  Given the initial IV
and a byte offset, the correct counter for any position in the stream can be
calculated as `IV + floor(offset / 16)`.  This means:

- Encryption: read chunk N → encrypt with counter at offset N → write → free N
- Decryption: same approach; order matters but memory does not

No CBC / GCM tag dependency across chunks — each chunk is fully independent.

### Proposed API

```typescript
// src/women/evidenceStoreCrypto.ts (new file)

import { File, FileHandle } from 'expo-file-system';
import { getOrCreateKey, makeCtrIv } from './evidenceCrypto';

const CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB — 2 × 4 MB peak = 8 MB per op

/**
 * Encrypts a file in CHUNK_BYTES pieces.  The IV is written as the first
 * 16 bytes of the output file so the decryption path can find it without
 * changing the RecordingItem schema (the `iv` field stays as hex string).
 *
 * Falls back to the original in-memory path for files < MAX_INLINE_BYTES
 * so small items do not pay the FileHandle overhead.
 */
export async function encryptFileChunked(
  scope: string,
  sourceUri: string,
  destUri: string,
): Promise<string /* iv hex */> {
  // ... use sourceHandle.read(offset, CHUNK_BYTES) + destHandle.write(offset, chunk)
}

export async function decryptFileChunked(
  scope: string,
  sourceUri: string,
  ivHex: string,
  destUri: string,
): Promise<void> {
  // ... symmetric
}
```

### FileHandle availability

expo-file-system ≥ 55 (currently `~55.0.26`) exposes `FileHandle` with:
- `read(position, length): Promise<Uint8Array>` — partial read by byte offset
- `write(data, position): Promise<void>` — partial write by byte offset
- `size: number` — file size without reading the content
- `close(): void`

This is sufficient for the chunked path.

### Migration path

1. Land `encryptFileChunked` / `decryptFileChunked` in a new module.
2. In `saveItem` and `saveSegment`, branch on `fileSize > MAX_INLINE_BYTES`:
   - `fileSize <= MAX_INLINE_BYTES` → existing in-memory path (no regression)
   - `fileSize >  MAX_INLINE_BYTES` → chunked path (lifts the ceiling)
3. Raise `MAX_INLINE_BYTES` to `Infinity` once chunked path is validated.
4. Remove the guard error.

The `RecordingItem` schema needs no change — `iv` stays a hex string.

---

## 3. `getSegmentedShareZipUri` Note

This function (evidence-locker export path for segmented recordings) already
decrypts segments one at a time and streams them into the zip via
`writableStream()`.  The per-segment memory peak is one segment ≈ 78 KB.  
No changes needed here.

---

## 4. `readEncryptedBytes` Note

Used by `evidenceBackup.ts` to read ciphertext before anchoring / uploading.
This function reads the whole ciphertext into one Uint8Array.  For the backup
path the OOM guard fires BEFORE the caller reaches this function (the item
would have been rejected at save time), so no additional guard is needed
today.  When the chunked save path is added, `readEncryptedBytes` should
also be replaced with a streaming read to allow large items to be backed up.
