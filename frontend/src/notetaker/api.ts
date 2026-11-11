/**
 * api.ts — thin client for the Advocate Consultation Notetaker backend
 * (/api/notetaker/*). Mirrors the Pydantic models in
 * backend/api/advocate_notetaker_router.py exactly.
 */
import * as Crypto from 'expo-crypto';
import { API_BASE } from '@/src/auth';

/**
 * Fresh key for one logical write action (consent, consultation create,
 * task drafts). Falls back to a non-crypto pseudo-UUID instead of throwing
 * if the platform's crypto.randomUUID is unavailable (e.g. an insecure/HTTP
 * context) — the Idempotency-Key header is a best-effort safety net, so
 * generating it must never be able to block the actual request.
 */
export function newIdempotencyKey(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export type ConsultationState =
  | 'DRAFT' | 'CONSENT_PENDING' | 'READY' | 'IMPORTING' | 'AUDIO_REVIEW'
  | 'PROCESSING' | 'TRANSCRIPT_REVIEW' | 'NOTE_DRAFT' | 'APPROVED'
  | 'CONSENT_WITHDRAWN' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';

export type InputMethod = 'manual' | 'transcript_import' | 'audio_import';

export type ItemProvenance = 'generated' | 'edited';

export interface NoteItem {
  text: string;
  source_ref?: string;
  assignee?: string;
  /** N2: set server-side only — "generated" (untouched AI output) or "edited" (advocate changed/added it). */
  provenance?: ItemProvenance;
  /** N2: the original AI-generated text, preserved the first time an item is edited. null for advocate-authored items. */
  generated_text?: string | null;
}

export interface NoteSections {
  facts_stated: NoteItem[];
  client_instructions: NoteItem[];
  advice_given: NoteItem[];
  open_uncertainties: NoteItem[];
  proposed_actions: NoteItem[];
}

export interface StatuteCitation {
  statute: string;
  section?: string;
  relevance?: string;
}

export type NoteVersionSource = 'generated' | 'edit' | 'revise' | 'legacy';

export interface NoteDraft {
  version: number;
  /** N2 */
  parent_version?: number | null;
  generated_at: string;
  created_at?: string;
  sections: NoteSections;
  statute_citations: StatuteCitation[];
  /** N2 */
  author_id?: string | null;
  author_name?: string | null;
  diff_summary?: string | null;
  source?: NoteVersionSource;
  approved?: boolean;
  approved_at?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  content_hash?: string | null;
}

export interface ConsentSummary {
  status: 'not_started' | 'pending' | 'blocked' | 'ready' | 'withdrawn';
  reason: string | null;
  granted: number;
  declined: number;
  unknown: number;
  withdrawn: number;
}

export interface Consultation {
  id: string;
  matter_id: string;
  owner_id: string;
  title: string;
  date: string;
  purpose: string;
  input_method: InputMethod;
  language: string | null;
  state: ConsultationState;
  created_at: string;
  updated_at: string;
  manual_only_override?: boolean;
  manual_notes: string | null;
  original_transcript: string | null;
  working_transcript: string | null;
  speaker_labels: any[];
  audio_storage_key: string | null;
  audio_original_name: string | null;
  audio_size_bytes: number | null;
  audio_content_type: string | null;
  note_draft: NoteDraft | null;
  note_versions: NoteDraft[];
  approved_version: NoteDraft | null;
  processing_error: string | null;
  consent_summary?: ConsentSummary;
  /** N1-N2 follow-up fix #4: a pre-existing record that advanced past consent checks
   * despite a required participant's latest decision being declined/unknown. No new
   * Approve/Save/Revise is allowed until a fresh "given" decision is recorded. */
  legacy_consent_incomplete?: boolean;
  /** N1-N2 follow-up fix #3: true once CONSENT_WITHDRAWN — content fields below are
   * omitted (not deleted) and locked_reason explains why. */
  locked?: boolean;
  locked_reason?: string | null;
}

export const CONSENT_SCOPE_OPTIONS = ['notes', 'audio', 'transcription', 'storage'] as const;
export type ConsentScope = typeof CONSENT_SCOPE_OPTIONS[number];

/** The version of the consent notice/script currently read out to participants. Bump when the notice text changes. */
export const CURRENT_CONSENT_NOTICE_VERSION = 'v1';

export interface Consent {
  id: string;
  consultation_id: string;
  participant_name: string;
  participant_role: string | null;
  decision: 'given' | 'declined' | 'unknown' | 'withdrawn';
  required?: boolean;
  not_required_reason?: string | null;
  scope?: ConsentScope[];
  consent_notice_version?: string | null;
  evidence_ref?: string | null;
  recorded_at: string;
  withdrawn_at?: string | null;
}

export type TaskStatus = 'pending' | 'done';

export interface NtTask {
  id: string;
  consultation_id: string;
  matter_id: string;
  owner_id: string;
  text: string;
  assignee: string;
  source_ref: string;
  status: TaskStatus;
  created_at: string;
  completed_at?: string | null;
  matter_title?: string | null;
  consultation_title?: string | null;
}

/**
 * N2: thrown by updateNote/approveNoteVersion on a 409 version_conflict —
 * carries the server's current version/content so the UI can show a
 * conflict screen ("Reapply my edits") instead of a generic error.
 */
export class NoteVersionConflictError extends Error {
  current_version: number;
  current_sections: NoteSections;
  current_statute_citations: StatuteCitation[];
  constructor(detail: any) {
    super(detail?.message || 'This note changed since you loaded it.');
    this.name = 'NoteVersionConflictError';
    this.current_version = detail?.current_version;
    this.current_sections = detail?.current_sections || ({} as NoteSections);
    this.current_statute_citations = detail?.current_statute_citations || [];
  }
}

async function extractError(r: Response, fallback: string): Promise<string> {
  try {
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const err = await r.json();
      if (typeof err?.detail === 'string' && err.detail) return err.detail;
      if (Array.isArray(err?.detail) && err.detail.length > 0) {
        const first = err.detail[0];
        return (typeof first?.msg === 'string' && first.msg) || fallback;
      }
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function apiGet<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${API_BASE}/api/notetaker${path}`, { headers: authHeaders(token) });
  if (!r.ok) throw new Error(await extractError(r, 'Request failed'));
  return r.json();
}

/**
 * `idempotencyKey`, when supplied, is sent as an `Idempotency-Key` header —
 * the backend uses it to return the already-created/already-recorded
 * resource instead of making a duplicate on a retried tap or a flaky-network
 * resend. Callers that generate one should reuse the SAME key across retries
 * of one logical action and mint a fresh key for each new action.
 */
export async function apiPost<T>(token: string, path: string, body?: any, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = authHeaders(token);
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(`${API_BASE}/api/notetaker${path}`, init);
  if (!r.ok) throw new Error(await extractError(r, 'Request failed'));
  return r.json();
}

export async function apiPatch<T>(token: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = authHeaders(token);
  const init: RequestInit = { method: 'PATCH', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(`${API_BASE}/api/notetaker${path}`, init);
  if (!r.ok) throw new Error(await extractError(r, 'Request failed'));
  return r.json();
}

export async function apiDelete<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${API_BASE}/api/notetaker${path}`, { method: 'DELETE', headers: authHeaders(token) });
  if (!r.ok) throw new Error(await extractError(r, 'Request failed'));
  return r.json();
}

/** The export endpoint returns PlainTextResponse, not JSON — read as text. */
export async function fetchExportText(token: string, consultationId: string): Promise<string> {
  const r = await fetch(`${API_BASE}/api/notetaker/consultations/${consultationId}/export?fmt=text`, {
    headers: authHeaders(token),
  });
  if (!r.ok) throw new Error(await extractError(r, 'Export failed'));
  return r.text();
}

export async function listTasks(token: string, status: 'pending' | 'done' | 'all' = 'pending'): Promise<NtTask[]> {
  return apiGet<NtTask[]>(token, `/tasks?status=${status}`);
}

export async function updateTaskStatus(token: string, taskId: string, status: TaskStatus): Promise<{ ok: boolean; status: TaskStatus }> {
  return apiPatch(token, `/tasks/${taskId}/status`, { status });
}

/**
 * N2: save note edits. `expected_version` must be the version the UI last
 * loaded — on a 409 the server rejects the save instead of overwriting and
 * this throws NoteVersionConflictError with the server's current content.
 */
export async function updateNote(
  token: string, consultationId: string,
  sections: NoteSections, expectedVersion: number,
): Promise<{ ok: boolean; note_draft: NoteDraft }> {
  const r = await fetch(`${API_BASE}/api/notetaker/consultations/${consultationId}/note`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sections, expected_version: expectedVersion }),
  });
  if (r.status === 409) {
    const data = await r.json().catch(() => null);
    if (data?.detail?.error === 'version_conflict') throw new NoteVersionConflictError(data.detail);
  }
  if (!r.ok) throw new Error(await extractError(r, 'Could not save'));
  return r.json();
}

