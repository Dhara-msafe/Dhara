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
 *
 * B-02 ("build check" + "-qa version name") — D-01 describes four things an
 * internal_qa build must have: a QA MODE banner (B-06, src/components/dhara/
 * QaModeBanner.tsx), a `-qa` version name, a build check, and a release
 * preflight (tracked separately, not part of B-02). Before this, only the
 * dialler/SMS/share simulation itself existed — nothing actually appended
 * "-qa" to the version, and nothing refused a build whose version and
 * EXPO_PUBLIC_OUTBOUND_PROFILE disagreed. Both are added here, in the same
 * place and the same style as the Maps-key guard above: a build/prebuild
 * that would produce a dangerously-misleading artifact throws instead of
 * shipping it.
 *   - internal_qa  → the exposed version always gets "-qa" appended (not a
 *     manual step, so it can't be forgotten) — anyone looking at the
 *     installed build's version string can tell it's a QA build.
 *   - closed_testing / production → refuses the build if app.json's own
 *     version already contains "-qa" (someone hand-set a QA-looking version
 *     on what's meant to ship to real testers/users).
 */

function isPlaceholder(key) {
  return !key || key.trim() === "" || key.toUpperCase().includes("PLACEHOLDER");
}

/** Mirrors outbound.ts's OUTBOUND_PROFILE resolution (kept in sync by hand —
 * app.config.js is plain CommonJS and can't import that TS/RN module at
 * config time). See src/outbound.ts if this ever needs to change. */
function resolveOutboundProfile() {
  const valid = ["internal_qa", "closed_testing", "production"];
  const raw = process.env.EXPO_PUBLIC_OUTBOUND_PROFILE || "";
  if (valid.includes(raw)) return raw;
  return process.env.EXPO_PUBLIC_OUTBOUND_MODE === "live" ? "production" : "internal_qa";
}

module.exports = ({ config, platform }) => {
  const androidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const iosKey     = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;

  // ── B-02 build check: version name must match the build's outbound profile ─
  //
  // NF-DEPLOY-01 (14 Nov 2026): the auto-appended "-qa" suffix below used to
  // land in `expo.version` itself, which Expo's deploy pipeline validates as
  // strict MAJOR.MINOR.PATCH semver — "1.0.0-qa" is rejected outright
  // (V3MobileConfigInvalid), so EVERY deploy while EXPO_PUBLIC_OUTBOUND_PROFILE
  // resolves to "internal_qa" (the preview default) failed deterministically
  // at the pull_source step, before any build even started.
  //
  // Fix: `expo.version` always stays plain semver now. The QA marker moves to
  // `extra.qaVersionLabel` (a free-form string Expo does not validate) so it
  // is still available to code that wants it, without blocking deploys. The
  // in-app "QA MODE" banner (src/components/dhara/QaModeBanner.tsx) already
  // marks QA builds just as visibly at runtime, independent of the version
  // string, and the closed_testing/production refusal below (which protects
  // against a real release accidentally carrying a hand-set "-qa" version)
  // is unchanged.
  const profile = resolveOutboundProfile();
  const baseVersion = config.version || "";
  const baseIsQaVersion = /-qa$/i.test(baseVersion.trim());
  if (profile !== "internal_qa" && baseIsQaVersion) {
    throw new Error(
      `[app.config.js] Refusing ${profile} build: app version "${baseVersion}" still carries a "-qa" suffix. ` +
      `A closed_testing/production build must not look like an internal QA build.`
    );
  }
  const effectiveVersion = baseVersion;
  const qaVersionLabel =
    profile === "internal_qa" && !baseIsQaVersion
      ? `${baseVersion}-qa`
      : baseVersion;

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
    version: effectiveVersion,

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
      // NF-DEPLOY-01: QA marker lives here instead of in `expo.version` —
      // see the comment above `effectiveVersion` for why.
      qaVersionLabel,
    },
  };
};