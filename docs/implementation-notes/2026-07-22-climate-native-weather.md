# 2026-07-22 — Climate page: native Open-Meteo weather, drop Meteobot embed

**Commit:** see PR — `feat(climate): render native Open-Meteo weather; drop the Meteobot embed`

## Design

A July-2026 audit found `/climate` (Климат) was an **embed-vs-engine split**:
the page rendered only a per-tenant Meteobot `<iframe>` — which the app's own
CSP (`default-src 'self'`, no `frame-src`) **blocks in enforce mode** — while
the real Open-Meteo weather the `weather-pull` job collects into
`WeatherObservation` (temps/precip/wind/humidity + hourly) was surfaced only
as *derived* intelligence elsewhere (spray-window verdict, GDD, dashboard
greeting), never as weather on the page named after it.

This change makes the page show the farm's own weather and removes the broken
embed (product decision: drop, not secure — the embed was non-functional in
prod and native weather supersedes it).

- **Read usecase** `src/app-layer/usecases/climate.ts` — `listWeatherLocations`
  (the picker) + `getLocationClimate` (current conditions + the recent+forecast
  daily series + today's spray window). Reuses the exact `WeatherObservation`
  read + spray-rules (`evaluateSprayWindow` / `computeSprayWindows`) pattern
  from `smart-defaults.ts`, so /climate and the location-detail banner tell the
  same story. Bounded (`take`), tenant-scoped, `assertCanRead`.
- **Page** is a per-field weather view: a location selector (`?location=`),
  current-conditions stat tiles + a spray verdict badge, the day's spray
  windows, and a max/min temperature chart (Epic 59 `TimeSeriesChart`). Clean
  empty states for no-fields and no-weather-yet.
- **Meteobot removed**: the `climate/meteobot` config route, the
  `get/setMeteobotStationUrl` usecases, `ModuleSettingsRepository.setMeteobotUrl`,
  and the `TenantModuleSettings.meteobotStationUrl` column (drop migration).

## Files

| File | Role |
|---|---|
| `src/app-layer/usecases/climate.ts` | new read usecase (locations + per-location climate) |
| `src/app/t/[tenantSlug]/(app)/climate/page.tsx` | server: resolve selected field + fetch climate |
| `src/app/t/[tenantSlug]/(app)/climate/ClimateClient.tsx` | native weather UI (was the Meteobot embed) |
| `src/app-layer/usecases/modules.ts` / `ModuleSettingsRepository.ts` | Meteobot getter/setter removed |
| `prisma/schema/agriculture.prisma` (+ `..._drop_meteobot_station_url`) | drop the column |
| `messages/{en,bg}.json` | `ag.climate` re-keyed to weather (parity kept) |
| `tests/integration/climate.test.ts` | DB-backed proof of the read logic |

## Decisions

- **Drop, not secure the embed.** It was CSP-blocked in enforce mode (so not
  functional in prod), and the native `WeatherObservation` render serves the
  intent without widening the app CSP or hardening a tenant-admin-supplied
  iframe. Reversible via git history if a hardware-Meteobot customer appears.
- **Reuse, don't duplicate, the spray logic.** The window derivation is the
  shared `@/lib/agro/rules` used by `smart-defaults`; /climate is a new
  *reader*, the `weather-pull` engine is untouched.
- **Location-local "today".** Current conditions pick the row on the
  location-local calendar date (via `utcOffsetSeconds`), falling back to the
  latest row — the same convention as the smart-defaults banner.