/** N2: approve a specific version. Idempotent repeat of the SAME version returns already_approved=true. */
export async function approveNoteVersion(
  token: string, consultationId: string, expectedVersion: number,
): Promise<{ ok: boolean; state: ConsultationState; content_hash: string; version: number; already_approved: boolean }> {
  const r = await fetch(`${API_BASE}/api/notetaker/consultations/${consultationId}/note/approve`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: expectedVersion }),
  });
  if (r.status === 409) {
    const data = await r.json().catch(() => null);
    if (data?.detail?.error === 'version_conflict') throw new NoteVersionConflictError(data.detail);
  }
  if (!r.ok) throw new Error(await extractError(r, 'Could not approve'));
  return r.json();
}

/** N2: reopen an APPROVED note for editing — creates an unapproved v+1 and returns state to NOTE_DRAFT. Not gated by advocate verification. */
export async function reviseNote(
  token: string, consultationId: string,
): Promise<{ ok: boolean; state: ConsultationState; note_draft: NoteDraft; approved_version: NoteDraft }> {
  return apiPost(token, `/consultations/${consultationId}/note/revise`);
}

/** N1-B2: withdraw a participant's consent. Halts further capture/upload/AI; existing material is left untouched. */
export async function withdrawConsent(
  token: string, consultationId: string, participantName: string, idempotencyKey?: string,
): Promise<{ id: string; consultation_state: ConsultationState; retention_policy: string }> {
  return apiPost(token, `/consultations/${consultationId}/consent/withdraw`, { participant_name: participantName }, idempotencyKey);
}

/** N1-B2: let the advocate proceed with manual notes only after a blocked/declined consent. */
export async function continueManualOnly(
  token: string, consultationId: string, idempotencyKey?: string,
): Promise<Consultation> {
  return apiPost(token, `/consultations/${consultationId}/consent/continue-manual-only`, undefined, idempotencyKey);
}
