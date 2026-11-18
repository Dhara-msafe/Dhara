/**
 * N-09 — deleting an item from the Evidence Locker must also delete its
 * cloud copy, not just the local copy on the phone.
 *
 * Before this fix: remove() in evidence-locker.tsx only ever deleted the
 * local file + tombstoned the manifest entry. The backend already had a
 * working, owner-checked delete endpoint (DELETE /api/evidence/backups/
 * {item_id} in evidence_vault_router.py, which deletes the storage object
 * AND the db.evidence_backups row) — nothing on the frontend ever called
 * it. The delete-confirmation dialog even told the user the cloud copy
 * "stays in the cloud", by design, which is exactly the bug.
 *
 * Fix: evidenceBackup.ts gets a new deleteBackupCloud() that calls that
 * endpoint and never throws (a network failure must not block the local
 * delete the user actually asked for — it returns a tri-state result
 * instead). evidenceManifest.ts gets clearBackupInfo() to drop the stale
 * backup record once the cloud object is actually gone. evidence-locker.tsx
 * wires both into remove(), capturing whether a backup existed BEFORE the
 * manifestMap entry is deleted further down the same function, and updates
 * the dialog copy to stop promising the cloud copy will survive.
 *
 * evidenceBackup.ts / evidenceManifest.ts / evidence-locker.tsx all
 * transitively import expo-file-system / expo-router, which don't resolve
 * under plain Node in this sandbox — source-level wiring checks only, same
 * convention as b89_evidence_locker_pin_per_account.test.mjs.
 *
 * Run with:
 *   node --experimental-strip-types --test src/women/__tests__/n09_evidence_locker_cloud_delete.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_SRC = readFileSync(join(__dirname, '..', 'evidenceBackup.ts'), 'utf8');
const MANIFEST_SRC = readFileSync(join(__dirname, '..', 'evidenceManifest.ts'), 'utf8');
const SCREEN_SRC = readFileSync(join(__dirname, '..', '..', '..', 'app', 'women', 'evidence-locker.tsx'), 'utf8');
const BACKEND_SRC = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'backend', 'api', 'evidence_vault_router.py'),
  'utf8',
);

test('the backend delete-backup endpoint this fix calls actually exists and is owner-checked', () => {
  assert.ok(BACKEND_SRC.includes('@router.delete("/evidence/backups/{item_id}")'));
  assert.ok(BACKEND_SRC.includes('await delete_raw_object(doc["storage_path"])'));
  assert.ok(BACKEND_SRC.includes('await db.evidence_backups.delete_one({"_id": doc["_id"]})'));
});

test('evidenceBackup.ts exports deleteBackupCloud, calling DELETE on the backups endpoint', () => {
  assert.ok(BACKUP_SRC.includes('export async function deleteBackupCloud('));
  assert.match(BACKUP_SRC, /deleteBackupCloud[\s\S]{0,400}method: 'DELETE'/);
  assert.match(BACKUP_SRC, /deleteBackupCloud[\s\S]{0,400}`\$\{base\}\/backups\/\$\{itemId\}/);
});

test('deleteBackupCloud never throws — network/5xx failures resolve to a result, not a rejection', () => {
  assert.match(BACKUP_SRC, /deleteBackupCloud[\s\S]{0,800}catch[\s\S]{0,60}return 'failed'/);
  assert.match(BACKUP_SRC, /deleteBackupCloud[\s\S]{0,800}404[\s\S]{0,40}return 'none'/);
});

test('evidenceManifest.ts exports clearBackupInfo, which nulls only the backup field', () => {
  assert.ok(MANIFEST_SRC.includes('export async function clearBackupInfo('));
  assert.match(MANIFEST_SRC, /clearBackupInfo[\s\S]{0,300}backup: null/);
});

test('clearBackupInfo touches only the matching entry, same guard pattern as the other per-id writers', () => {
  const idx = MANIFEST_SRC.indexOf('export async function clearBackupInfo(');
  const body = MANIFEST_SRC.slice(idx, idx + 400);
  assert.ok(/e\.id === id \? \{ \.\.\.e, backup: null \} : e/.test(body));
});

test('evidence-locker.tsx imports deleteBackupCloud and clearBackupInfo', () => {
  assert.ok(SCREEN_SRC.includes("import { anchorItem, backupItem, deleteBackupCloud } from '@/src/women/evidenceBackup';"));
  assert.ok(
    SCREEN_SRC.includes('clearBackupInfo') &&
    /import \{[^}]*clearBackupInfo[^}]*\} from '@\/src\/women\/evidenceManifest';/.test(SCREEN_SRC)
  );
});

test('remove() captures whether a backup existed BEFORE manifestMap is mutated, not after', () => {
  const removeIdx = SCREEN_SRC.search(/const remove = useCallback\(async \(item: RecordingItem\) => \{/);
  assert.notEqual(removeIdx, -1, 'could not locate remove()');
  const hadBackupIdx = SCREEN_SRC.indexOf('hadBackup', removeIdx);
  const manifestMapDeleteIdx = SCREEN_SRC.indexOf('delete next[item.id]; return next;', removeIdx);
  assert.ok(hadBackupIdx !== -1 && manifestMapDeleteIdx !== -1);
  assert.ok(
    hadBackupIdx < manifestMapDeleteIdx,
    'hadBackup must be read before manifestMap[item.id] is deleted — that deletion happens further down the same function'
  );
});

test('remove() calls deleteBackupCloud only when a backup existed, and awaits it', () => {
  assert.match(SCREEN_SRC, /if \(hadBackup\) \{\s*cloudResult = await deleteBackupCloud\(scope, item\.id, token\);/);
});

test('a cloud-delete failure never blocks or rolls back the local delete the user asked for', () => {
  const removeIdx = SCREEN_SRC.search(/const remove = useCallback\(async \(item: RecordingItem\) => \{/);
  const body = SCREEN_SRC.slice(removeIdx, removeIdx + 3000);
  // deleteBackupCloud() itself never throws (checked above); confirm the
  // call site doesn't wrap it in something that would abort the function
  // on a 'failed' result (no early return / throw keyed on cloudResult).
  assert.ok(!/if \(cloudResult === 'failed'\)[\s\S]{0,40}(return|throw)/.test(body));
});

test('on success or "never backed up", the stale backup record is cleared locally', () => {
  assert.match(
    SCREEN_SRC,
    /if \(cloudResult === 'deleted' \|\| cloudResult === 'none'\) \{\s*await clearBackupInfo\(scope, item\.id\)/
  );
});

test('the delete-confirmation dialog no longer promises the cloud copy survives', () => {
  assert.ok(
    !SCREEN_SRC.includes('stays in the cloud'),
    'the old "stays in the cloud" promise must be gone now that delete actually removes it'
  );
  assert.ok(SCREEN_SRC.includes('deleting it also deletes that cloud copy'));
});

test('the post-delete toast is honest about a failed cloud delete, not just "deleted"', () => {
  assert.ok(SCREEN_SRC.includes('Could not reach the server to delete the cloud copy'));
  assert.ok(SCREEN_SRC.includes('Recording and its cloud backup have both been deleted.'));
});
