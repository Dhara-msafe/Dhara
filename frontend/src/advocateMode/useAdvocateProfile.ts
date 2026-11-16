/**
 * B-121 — shared advocate-profile gate.
 *
 * ADVOCATE_MODE_ENABLED (flags.ts) only controls whether advocate/lawyer
 * features exist in this build at all. It says nothing about who the
 * signed-in user is: with the flag on, every advocate/lawyer/Notetaker
 * screen previously rendered its full UI shell for ANY signed-in account,
 * citizen or advocate alike, before any API call had a chance to 403.
 * Backend endpoints (advocate_notetaker_router.py's _require_advocate /
 * _require_verified_advocate) already reject a non-advocate's requests,
 * but by then the screen itself -- titles, cards, "Create Matter" /
 * "Create Intake" controls -- had already rendered.
 *
 * This hook is the client-side half of that lock: it resolves whether the
 * signed-in user has an advocate profile at all, so a screen can redirect
 * a citizen account away before rendering anything advocate-facing,
 * instead of relying on the eventual 403 from a background fetch.
 *
 * Usage (after ADVOCATE_MODE_ENABLED's early return, as the FIRST hook
 * call in the component, so it runs unconditionally every render):
 *
 *   const advocateGate = useAdvocateProfile();
 *   ...the screen's own hooks, unchanged...
 *   if (advocateGate.status === 'none') return <Redirect href="/(tabs)/home" />;
 *   if (advocateGate.status === 'loading') return null; // or a spinner
 *   // advocateGate.status === 'found' -- advocateGate.profile is available
 *
 * Do NOT branch on advocateGate.status before the screen's other hooks --
 * its status changes over the component's lifetime (loading -> found/none),
 * so returning early on it before other useState/useEffect calls would
 * make those calls conditional and break the Rules of Hooks. The flag
 * check above it is safe to early-return on because it is a build-time
 * constant that never changes across renders of a given build.
 */
import { useEffect, useState } from 'react';
import { useAuth, API_BASE } from '@/src/auth';

export type AdvocateProfileGate =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'found'; profile: any };

export function useAdvocateProfile(): AdvocateProfileGate {
  const { token, user } = useAuth();
  const [state, setState] = useState<AdvocateProfileGate>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !token) return;
    fetch(`${API_BASE}/api/advocate/profile/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(profile => {
        if (cancelled) return;
        setState(profile ? { status: 'found', profile } : { status: 'none' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'none' });
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, token]);

  return state;
}
