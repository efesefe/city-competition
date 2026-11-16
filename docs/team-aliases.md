# Süper Lig team aliases (v1 — owner-approved draft)

**Audience:** product, legal, DB seed, Expo Kabile picker  
**Roster:** **2026–27 Trendyol Süper Lig** — 18 clubs  
**Rule:** Public product strings use **`public_alias`** only — not official club names.  
**Source of truth in API:** `apps/api/src/data/teams.ts` (must stay in sync with this table).

## Alias table

| internal_id | real_club_reference (ops only) | public_alias | Big 4 |
|-------------|--------------------------------|--------------|-------|
| `sl_galatasaray` | Galatasaray SK | Aslan Kabilesi | yes |
| `sl_fenerbahce` | Fenerbahçe SK | Kanarya Kabilesi | yes |
| `sl_besiktas` | Beşiktaş JK | Kartal Kabilesi | yes |
| `sl_trabzonspor` | Trabzonspor | Fırtına Kabilesi | yes |
| `sl_basaksehir` | İstanbul Başakşehir FK | Baykuş Kabilesi | |
| `sl_kasimpasa` | Kasımpaşa SK | Korsan Kabilesi | |
| `sl_eyupspor` | Eyüpspor | Sultan Kabilesi | |
| `sl_goztepe` | Göztepe SK | Gözcü Kabilesi | |
| `sl_samsunspor` | Samsunspor | Atlılar Kabilesi | |
| `sl_rizespor` | Çaykur Rizespor | Atmaca Kabilesi | |
| `sl_konyaspor` | Konyaspor | Çift Başlı Kartal Kabilesi | |
| `sl_kocaelispor` | Kocaelispor | Körfez Kabilesi | |
| `sl_alanyaspor` | Alanyaspor | Güneş Kabilesi | |
| `sl_gaziantep` | Gaziantep FK | Şahin Kabilesi | |
| `sl_genclerbirligi` | Gençlerbirliği SK | Rüzgar Kabilesi | |
| `sl_erzurumspor` | Erzurumspor FK | Dadaş Kabilesi | |
| `sl_amed` | Amed SK | Sur Kabilesi | |
| `sl_corum` | Çorum FK | Hitit Kabilesi | |

## Picker order (locked)

1. **Big 4** — Aslan, Kanarya, Kartal, Fırtına  
2. **Rest** — remaining 14 in table order  

`GET /v1/teams` returns `order: "big4_first"` plus `big4` / `rest` arrays (CC-63).

## Product copy rules

1. UI → **`public_alias` only** (full *… Kabilesi*).  
2. Do not ship sponsor prefixes or official crests as product chrome in v1.  
3. Team switch: **1-day cooldown**.  
4. Add-team tickets: admin invents a new `public_alias` before enabling.
