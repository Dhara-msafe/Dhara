/**
 * First-run permission setup — RN glue around src/permissions/core.ts.
 */
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioModule } from 'expo-audio';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { toOutcome, type PermissionKey, type PermissionOutcome } from './core';

/** Device-level (not per-account): permissions belong to the phone. */
const K_SETUP_DONE = 'dhara_permission_setup_done_v1';

export async function isPermissionSetupDone(): Promise<boolean> {
  if (Platform.OS === 'web') return true; // the browser asks per feature; no setup screen on web
  try { return (await AsyncStorage.getItem(K_SETUP_DONE)) === 'true'; } catch { return false; }
}

export async function markPermissionSetupDone(): Promise<void> {
  try { await AsyncStorage.setItem(K_SETUP_DONE, 'true'); } catch {}
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** Current state, without prompting. */
export async function checkPermission(key: PermissionKey): Promise<PermissionOutcome> {
  if (key === 'microphone') return toOutcome(await safe(() => AudioModule.getRecordingPermissionsAsync()));
  if (key === 'location') return toOutcome(await safe(() => Location.getForegroundPermissionsAsync()));
  return toOutcome(await safe(() => Notifications.getPermissionsAsync()));
}

/** Show the Android prompt for one permission (no-op when already granted or blocked). */
export async function requestPermission(key: PermissionKey): Promise<PermissionOutcome> {
  const now = await checkPermission(key);
  if (now === 'granted' || now === 'blocked') return now;
  if (key === 'microphone') return toOutcome(await safe(() => AudioModule.requestRecordingPermissionsAsync()));
  if (key === 'location') return toOutcome(await safe(() => Location.requestForegroundPermissionsAsync()));
  return toOutcome(await safe(() => Notifications.requestPermissionsAsync()));
}

/**
 * Explain a permission Android will no longer prompt for, with a button that
 * opens this app's page in phone Settings. Use wherever a feature finds its
 * permission permanently denied ("Don't allow" twice).
 */
export function alertPermissionBlocked(title: string, message: string): void {
  Alert.alert(title, message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open settings', onPress: () => { void Linking.openSettings().catch(() => {}); } },
  ]);
}
