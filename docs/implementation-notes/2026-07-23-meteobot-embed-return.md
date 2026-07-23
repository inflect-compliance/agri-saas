# 2026-07-23 — Meteobot station embed (return)

**Commit:** `<sha>` test/feat(climate): return the Meteobot station embed via a scoped CSP frame-src

## Why

The 2026-07 climate rework (`2026-07-22-climate-native-weather.md`, PR #372)
**dropped** the Meteobot station embed because the old plain `<iframe>` was
blocked by the app CSP (`default-src 'self'`, no `frame-src`). That was the
wrong remedy: it removed a real capability — a farmer with a physical Meteobot
station needs to see that station's data in the app — when the actual problem
was only the *embed mechanism*, not the integration.

This change brings the station back, done properly: the dashboard is embedded
through a **scoped** CSP `frame-src` rather than dropped, and the native
Open-Meteo weather page stays exactly as it was — the two now sit on `/climate`
top-to-bottom (native weather, then the tenant's own station).

## Design

```
CSP frame-src ─┐                       ┌─ stored-URL validator (usecase + route)
               ├─ @/lib/security/meteobot ┤   isAllowedMeteobotUrl()
   (middleware)┘   METEOBOT_EMBED_HOSTS   └─ (never drift: one allowlist)
                   METEOBOT_FRAME_SRC

/climate (page.tsx, server)
  ├─ Open-Meteo weather  (unchanged: listWeatherLocations / getLocationClimate)
  └─ getMeteobotStationUrl(ctx) + ctx.permissions.canAdmin
       → ClimateClient → <MeteobotStationCard>
            configured  → sandboxed <iframe src={url}>  (+ open-in-new-tab)
            admin        → inline set / clear form → PUT /api/t/:slug/climate/meteobot
```

The **one** thing that makes the embed safe is a single host allowlist
(`src/lib/security/meteobot.ts`) shared by the CSP `frame-src` and the
stored-URL validator. They can't drift: the app will never ask the browser to
frame a URL it wouldn't also let an admin save, and vice-versa. A stored URL
must be `https:` on `meteobot.com` (apex or subdomain); anything else is
rejected at the route (Zod refine), at the usecase (`badRequest`), and by the
browser (CSP). The iframe additionally carries `sandbox` + `referrerPolicy`
(the original 2026-07 embed had neither).

**B now, A later.** The farmer confirmed they also have a Meteobot *data* API.
The cleaner long-term shape is a native server-side fetch (like Open-Meteo, no
CSP relaxation) — but the API spec wasn't available yet (and this sandbox's
egress policy blocks `meteobot.com`, so it couldn't be read here). The embed is
the interim; when the API essentials land, the native fetch adds a
`connect-src` (already `https:`-permissive) and renders readings natively — the
`meteobotStationUrl` config + station card are reused, nothing here blocks it.

## Files

| file | role |
| --- | --- |
| `src/lib/security/meteobot.ts` | **new** — `METEOBOT_EMBED_HOSTS` allowlist, `METEOBOT_FRAME_SRC` CSP fragment, `isAllowedMeteobotUrl()` (Edge-safe) |
| `src/lib/security/csp.ts` | add `frame-src 'self' + METEOBOT_FRAME_SRC` (was absent → iframes fell back to `default-src 'self'`) |
| `prisma/schema/agriculture.prisma` | re-add `TenantModuleSettings.meteobotStationUrl String?` |
| `prisma/migrations/20260723120000_readd_meteobot_station_url/` | `ADD COLUMN IF NOT EXISTS` (reverses the 07-22 drop) |
| `src/app-layer/repositories/ModuleSettingsRepository.ts` | re-add `setMeteobotUrl` |
| `src/app-layer/usecases/modules.ts` | re-add `get/setMeteobotStationUrl` (ADMIN-gated + `isAllowedMeteobotUrl` validation) |
| `src/app/api/t/[tenantSlug]/climate/meteobot/route.ts` | **new** — GET/PUT, host-validated schema |
| `src/app/t/[tenantSlug]/(app)/climate/page.tsx` | fetch `meteobotStationUrl` + `canConfigure`, pass down |
| `src/app/t/[tenantSlug]/(app)/climate/ClimateClient.tsx` | add `<MeteobotStationCard>` (sandboxed embed + admin set/clear) below the native weather |
| `messages/{en,bg}.json` | `ag.climate` Meteobot keys (station/attribution/settings/save/remove/…) |

## Decisions

- **Scoped `frame-src`, not `frame-ancestors` or a global relaxation.**
  `frame-src` governs what *we* embed; it's limited to `meteobot.com` (+ wildcard
  subdomain) + `'self'`. `frame-ancestors 'none'` (who may embed *us*) is
  untouched.
- **Host allowlist is the single source of truth.** CSP fragment and validator
  both derive from `METEOBOT_EMBED_HOSTS`; a unit test pins that they stay in
  sync. Extend that array (not two places) to add a domain — e.g. if a station
  URL turns out to live on a different host.
- **Guard baselines reconciled in-diff (not bypassed).** The embed restores one
  `border-border-default` (border-tone budget 117 → **118**) and the config
  form adds one primary (primary:secondary ceiling 170 → **171**;
  `PRIMARY_BUDGET` for the climate client 1 → **2**, two distinct regions). The
  `Meteobot` proper-noun entry returns to the bg-Cyrillic allowlist. These
  reverse the premature "scrub" that had been staged when the feature looked
  gone for good.
- **No data loss guard needed.** The 07-22 drop deleted stored URLs; the column
  returns `NULL` and admins re-enter — acceptable given the feature was only
  briefly absent.
