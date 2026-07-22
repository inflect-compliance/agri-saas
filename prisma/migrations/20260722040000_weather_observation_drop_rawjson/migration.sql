-- Drop the write-only `rawJson` column. It was written on every WeatherObservation
-- row "for audit/reprocessing" but selected by no consumer — pure write
-- amplification. The structured columns + hourlyJson carry everything used.
ALTER TABLE "WeatherObservation" DROP COLUMN IF EXISTS "rawJson";
