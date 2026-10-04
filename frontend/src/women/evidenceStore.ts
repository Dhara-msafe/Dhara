import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

export type RecordingItem = { id: string; uri: string; createdAt: string };
const key = (scope: string) => `dhara_local_recordings_${scope}`;
export async function loadRecordings(scope: string): Promise<RecordingItem[]> {
  return JSON.parse(await AsyncStorage.getItem(key(scope)) || '[]');
}
export async function saveRecording(scope: string, uri: string): Promise<RecordingItem> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = new File(Paths.document, `dhara-recording-${id}.m4a`);
  new File(uri).copy(file);
  const item = { id, uri: file.uri, createdAt: new Date().toISOString() };
  try { await AsyncStorage.setItem(key(scope), JSON.stringify([item, ...await loadRecordings(scope)])); }
  catch (error) { file.delete(); throw error; }
  return item;
}
export async function deleteRecording(scope: string, item: RecordingItem): Promise<void> {
  const remaining = (await loadRecordings(scope)).filter(row => row.id !== item.id);
  const file = new File(item.uri);
  if (file.exists) file.delete();
  await AsyncStorage.setItem(key(scope), JSON.stringify(remaining));
}
export function releaseRecordings(_items: RecordingItem[]) { /* Native URIs are durable files. */ }
export function discardTemporaryRecording(uri: string | null) {
  if (!uri) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch {}
}