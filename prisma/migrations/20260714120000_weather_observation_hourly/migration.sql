-- Hourly spray-window storage for WeatherObservation.
--
-- The daily-aggregate row already backs the GOOD/CAUTION/UNSUITABLE verdict.
-- To surface the REAL suitable hours today ("Best window: 06:00–10:00") the
-- weather-pull job now also persists the location-local hourly series and the
-- location's UTC offset:
--
--   hourlyJson       — [{ hour, windKmh, precipMm, tempC }] for the day (0–23),
--                      timezone=auto so `hour` is location-local.
--   utcOffsetSeconds — Open-Meteo utc_offset_seconds; lets the read layer
--                      recover the location-local "now" and drop passed hours.
--
-- Both nullable — legacy rows (and grid edges without an hourly series) simply
-- carry NULL and fall back to the daily-only verdict. A Json column on an
-- existing model needs no new index.

ALTER TABLE "WeatherObservation" ADD COLUMN "hourlyJson" JSONB;
ALTER TABLE "WeatherObservation" ADD COLUMN "utcOffsetSeconds" INTEGER;
