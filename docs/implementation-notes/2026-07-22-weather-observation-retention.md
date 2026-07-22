# 2026-07-22 — WeatherObservation retention + drop the write-only rawJson

**Commit:** see PR — `feat(weather): retention prune for WeatherObservation; drop write-only rawJson`

## Design

The climate audit flagged two storage-governance issues in the Open-Meteo
engine (the pipeline itself is sound and untouched):

- **Unbounded growth.** `WeatherObservation` had no `deletedAt` and was in no
  retention sweep, so it accreted ~365 rows per location per year forever
  (each carrying a JSON hourly series). Weather is reproducible and every
  consumer (`smart-defaults` spray-window, `agro-gdd`, `home-greeting`,
  `agro-signals`) reads only a short recent window, so old rows are now
  **pruned**. `weather-pull` calls `pruneOldObservations(db, tenantId,
  locationId, now)` after upserting each location's days — a bounded,
  tenant+location-scoped hard-delete of rows older than
  `WEATHER_RETENTION_DAYS = 730` (~2 years). Retention runs in the same daily
  job that writes the data, so there's no separate sweep to schedule. The run
  result reports `pruned`.
- **Write-only column.** `rawJson` was written on every row "for
  audit/reprocessing" but selected by no consumer — pure write amplification.
  Dropped (schema + the job write + a migration). The structured columns +
  `hourlyJson` carry everything actually read.

## Files

| File | Role |
|---|---|
| `src/app-layer/jobs/weather-pull.ts` | `WEATHER_RETENTION_DAYS` + `pruneOldObservations`; prune per location; `rawJson` write removed; `pruned` in the result |
| `prisma/schema/agro.prisma` (+ `..._drop_rawjson`) | drop the `rawJson` column |
| `tests/integration/weather-retention.test.ts` | DB-backed proof: old rows pruned, recent kept, location-scoped |

## Decisions

- **Prune in the job, not a new retention framework.** The data-lifecycle
  retention sweep is soft-delete/`retentionUntil`-oriented; weather is
  reproducible and better hard-deleted, and the daily pull is the natural
  place to bound its own table.
- **2-year window.** Generous headroom for any history use (GDD, trend) while
  keeping per-location rows in the low hundreds. Tunable via the exported const.
