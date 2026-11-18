/**
 * Chunked crypto stub — web
 * -------------------------
 * Web evidence is stored as IndexedDB blob: URLs via `evidenceStore.web.ts`.
 * The web in-memory encryption path in that module handles all web-side
 * encrypt/decrypt; the chunked FileHandle path (native only) is never called
 * from any supported web flow.
 *
 * These stubs exist as a safety net.  If they are ever reached, it means a
 * routing bug has sent a web request down the native path — this should be
 * treated as a programming error, not a user-facing failure.
 */
export const CHUNK_SIZE = 4 * 1024 * 1024;

export async function encryptFileChunked(
  _scope: string,
  _sourceUri: string,
  _destFile: unknown,
): Promise<string> {
  throw new Error(
    'evidenceChunkedCrypto: chunked file encryption reached the web stub. ' +
    'This is a routing bug — web flows should use evidenceStore.web.ts instead.',
  );
}

export async function decryptFileChunked(
  _scope: string,
  _cipherUri: string,
  _tempFile: unknown,
): Promise<void> {
  throw new Error(
    'evidenceChunkedCrypto: chunked file decryption reached the web stub. ' +
    'This is a routing bug — web flows should use evidenceStore.web.ts instead.',
  );
}

// Exported for type parity with the native module
export async function deriveHmacKey(
  _aesKey: Uint8Array, _iv: Uint8Array,
): Promise<Uint8Array> { throw new Error('web stub'); }
export function prepareHmacKeys(
  _k: Uint8Array,
): [Uint8Array, Uint8Array] { throw new Error('web stub'); }
export async function computeChunkMac(
  _iK: Uint8Array, _oK: Uint8Array, _i: number, _c: Uint8Array,
): Promise<Uint8Array> { throw new Error('web stub'); }
export async function computeRootMac(
  _k: Uint8Array, _iv: Uint8Array, _n: number, _macs: Uint8Array[],
): Promise<Uint8Array> { throw new Error('web stub'); }
