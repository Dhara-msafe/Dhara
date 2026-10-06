import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// DHARA: local PIN lock for the Evidence Locker — so photos/videos/recordings
// can't be viewed by anyone who just picks up the phone, even with no network.
// The hash is device-keychain-backed (SecureStore) on native. SecureStore has
// NO web implementation at all (its web build exports an empty object), so
// every call there would throw "is not a function" — fall back to AsyncStorage
// on web instead of crashing the whole screen.
const PIN_HASH_KEY = 'dhara_evidence_pin_hash';
const isWeb = Platform.OS === 'web';

async function store_get(key: string): Promise<string | null> {
  return isWeb ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
}
async function store_set(key: string, value: string): Promise<void> {
  if (isWeb) { await AsyncStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}
async function store_delete(key: string): Promise<void> {
  if (isWeb) { await AsyncStorage.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}

async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `dhara-evidence-lock:${pin}`);
}

export async function hasPin(): Promise<boolean> {
  try { return !!(await store_get(PIN_HASH_KEY)); } catch { return false; }
}

export async function setPin(pin: string): Promise<void> {
  await store_set(PIN_HASH_KEY, await hashPin(pin));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await store_get(PIN_HASH_KEY).catch(() => null);
  if (!stored) return false;
  return stored === (await hashPin(pin));
}

export async function clearPin(): Promise<void> {
  await store_delete(PIN_HASH_KEY);
}

