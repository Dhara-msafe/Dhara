/**
 * Trusted Circle Recipient Experience + Profile Photo — API client (P1–P4).
 * New, additive module. Does not touch src/women/api.ts (local-device
 * circle) — this governs the separate, authenticated, in-app linking layer.
 */
import { API_BASE } from '../apiBase';
import { uploadForm } from '../utils/upload';

const base = `${API_BASE}/api`;

function authHeaders(token: string | null) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Profile photo ────────────────────────────────────────────────────────
export async function uploadProfilePhoto(token: string, file: { uri: string; name: string; type: string }) {
  const r = await uploadForm(`${base}/profile/photo`, file, { fieldName: 'file', headers: authHeaders(token) as any });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || 'Upload failed');
  return r.json();
}
export async function removeProfilePhoto(token: string) {
  const r = await fetch(`${base}/profile/photo`, { method: 'DELETE', headers: authHeaders(token) });
  if (!r.ok) throw new Error('Could not remove photo');
  return r.json();
}
export async function setPhotoVisibility(token: string, mode: 'only_me' | 'accepted_circle') {
  const r = await fetch(`${base}/profile/visibility`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ mode }),
  });
  if (!r.ok) throw new Error('Could not update visibility');
  return r.json();
}
export async function editProfileName(token: string, name: string) {
  const r = await fetch(`${base}/profile/me`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error('Could not update name');
  return r.json();
}
export async function getPhotoViewToken(token: string): Promise<string | null> {
  try {
    const r = await fetch(`${base}/profile/photo-token`, { headers: authHeaders(token) });
    if (!r.ok) return null;
    return (await r.json()).token;
  } catch { return null; }
}

// ── Trusted Circle invitations ──────────────────────────────────────────
export type Permissions = { journey_status: boolean; expected_arrival: boolean; missed_checkin: boolean; temp_location: boolean; emergency_requests: boolean };
export type InviteLink = {
  id: string; owner_id: string; owner_name: string; contact_name: string; contact_phone: string;
  invitee_user_id: string | null; permissions: Permissions; status: string; muted: boolean;
  created_at: string; responded_at: string | null;
};

export async function inviteContact(token: string, body: { name: string; phone: string; permissions?: Partial<Permissions> }): Promise<{ ok: boolean; id: string; matched_existing_user: boolean }> {
  const r = await fetch(`${base}/trusted-circle/invite`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || 'Could not send invitation');
  return r.json();
}
export async function listInvitations(token: string, direction: 'sent' | 'received'): Promise<InviteLink[]> {
  try {
    const r = await fetch(`${base}/trusted-circle/invitations?direction=${direction}`, { headers: authHeaders(token) });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
export async function getInvitation(token: string, id: string): Promise<InviteLink | null> {
  try {
    const r = await fetch(`${base}/trusted-circle/invitations/${id}`, { headers: authHeaders(token) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
export async function respondInvitation(token: string, id: string, action: 'accept' | 'decline') {
  const r = await fetch(`${base}/trusted-circle/invitations/${id}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ action }),
  });
  if (!r.ok) throw new Error('Could not respond to invitation');
  return r.json();
}
export async function revokeInvitation(token: string, id: string) {
  const r = await fetch(`${base}/trusted-circle/invitations/${id}/revoke`, { method: 'POST', headers: authHeaders(token) });
  return r.ok;
}
export async function leaveCircle(token: string, id: string) {
  const r = await fetch(`${base}/trusted-circle/invitations/${id}/leave`, { method: 'POST', headers: authHeaders(token) });
  return r.ok;
}
export async function muteCircle(token: string, id: string, muted: boolean) {
  const r = await fetch(`${base}/trusted-circle/invitations/${id}/mute`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders(token) }, body: JSON.stringify({ muted }),
  });
  return r.ok;
}
export async function listAcceptedRecipients(token: string): Promise<InviteLink[]> {
  try {
    const r = await fetch(`${base}/trusted-circle/accepted`, { headers: authHeaders(token) });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

// ── Safety Alerts inbox ─────────────────────────────────────────────────
export type SafetyAlert = {
  id: string; type: string; title: string; owner_name: string; link_id: string | null;
  journey_token: string | null; payload: any; state: string; created_at: string;
  read_at: string | null; acknowledged_at: string | null; access_revoked?: boolean; permissions?: Permissions;
};

export async function listAlerts(token: string, filter: 'all' | 'active' | 'completed' = 'all'): Promise<SafetyAlert[]> {
  try {
    const r = await fetch(`${base}/alerts?filter=${filter}`, { headers: authHeaders(token) });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
export async function getAlert(token: string, id: string): Promise<SafetyAlert | null> {
  try {
    const r = await fetch(`${base}/alerts/${id}`, { headers: authHeaders(token) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
export async function markAlertRead(token: string, id: string) {
  try { await fetch(`${base}/alerts/${id}/read`, { method: 'POST', headers: authHeaders(token) }); } catch {}
}
export async function ackAlert(token: string, id: string) {
  const r = await fetch(`${base}/alerts/${id}/ack`, { method: 'POST', headers: authHeaders(token) });
  if (!r.ok) throw new Error('Could not acknowledge');
  return r.json();
}
export async function unreadCount(token: string): Promise<number> {
  try {
    const r = await fetch(`${base}/alerts/unread-count`, { headers: authHeaders(token) });
    return r.ok ? (await r.json()).count : 0;
  } catch { return 0; }
}
