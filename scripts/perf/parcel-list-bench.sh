#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# parcel-list-bench.sh — reproducible before/after benchmark for the
# perf-scale Parcel index `(tenantId, locationId, deletedAt)`.
#
# Seeds a 5k-parcel location, runs pgbench against the parcel-list read
# (parcel-list-bench.sql) WITH the composite index, then DROPs it and
# runs again WITHOUT, then restores it — printing both latency profiles
# so the delta is real, not asserted. Cleans up its seed on exit.
#
# Usage:
#   DATABASE_URL=postgres://… ./scripts/perf/parcel-list-bench.sh [PARCELS] [SECONDS] [CLIENTS]
# Defaults: 5000 parcels, 30s, 10 clients. Requires psql + pgbench + PostGIS.
#
# Runs as the connection role (not app_user) so the superuser_bypass RLS
# policy applies — this measures raw index/query cost, the thing the
# composite index changes.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

DB="${DATABASE_URL:?set DATABASE_URL}"
PARCELS="${1:-5000}"
SECONDS_RUN="${2:-30}"
CLIENTS="${3:-10}"
HERE="$(cd "$(dirname "$0")" && pwd)"

TENANT="bench-tenant-$$"
LOCATION="bench-location-$$"

cleanup() {
  psql "$DB" -q -v ON_ERROR_STOP=0 <<SQL || true
    DELETE FROM "Parcel" WHERE "tenantId" = '${TENANT}';
    DELETE FROM "Location" WHERE "id" = '${LOCATION}';
    DELETE FROM "Tenant" WHERE "id" = '${TENANT}';
    CREATE INDEX IF NOT EXISTS "Parcel_tenantId_locationId_deletedAt_idx"
      ON "Parcel"("tenantId", "locationId", "deletedAt");
SQL
}
trap cleanup EXIT

echo "→ seeding ${PARCELS} parcels into ${LOCATION} (tenant ${TENANT})…"
psql "$DB" -q -v ON_ERROR_STOP=1 <<SQL
  INSERT INTO "Tenant"("id","name","slug") VALUES ('${TENANT}','bench','${TENANT}')
    ON CONFLICT DO NOTHING;
  INSERT INTO "Location"("id","tenantId","name") VALUES ('${LOCATION}','${TENANT}','bench field')
    ON CONFLICT DO NOTHING;
  -- 5k small WGS84 squares laid out on a grid; 5% soft-deleted so the
  -- deletedAt predicate is exercised (the third filter).
  INSERT INTO "Parcel"("id","tenantId","locationId","name","geometry","areaHa","deletedAt","createdAt","updatedAt")
  SELECT
    'bp-' || g, '${TENANT}', '${LOCATION}',
    'Parcel ' || lpad(g::text, 5, '0'),
    ST_Multi(ST_SetSRID(ST_MakeEnvelope(
      (g % 100) * 0.01, (g / 100) * 0.01,
      (g % 100) * 0.01 + 0.008, (g / 100) * 0.01 + 0.008), 4326)),
    0.6,
    CASE WHEN g % 20 = 0 THEN now() ELSE NULL END,
    now(), now()
  FROM generate_series(1, ${PARCELS}) AS g;
  ANALYZE "Parcel";
SQL

run_bench () {
  pgbench -n -T "${SECONDS_RUN}" -c "${CLIENTS}" -j 4 \
    -D loc="${LOCATION}" -D tenant="${TENANT}" \
    -f "${HERE}/parcel-list-bench.sql" "$DB" 2>&1 |
    grep -E "latency average|tps|initial connection|p95" || true
}

echo ""
echo "═══ EXPLAIN (ANALYZE) — WITH the composite index ═══"
psql "$DB" -q -c "EXPLAIN (ANALYZE, BUFFERS, SUMMARY OFF) SELECT \"id\",\"name\" FROM \"Parcel\"
  WHERE \"locationId\"='${LOCATION}' AND \"tenantId\"='${TENANT}' AND \"deletedAt\" IS NULL
  ORDER BY \"name\" ASC;" | sed -n '1,8p'

echo ""
echo "═══ AFTER (with index) ═══"
run_bench

echo ""
echo "→ dropping the composite index to measure the BEFORE state…"
psql "$DB" -q -c 'DROP INDEX IF EXISTS "Parcel_tenantId_locationId_deletedAt_idx";'

echo ""
echo "═══ EXPLAIN (ANALYZE) — WITHOUT the composite index (falls back to [tenantId,locationId]) ═══"
psql "$DB" -q -c "EXPLAIN (ANALYZE, BUFFERS, SUMMARY OFF) SELECT \"id\",\"name\" FROM \"Parcel\"
  WHERE \"locationId\"='${LOCATION}' AND \"tenantId\"='${TENANT}' AND \"deletedAt\" IS NULL
  ORDER BY \"name\" ASC;" | sed -n '1,8p'

echo ""
echo "═══ BEFORE (no composite index) ═══"
run_bench

echo ""
echo "→ restoring the index (also handled by the EXIT trap)."
psql "$DB" -q -c 'CREATE INDEX IF NOT EXISTS "Parcel_tenantId_locationId_deletedAt_idx" ON "Parcel"("tenantId","locationId","deletedAt");'
echo "done. Record the latency-average deltas in docs/perf/parcel-list-benchmark.md."
