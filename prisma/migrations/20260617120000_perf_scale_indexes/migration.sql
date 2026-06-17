-- ═══════════════════════════════════════════════════════════════════
-- perf-scale — composite indexes for large operations (50+ fields, 100k+ lots)
-- ═══════════════════════════════════════════════════════════════════
--
-- Hand-authored (repo convention): three additive index creations, no
-- RLS / table / column changes, so `migrate dev --create-only` would only
-- have injected unrelated drift (incl. a re-scaffolded drop of the
-- Parcel_geometry_gist GiST index) which is omitted here. The existing
-- GiST index on Parcel.geometry is intentionally LEFT IN PLACE.
--
-- Index names match Prisma's `{Model}_{cols}_idx` convention so a future
-- `migrate dev` sees no drift. IDEMPOTENT (IF NOT EXISTS) — safe to re-run.
--
-- NOTE for ops on a very large existing table: these are plain (locking)
-- CREATE INDEX statements run inside the migration transaction. On a
-- multi-million-row table, build the same index out-of-band with
-- CREATE INDEX CONCURRENTLY first; this migration's IF NOT EXISTS then
-- no-ops on deploy.

-- Parcel list per field — filters (tenantId, locationId, deletedAt IS NULL),
-- orders by name. Folds the soft-delete predicate into the index.
CREATE INDEX IF NOT EXISTS "Parcel_tenantId_locationId_deletedAt_idx"
    ON "Parcel"("tenantId", "locationId", "deletedAt");

-- Cursor-paginated lot list (listLotsPaginated) — orders by (createdAt, id)
-- over a tenant's lots; backs a 100k-lot field's page walk.
CREATE INDEX IF NOT EXISTS "InventoryLot_tenantId_createdAt_idx"
    ON "InventoryLot"("tenantId", "createdAt");

-- Cursor-paginated ledger (lotLedger) — orders by (createdAt, id) within a
-- lot; backs a high-volume lot's ledger pages.
CREATE INDEX IF NOT EXISTS "StockTransaction_tenantId_lotId_createdAt_idx"
    ON "StockTransaction"("tenantId", "lotId", "createdAt");
