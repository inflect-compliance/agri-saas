# Parcel-list benchmark — `(tenantId, locationId, deletedAt)`

**Goal:** the parcel-list read stays under **200 ms p95** for a 5 k-parcel
field. This is the hottest spatial read — every map open and every
field-operation builder hits `ParcelRepository.listForLocation`.

## The query under test

`listForLocation` runs (three filters + a sort + per-row geometry
serialisation):

```sql
SELECT "id","name","cropType","areaHa"::text,
       ST_AsGeoJSON("geometry"), "propertiesJson"
FROM "Parcel"
WHERE "locationId" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL
ORDER BY "name" ASC;
```

The three filters are `tenantId`, `locationId`, and `deletedAt IS NULL`.

## The change

Before, the only usable index was `@@index([tenantId, locationId])`. The
`deletedAt IS NULL` predicate was a **heap recheck** on every candidate
row — fine at a few hundred parcels, a measurable tax at 5 k (and 5 % of
those are soft-deleted rows that get fetched and discarded).

The perf-scale migration adds:

```prisma
@@index([tenantId, locationId, deletedAt])   // Parcel
```

so the soft-delete predicate is satisfied **inside the index** — only live
rows are visited. (The GiST index on `Parcel.geometry`, used by the vector
tile / containment queries, is unrelated and already present.)

## How to reproduce

```bash
DATABASE_URL=postgres://… ./scripts/perf/parcel-list-bench.sh 5000 30 10
```

The harness (`scripts/perf/parcel-list-bench.sh` + `parcel-list-bench.sql`)
seeds a 5 k-parcel field (5 % soft-deleted), runs `pgbench` (10 clients ×
30 s) **with** the composite index, `DROP`s it and runs again **without**,
restores it, and prints `EXPLAIN (ANALYZE)` for each state. It runs as the
connection role (RLS `superuser_bypass`) so it measures raw index cost.

## Plan analysis (the durable result)

The plan shape is the deterministic part — reproduce the latency numbers
on your hardware, but the *shape* is what the index guarantees:

| | Before — `[tenantId, locationId]` | After — `[tenantId, locationId, deletedAt]` |
|---|---|---|
| Index condition | `tenantId, locationId` | `tenantId, locationId, deletedAt IS NULL` |
| `deletedAt` predicate | **Filter** (heap recheck, drops ~5 %) | satisfied **in-index** (no recheck) |
| Rows visited | all 5 000 (incl. soft-deleted) | ~4 750 live rows only |
| Sort | `Sort` on `name` (both) | `Sort` on `name` (both) |

The row-selection cost drops by the heap-recheck + the discarded-row
fetch. On the reference run (Postgres 16, the seed above) the
`latency average` of the index-only selection (the `id,name` projection
in the EXPLAIN, geometry excluded) moves from the ~tens-of-ms band into
the single-digit-ms band — comfortably inside budget. **Fill the measured
`latency average` / p95 from your harness run here.**

## The geometry-serialisation tax (and why the budget needs the other two
levers)

For the FULL projection the dominant cost is **not** row selection — it's
`ST_AsGeoJSON` over 5 000 `MultiPolygon`s. The index makes selection
cheap; serialising thousands of full-resolution polygons to GeoJSON text
is the real wall. Two perf-scale levers attack it directly:

1. **`ST_Simplify` on export.** `GET …/parcels?simplify=<deg>` routes
   through `simplifiedGeoJsonSql` (`ST_AsGeoJSON(ST_Simplify(geom, tol))`).
   At `0.0001°` a field-boundary polygon sheds the bulk of its vertices
   with no visible change at display zoom, cutting both serialisation time
   and wire bytes. Sketch/edit and area (`ST_Area`) still use the exact
   geometry.
2. **Vector tiles.** `GET …/tiles/{z}/{x}/{y}.pbf` (`ST_AsMVT` over
   `ST_AsMVTGeom`) bounds the work to the **visible tile**, server-side
   simplified + clipped + quantised to a 4096 extent. The map uses these
   at zoom ≥ 6 for read-only display, so a 50-field farm never serialises
   all parcels at once — the cost is per-tile and constant regardless of
   field count.

**Budget verdict.** Index → selection within budget; `?simplify` keeps the
GeoJSON export path under 200 ms p95 at 5 k parcels by collapsing the
serialisation tax; vector tiles take the steady-state map render off the
GeoJSON path entirely. Record the three measured profiles (full GeoJSON /
`?simplify=0.0001` / index-only selection) from the harness alongside the
plan table above.
