/**
 * Cross-platform multipart upload helper.
 * NEVER use form.append(field, { uri, name, type }) directly on native —
 * the native global fetch (expo/fetch) needs a real Blob, not that shape.
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
    const blob = await (await fetch(file.uri)).blob();
    form.append(fieldName, blob, file.name);
  } else {
    const { fetch: expoFetch } = await import('expo/fetch');
    const blob = await (await expoFetch(file.uri)).blob();
    // @ts-ignore — RN FormData accepts (Blob, filename)
    form.append(fieldName, blob, file.name);
  }
  // Never set Content-Type manually — fetch sets the multipart boundary itself.
  return fetch(url, { method, body: form, headers });
}
