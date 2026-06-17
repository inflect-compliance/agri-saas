-- pgbench custom script — the parcel-list read under load.
--
-- Models the hot path `ParcelRepository.listForLocation`: the three-filter
-- predicate (tenantId, locationId, deletedAt IS NULL) + the name sort +
-- the per-row geometry serialisation. Run with:
--
--   pgbench -n -T 30 -c 10 -j 4 -f scripts/perf/parcel-list-bench.sql "$DATABASE_URL"
--
-- The harness (parcel-list-bench.sh) seeds a 5k-parcel location and sets
-- :loc / :tenant; standalone runs can \set them by hand. `-n` skips the
-- default vacuum (we manage state in the harness).

\set loc :loc
\set tenant :tenant

SELECT "id", "name", "cropType", "areaHa"::text AS "areaHa",
       ST_AsGeoJSON("geometry") AS "geojson", "propertiesJson"
FROM "Parcel"
WHERE "locationId" = :'loc'
  AND "tenantId" = :'tenant'
  AND "deletedAt" IS NULL
ORDER BY "name" ASC;
