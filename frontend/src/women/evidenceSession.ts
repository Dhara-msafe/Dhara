import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * P0-B: Evidence Session Manager — crash/interruption-resilient segmented
 * recording for the Evidence Locker.
 *
 * ## Design
 * The recorder cycles every ~SEGMENT_TARGET_MS: stop → encrypt+persist the
 * segment → restart. Each committed segment is individually encrypted on disk
 * (via the existing evidenceStore) and survives any interruption that occurs
 * between commits. On normal Stop the current segment is committed and the
 * session is finalized.  On interruption (AppState, crash, navigate-away)
 * every committed segment is preserved and the session is marked "interrupted"
 * for recovery.
 *
 * ## Backward compatibility
 * Existing single-file recordings (format_version 1 / undefined) are
 * untouched. New segmented recordings carry format_version 2 and reference
 * their segments by id. Both coexist in the same evidence list.
 */

export const SEGMENT_TARGET_MS = 5_000; // ~5 seconds per segment

/**
 * Fix B: the on-screen recording timer must never read `startMs` before
 * start() has set it. `startMs === 0` happens when this screen remounts
 * while a session that began in an earlier mount keeps running (the
 * recorder lives in a provider above this screen, but the start-time ref is
 * local to this component instance) — previously this showed
 * `Date.now() - 0`, i.e. the full epoch in seconds. Returns 0 in that case,
 * and also clamps any runaway value over 24h back to 0 rather than showing
 * a nonsense number.
 */
export function computeSessionElapsedMs(nowMs: number, startMs: number): number {
  if (!startMs || startMs <= 0) return 0;
  const elapsed = nowMs - startMs;
  if (elapsed < 0 || elapsed > 24 * 60 * 60 * 1000) return 0;
  return elapsed;
}

export type SegmentStatus = 'recording' | 'committed';
export type SessionStatus = 'recording' | 'completed' | 'interrupted';

export interface SegmentMeta {
  /** Unique segment id */
  segId: string;
  /** Index within the session (0-based) */
  index: number;
  /** Evidence store item id for this segment's encrypted file */
  itemId: string;
  /** Approximate duration in ms */
  durationMs: number;
  /** ISO timestamp when segment was committed */
  committedAt: string;
  /** Status */
  status: SegmentStatus;
}

export interface EvidenceSession {
  sessionId: string;
  scope: string;
  status: SessionStatus;
  startedAt: string;
  completedAt?: string;
  segments: SegmentMeta[];
  /** The final RecordingItem id that represents this session in the evidence list */
  parentItemId?: string;
}

const SESSIONS_KEY = (scope: string) => `dhara_evidence_sessions_v1_${scope}`;

// ── Persistence ────────────────────────────────────────────────────────────

async function loadSessions(scope: string): Promise<EvidenceSession[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY(scope));
  return raw ? JSON.parse(raw) : [];
}

async function writeSessions(scope: string, sessions: EvidenceSession[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_KEY(scope), JSON.stringify(sessions));
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Creates a new recording session. Returns the sessionId. */
export async function createSession(scope: string): Promise<EvidenceSession> {
  const session: EvidenceSession = {
    sessionId: `ses-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    scope,
    status: 'recording',
    startedAt: new Date().toISOString(),
    segments: [],
  };
  const all = await loadSessions(scope);
  await writeSessions(scope, [...all, session]);
  return session;
}

/** Registers a committed segment into the session. Call this AFTER the
 * segment audio has been encrypted and persisted via evidenceStore. */
export async function commitSegment(
  scope: string,
  sessionId: string,
  segment: Omit<SegmentMeta, 'status'>,
): Promise<EvidenceSession> {
  const all = await loadSessions(scope);
  const idx = all.findIndex(s => s.sessionId === sessionId);
  if (idx < 0) throw new Error('Session not found');
  const session = { ...all[idx] };
  session.segments = [...session.segments, { ...segment, status: 'committed' as const }];
  all[idx] = session;
  await writeSessions(scope, all);
  return session;
}

/** Finalizes the session normally (user tapped Stop). Sets status to
 * "completed" and links the parent RecordingItem id. */
export async function finalizeSession(
  scope: string,
  sessionId: string,
  parentItemId: string,
): Promise<EvidenceSession> {
  const all = await loadSessions(scope);
  const idx = all.findIndex(s => s.sessionId === sessionId);
  if (idx < 0) throw new Error('Session not found');
  const session = { ...all[idx] };
  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  session.parentItemId = parentItemId;
  all[idx] = session;
  await writeSessions(scope, all);
  return session;
}

/** Marks a session as interrupted. Committed segments are preserved. */
export async function interruptSession(
  scope: string,
  sessionId: string,
): Promise<EvidenceSession | null> {
  const all = await loadSessions(scope);
  const idx = all.findIndex(s => s.sessionId === sessionId);
  if (idx < 0) return null;
  const session = { ...all[idx] };
  if (session.status === 'completed') return session; // already finalized
  session.status = 'interrupted';
  all[idx] = session;
  await writeSessions(scope, all);
  return session;
}

/** Returns all sessions for this scope that are interrupted and have at
 * least one committed segment — these are recoverable. */
export async function getRecoverableSessions(scope: string): Promise<EvidenceSession[]> {
  const all = await loadSessions(scope);
  return all.filter(s => s.status === 'interrupted' && s.segments.length > 0);
}

/** Loads a specific session. */
export async function getSession(scope: string, sessionId: string): Promise<EvidenceSession | null> {
  const all = await loadSessions(scope);
  return all.find(s => s.sessionId === sessionId) || null;
}

/** Promotes a recovered (interrupted) session to completed status, linking
 * the parent item. */
export async function recoverSession(
  scope: string,
  sessionId: string,
  parentItemId: string,
): Promise<EvidenceSession> {
  const all = await loadSessions(scope);
  const idx = all.findIndex(s => s.sessionId === sessionId);
  if (idx < 0) throw new Error('Session not found');
  const session = { ...all[idx] };
  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  session.parentItemId = parentItemId;
  all[idx] = session;
  await writeSessions(scope, all);
  return session;
}

/** Deletes a session and all its segment references (but NOT the encrypted
 * segment files themselves — those are managed by evidenceStore.deleteRecording). */
export async function deleteSession(scope: string, sessionId: string): Promise<void> {
  const all = await loadSessions(scope);
  await writeSessions(scope, all.filter(s => s.sessionId !== sessionId));
}

/** Returns the ordered list of segment item ids for playback. */
export function getSegmentItemIds(session: EvidenceSession): string[] {
  return session.segments
    .filter(s => s.status === 'committed')
    .sort((a, b) => a.index - b.index)
    .map(s => s.itemId);
}

/** Checks whether segmented recording is enabled. */
export function isSegmentedRecordingEnabled(): boolean {
  try {
    const val = process.env.EXPO_PUBLIC_EVIDENCE_SEGMENTED_RECORDING;
    return val === 'true' || val === '1';
  } catch {
    return false;
  }
}
