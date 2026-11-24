#!/usr/bin/env bash
# A42 — bundle the app the way a build profile will, before spending an EAS build.
#
# An EAS build takes tens of minutes and fails late. This does the part that
# usually breaks — the JavaScript bundle, with that profile's switches ON —
# in a couple of minutes on any machine, and then checks the result for
# anything that should not be shipped.
#
#   ./scripts/prebuild-check.sh                 # internal_qa (the pilot APK)
#   ./scripts/prebuild-check.sh closed_testing
#
# It never touches the network beyond the package registry, and it writes
# nothing into the repository.
set -euo pipefail

PROFILE="${1:-internal_qa}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(mktemp -d)"
cd "$HERE"

echo "→ profile: $PROFILE"
ENV_LINE="$(node -e '
  const p = process.argv[1];
  const env = (require("./eas.json").build[p] || {}).env;
  if (!env) { console.error(`no "env" block for profile ${p} in eas.json`); process.exit(1); }
  console.log(Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" "));
' "$PROFILE")"
echo "$ENV_LINE" | tr ' ' '\n' | sed 's/^/   /'

# Values that live in the EAS environment, not in eas.json. Placeholders are
# fine here: this bundle is thrown away and never installed.
: "${EXPO_PUBLIC_BACKEND_URL:=https://example.invalid}"
: "${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:=prebuild-check-placeholder}"

echo "→ bundling…"
# shellcheck disable=SC2086
env $ENV_LINE \
  EXPO_PUBLIC_BACKEND_URL="$EXPO_PUBLIC_BACKEND_URL" \
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="$EXPO_PUBLIC_GOOGLE_MAPS_API_KEY" \
  CI=1 EXPO_NO_TELEMETRY=1 \
  npx expo export --platform android --output-dir "$OUT/export" --clear > "$OUT/export.log" 2>&1 || {
    echo "✗ the bundle failed — an EAS build would fail the same way:"
    tail -40 "$OUT/export.log"
    exit 1
  }

if grep -qiE "unable to resolve|failed to (load|compile)" "$OUT/export.log"; then
  echo "✗ the bundle reported unresolved imports:"
  grep -iE "unable to resolve|failed to (load|compile)" "$OUT/export.log" | head
  exit 1
fi

BUNDLE="$(find "$OUT/export" -name '*.hbc' -o -name '*.js' | head -1)"
[ -n "$BUNDLE" ] || { echo "✗ no bundle was produced"; exit 1; }

echo "→ checking what ended up in the bundle…"
if strings "$BUNDLE" | grep -qEi "ADMIN_KEY|JWT_SECRET|MONGO_URL|EMERGENT_LLM_KEY|BEGIN (RSA|PRIVATE) KEY"; then
  echo "✗ something secret-looking is in the bundle — do NOT build until this is understood"
  exit 1
fi

echo "✓ $PROFILE bundles cleanly ($(du -h "$BUNDLE" | cut -f1)), nothing secret-looking in it"
echo "  log: $OUT/export.log"
