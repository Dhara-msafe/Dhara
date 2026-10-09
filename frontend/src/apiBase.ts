import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function resolveApiBase(platform: string, currentHost: string, backend: string, _preview: string) {
  const base = backend.replace(/\/+$/, '');
  // Always use the ABSOLUTE backend URL — on every platform, including web.
  // CORS on the backend is wildcard, so this works identically whether the
  // frontend is served from the Emergent preview sandbox, a production
  // domain linked via Emergent's "Link Domain" feature, OR a fully
  // self-hosted static export uploaded to the citizen's/owner's own server
  // (app.dhara.msafesolutions.com) — the last case has NO ingress proxy at
  // all, so a same-origin relative path would silently 404 every API call.
  //
  // OPERATIONAL REQUIREMENT when self-hosting: EXPO_PUBLIC_BACKEND_URL is
  // baked into the JS bundle at `expo export` time, not read at runtime. If
  // you clone this repo to self-host, set EXPO_PUBLIC_BACKEND_URL in YOUR
  // OWN .env to your production backend's public URL (e.g.
  // https://bns-know-your-rights.emergent.host) BEFORE running
  // `expo export -p web` — do not reuse this sandbox's preview URL, which
  // is a development environment, not a stable production dependency.
  //
  // Bug this replaces: an EARLIER version of this same logic returned ''
  // (same-origin) for every web host, assuming an ingress proxy would
  // always exist — true for Emergent-hosted domains, but false for a real
  // self-host, which has no such proxy and would break completely.
  return base;
}
const extra = Constants.expoConfig?.extra;
export const API_BASE = resolveApiBase(
  Platform.OS,
  // On native, `window` exists but `window.location` is undefined — reading .host crashed the APK at launch.
  Platform.OS === 'web' && typeof window !== 'undefined' && window.location ? window.location.host : '',
  extra?.backendUrl ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? '',
  extra?.packagerHostname ?? '',
);