// P1 map follow-up: wire EXPO_PUBLIC_GOOGLE_MAPS_API_KEY into Android's
// native Google Maps SDK config slot (android.config.googleMaps.apiKey —
// this is what Expo's own GoogleMapsApiKey config-plugin reads to inject
// the `com.google.android.geo.API_KEY` <meta-data> tag into
// AndroidManifest.xml at prebuild time) and make sure a placeholder key
// can never ship inside a real Android build:
//   - If the key is missing/blank/still the placeholder string, we omit
//     the field entirely. Expo's plugin removes the manifest meta-data tag
//     when the key is falsy, so no broken placeholder string is ever baked
//     into the APK (grey/blank map at worst, not a fake "configured" key).
//   - When config is resolved specifically FOR an Android target (prebuild
//     / EAS build invoked with `--platform android`, which passes
//     `platform: 'android'` into this function), a placeholder key hard-
//     fails config resolution instead of silently continuing — so an
//     Android build/prebuild cannot complete with a non-functional key.
//   - Local dev / Expo Go / web preview resolve config with `platform`
//     undefined, so this never interrupts day-to-day development; iOS
//     uses Apple Maps (no key needed) and is unaffected either way.
module.exports = ({ config, platform }) => {
  const rawMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const isPlaceholderMapsKey =
    !rawMapsKey ||
    rawMapsKey.trim() === "" ||
    rawMapsKey.toUpperCase().includes("PLACEHOLDER");

  if (isPlaceholderMapsKey) {
    // eslint-disable-next-line no-console
    console.warn(
      "[app.config.js] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing or a placeholder. " +
        "Android native maps (react-native-maps / PROVIDER_GOOGLE) will ship with NO key " +
        "and will render blank/grey. Set a real, restricted Android Maps SDK key in " +
        "frontend/.env before building for Android."
    );
    if (platform === "android") {
      throw new Error(
        "[app.config.js] Refusing to resolve Android build config: " +
          "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing or still the placeholder value. " +
          "Set a real, restricted Android Maps SDK key in frontend/.env before " +
          "running an Android build/prebuild."
      );
    }
  }

  return {
    ...config,

    android: {
      ...config.android,
      package: "com.msafesolutions.legalaid",
      googleServicesFile: "./google-services.json",
      ...(isPlaceholderMapsKey
        ? {}
        : {
            config: {
              ...(config.android && config.android.config),
              googleMaps: { apiKey: rawMapsKey },
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