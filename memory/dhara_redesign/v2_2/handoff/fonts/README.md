# Fonts

| Font | Use | Source | Licence | Scripts |
|---|---|---|---|---|
| Fraunces | Short headings only | Google Fonts | SIL Open Font License 1.1 | Latin |
| Hind | Body text | Google Fonts | SIL Open Font License 1.1 | Latin, Devanagari |
| Noto Sans (Devanagari, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Gurmukhi, Oriya) | Script fallbacks | Google Fonts / Noto project | SIL Open Font License 1.1 | One script each |
| Noto Naskh Arabic (or Noto Sans Arabic) | RTL fallback, Urdu | Google Fonts | SIL Open Font License 1.1 | Arabic script |

Licence texts are not bundled here. Download them with the font files from the sources above when fonts are added to the app.
Font files are NOT included in this package.

## Guidance
- Load the selected language's script font on demand; keep Hind for Latin and Devanagari.
- Do not set Fraunces on body text in non-Latin scripts.
- Right-to-left layout (Urdu) was NOT designed or tested. See OPEN_ITEMS.md.
- Real translated label lengths and script rendering were NOT checked; screens use English and a few native names.
- Verify the actual supported-language list (the live selector showed 23 options) against font coverage.
