# MapLibre Turkish glyph coverage (09.4)

## Verified stack

| Item | Value |
|------|--------|
| Default style | OpenFreeMap Liberty (`https://tiles.openfreemap.org/styles/liberty`) |
| Override | `NEXT_PUBLIC_MAP_STYLE_URL` |
| Font stacks | `Noto Sans Regular`, `Noto Sans Italic`, `Noto Sans Bold` |
| Glyphs | `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` |
| Characters checked | `İ ı Ğ ğ Ş ş Ç ç Ö ö Ü ü` |

Province names in the app sidebar use HTML/`name_tr` (browser fonts). Basemap place labels use MapLibre symbol layers from the Liberty style with Noto Sans, which includes Turkish Latin Extended glyphs.

App-owned choropleth layers do not add custom `symbol` / `text-font` layers.

## Manual QA checklist

1. Open the map with the default Liberty style (or documented `NEXT_PUBLIC_MAP_STYLE_URL`).
2. At zoom ~5 (country), confirm place labels with diacritics are readable (e.g. İstanbul, Eskişehir, Ağrı).
3. At zoom ~7 (regional), pan across western and eastern Anatolia; no tofu (□) for Turkish letters.
4. At zoom ~9 (city), confirm dense labels still render `İıĞğŞşÇçÖöÜü` correctly.
5. Select a province whose `name_tr` has diacritics; confirm the sidebar panel shows the correct spelling.

If a custom style URL fails this checklist, pin an alternate style that still uses a Noto Sans (or equivalent) stack covering Turkish — do not host fonts locally unless required.