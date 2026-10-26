/**
 * app.config.js — Expo dynamic config.
 *
 * Wires Google Maps API keys for all three platforms:
 *
 *  Android  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
 *    → android.config.googleMaps.apiKey
 *    → injected as com.google.android.geo.API_KEY in AndroidManifest.xml
 *
 *  iOS      EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY
 *    → ios.config.googleMapsApiKey
 *    → injected as GMSApiKey in Info.plist (react-native-maps reads this)
 *    → PROVIDER_GOOGLE on iOS requires this key + Google Maps SDK for iOS
 *
 *  Web      EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY
 *    → exposed as a public env var; consumed by DestinationMapPicker.web.tsx
 *      and AlertLocationMap.web.tsx via @react-google-maps/api LoadScript
 *
 * Placeholder guard: a platform-specific build/prebuild that receives a
 * missing or placeholder key throws immediately — no silent blank-map APK/IPA.
 */

function isPlaceholder(key) {
  return !key || key.trim() === "" || key.toUpperCase().includes("PLACEHOLDER");
}

module.exports = ({ config, platform }) => {
  const androidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const iosKey     = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;

  // ── Android guard ──────────────────────────────────────────────────────────
  if (isPlaceholder(androidKey)) {
    // eslint-disable-next-line no-console
    console.warn("[app.config.js] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY missing/placeholder — Android maps will be blank.");
    if (platform === "android") {
      throw new Error(
        "[app.config.js] Refusing Android build: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing or a placeholder."
      );
    }
  }

  // ── iOS guard ──────────────────────────────────────────────────────────────
  if (isPlaceholder(iosKey)) {
    // eslint-disable-next-line no-console
    console.warn("[app.config.js] EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY missing/placeholder — iOS Google Maps will be blank.");
    if (platform === "ios") {
      throw new Error(
        "[app.config.js] Refusing iOS build: EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY is missing or a placeholder."
      );
    }
  }

  return {
    ...config,

    // ── iOS: inject GMSApiKey ─────────────────────────────────────────────────
    ios: {
      ...config.ios,
      ...(!isPlaceholder(iosKey) && {
        config: {
          ...(config.ios && config.ios.config),
          googleMapsApiKey: iosKey,
        },
      }),
    },

    // ── Android: inject com.google.android.geo.API_KEY ───────────────────────
    android: {
      ...config.android,
      package: "com.msafesolutions.legalaid",
      googleServicesFile: "./google-services.json",
      ...(!isPlaceholder(androidKey) && {
        config: {
          ...(config.android && config.android.config),
          googleMaps: { apiKey: androidKey },
        },
      }),
    },

    extra: {
      ...config.extra,
      backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL,
      packagerHostname: process.env.EXPO_PACKAGER_HOSTNAME,
    },
  };
};