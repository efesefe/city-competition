# MapLibre Turkish glyph coverage (09.4)

## Verified stack

| Item | Value |
|------|--------|
| App map style | Self-authored `TURKIYE_MAP_STYLE` (sea background only; city polygons at runtime) |
| Font stacks | `Noto Sans Regular`, `Noto Sans Bold` |
| Glyphs | `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` |
| Characters checked | `İ ı Ğ ğ Ş ş Ç ç Ö ö Ü ü` |

City name labels on the map use an app-owned symbol layer (`cities-label`) with Noto Sans via the OpenFreeMap glyph endpoint, which includes Turkish Latin Extended glyphs.

Sidebar / HTML UI uses browser fonts for `name_tr`.

Admin/analytics maps may still load OpenFreeMap Liberty; the main `/map` screen does not.

## Manual QA checklist

1. Open `/map` with the Türkiye minimal style.
2. At zoom ~5 (country), confirm city labels with diacritics are readable (e.g. İstanbul, Eskişehir, Ağrı).
3. At zoom ~7 (regional), pan across western and eastern Anatolia; no tofu (□) for Turkish letters.
4. At zoom ~9 (city), confirm dense labels still render `İıĞğŞşÇçÖöÜü` correctly.
5. Select a city whose `name_tr` has diacritics; confirm the support panel shows the correct spelling.

If glyph fetches fail this checklist, keep the OpenFreeMap Noto Sans stack — do not host fonts locally unless required.
