/**
 * Cross-platform multipart upload helper.
 *
 * On native (iOS/Android) the global fetch is expo/fetch.  Calling
 * response.blob() on a file:// URI via expo/fetch returns a native-backed
 * Blob that is NOT safe to pass to FormData.append() — it triggers
 * "Unsupported FormDataPart implementation" on real devices.
 *
 * Fix: read the file as an ArrayBuffer first, then construct an explicit
 * in-memory Blob.  That Blob is always compatible with native FormData.
 *
 * NEVER use form.append(field, { uri, name, type }) directly on native —
 * that shape also triggers the same error.
 */
import { Platform } from 'react-native';

export async function uploadForm(
  url: string,
  file: { uri: string; name: string; type: string },
  opts: { fieldName?: string; fields?: Record<string, string>; headers?: Record<string, string>; method?: string } = {}
): Promise<Response> {
  const { fieldName = 'file', fields = {}, headers = {}, method = 'POST' } = opts;
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));

  if (Platform.OS === 'web') {
    // Web: standard fetch + .blob() is safe
    const blob = await (await fetch(file.uri)).blob();
    form.append(fieldName, blob, file.name);
  } else {
    // Native: expo/fetch handles file:// URIs but .blob() returns a
    // native-backed Blob that FormData cannot serialise.
    // Use .arrayBuffer() then wrap in an explicit in-memory Blob instead.
    const { fetch: expoFetch } = await import('expo/fetch');
    const ab = await (await expoFetch(file.uri)).arrayBuffer();
    const blob = new Blob([ab], { type: file.type });
    // @ts-ignore — RN FormData accepts (Blob, filename)
    form.append(fieldName, blob, file.name);
  }
  // Never set Content-Type manually — fetch sets the multipart boundary itself.
  return fetch(url, { method, body: form, headers });
}
