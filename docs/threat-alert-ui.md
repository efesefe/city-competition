# Rival-threat alert UI

Frontend consumption of targeted `rival_threat` push notifications, plus an in-map banner when the user is already looking at the threatened city. Backend durability (tension thresholds, Redis cooldown, `notif_queue`, inbox dual-write) already exists; this document covers how the app routes the payload and echoes it on the map.

## Why this shape

- Push tap must open the city’s support sheet with one hop. Backend `deep_link` is `/map?il={code}`; the map page already selects that city and mounts `CitySupportSheet`.
- System notifications are easy to miss while the map is in the foreground. Live `support_applied` is already viewport-filtered, and `contest_tension` is already patched in `CityDataContext`, so the in-app banner does not wait for FCM (still Track H) or a new WebSocket event type.
- The banner is a **defense** notice, not a neutral capture toast: controlling-tribe color as the accent, alarmed styling, and a **Savun** button that focuses the credit input.

## Payload contract

Queued / FCM data / inbox `payload`:

| Field | Role |
| --- | --- |
| `type` | `rival_threat` |
| `il_code` | Two-digit city code |
| `city_name` | Copy |
| `tribe_id` | Controlling tribe (the audience) |
| `tension_percent`, `level` | `70` or `90` |
| `deep_link` | `/map?il={il_code}` |

Client routing lives in [`frontend/lib/notifications/pushHandler.ts`](../frontend/lib/notifications/pushHandler.ts). Off-site `deep_link` values are ignored; the handler falls back to `/map?il=`. Client-handled taps append `focus=credits`.

## Event flow

```
rival spend raises contest_tension
        ├─ backend enqueue rival_threat push + inbox
        └─ WS support_applied (only if city intersects viewport)
                └─ CityDataContext patches contest_tension
                        └─ ThreatAlertHost detects an upward 70/90 cross
                           for the signed-in controlling tribe
                                └─ city centroid on canvas → ThreatAlertBanner
```

Foreground push (when FCM exists) emits the same in-app alert via `handleForegroundPush` → `subscribeThreatAlert`. Notification tap uses `handleNotificationClick` (stash `sessionStorage` + `cc:push-click`). `PushDeepLinkBridge` in the main shell consumes the pending href on cold start and listens for the click event when the app is already running.

Cold launch where the OS opens `/map?il=34` directly still works: the map `?il=` effect opens the sheet without requiring `focus=credits`.

## Banner vs capture toast

| | Capture toast | Threat banner |
| --- | --- | --- |
| Mount | App shell, any tab | Map screen only |
| Source | `region_supported` WS | Tension cross and/or foreground `rival_threat` |
| Look | Green-gray, crests | Dark/alarmed, tribe-color left accent |
| Action | Expand supporters / open on map | **Savun** → sheet + `#support-credits` focus |

Client cooldown is 10 minutes per `il_code:level`, matching the backend window, so a live cross plus a later foreground push do not stack two banners.

## How to test

Automated:

```bash
cd frontend && npm test -- lib/notifications
```

### Manual QA — cold-start deep link

Open `/map?il=34` as if a threat push was tapped with the app not running. The İstanbul support sheet opens. A client-handled tap (`handleNotificationClick`) uses `/map?il=34&focus=credits` and focuses the credit field.

### Manual QA — in-app banner without tapping the push

On the map, with the threatened city on-canvas, raise contest tension across 70% (or 90%) for a city the signed-in user’s tribe holds. The banner appears from the live patch; the system notification does not need to be tapped.

### Manual QA — Defend lands on the credit input

Tap **Savun**. The city’s support sheet opens (or comes forward) with `#support-credits` focused, ready to type an amount — not a generic city view.
