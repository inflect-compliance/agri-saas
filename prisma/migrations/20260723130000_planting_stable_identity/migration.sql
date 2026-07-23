-- Plan-vs-actual crop loop — give a succession-planting a STABLE identity.
--
-- `generatePlantings` previously delete-and-recreated the plan's PLANNED
-- rows on every run, minting fresh cuids. That wiped recorded actuals
-- (LogPlanting FKs to the planting id) and orphaned + duplicated the
-- auto-generated field tasks (TaskLink.entityId is the planting id).
--
-- Keying on (tenantId, cropPlanId, successionNumber) lets regenerate
-- UPSERT in place — planting ids are preserved — and makes it structurally
-- impossible for a plan to hold two rows for the same succession.
--
-- The unique's `(tenantId, cropPlanId)` prefix already covers the
-- cropPlanId FK + the per-plan list read, so the standalone composite
-- index is now redundant and is dropped.
DROP INDEX "Planting_tenantId_cropPlanId_idx";

CREATE UNIQUE INDEX "Planting_tenantId_cropPlanId_successionNumber_key"
    ON "Planting" ("tenantId", "cropPlanId", "successionNumber");
