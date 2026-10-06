import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { API_BASE, useAuth } from '../auth';

export type ScanHistoryItem = {
  id: string;
  extracted_text: string;
  summary: string;
  action: string;
  mode: string;
  lang: string;
  suggested_template?: string | null;
  prefill?: Record<string, string>;
  created_at: string;
  has_photo: boolean;
};

// Same shape/pattern as useComplaints() in complaints.ts — list of this
// user's saved scans (most recent first) for the "Documents" tab.
export function useScanHistory() {
  const { user, token } = useAuth();
  const [items, setItems] = useState<ScanHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!user?.id || !token) { setItems([]); setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    setLoading(true); setError(false);
    void fetch(`${API_BASE}/api/scan/history/${encodeURIComponent(user.id)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { if (active && Array.isArray(data)) setItems(data); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  // Retry deliberately changes the callback identity to restart the focused request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, token, attempt]));
  return { items, loading, error, retry: () => setAttempt(v => v + 1) };
}
