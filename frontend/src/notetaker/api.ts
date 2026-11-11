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
  | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';

export type InputMethod = 'manual' | 'transcript_import' | 'audio_import';

export interface NoteItem {
  text: string;
  source_ref?: string;
  assignee?: string;
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

export interface NoteDraft {
  version: number;
  generated_at: string;
  sections: NoteSections;
  statute_citations: StatuteCitation[];
  approved_at?: string;
  approved_by?: string;
  content_hash?: string;
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
}

export interface Consent {
  id: string;
  consultation_id: string;
  participant_name: string;
  participant_role: string | null;
  decision: 'given' | 'declined' | 'unknown' | 'withdrawn';
  required?: boolean;
  recorded_at: string;
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
