// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        {/* ── Icon fonts ─────────────────────────────────────────────────────
            @expo/vector-icons injects its own font-face asynchronously via JS,
            so the very first render can show empty squares for all icons.
            Declaring the face here (before any React hydration) eliminates that
            flash.  The CDN URL matches the package version in package.json.     */}
        <style dangerouslySetInnerHTML={{ __html: `
          @font-face {
            font-family: 'Ionicons';
            src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.1.1/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf') format('truetype');
            font-display: block;
          }
        ` }} />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />

        {/* ── GA4 + Cloudflare Web Analytics ──────────────────────────────
            P0 containment (T08 — analytics-consent defect, 2026-10-26
            remediation): these used to be static <script> tags here,
            loading/initializing unconditionally on every page load before
            any consent decision could exist. This static HTML template has
            no access to the user's stored consent choice at render time,
            so the scripts are no longer injected here at all — they are
            now injected dynamically, client-side, ONLY after analytics
            consent is explicitly resolved to true. See
            src/analytics/index.ts's loadWebAnalyticsScriptsIfConsented(). */}
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </body>
    </html>
  );
}
