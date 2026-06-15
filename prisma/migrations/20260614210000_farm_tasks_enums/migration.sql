-- ═══════════════════════════════════════════════════════════════════
--  Farm Tasks — enum extensions only
-- ═══════════════════════════════════════════════════════════════════
--  Farm tasks reuse the IC Task module wholesale. This migration only
--  widens two enums:
--    • TaskLinkEntityType += EQUIPMENT, PLANTING — so a task can link to
--      a piece of equipment or (reserved) a crop planting. LOCATION /
--      PARCEL already landed with Feature 1.
--    • WorkItemType += FARM_TASK — the discriminator for general farm
--      work (the LiteFarm-catalog type + category ride in Task.metadataJson).
--  No new table → no RLS. `ADD VALUE IF NOT EXISTS` is idempotent and runs
--  fine in the migration transaction on PG16.
-- ═══════════════════════════════════════════════════════════════════

ALTER TYPE "TaskLinkEntityType" ADD VALUE IF NOT EXISTS 'EQUIPMENT';
ALTER TYPE "TaskLinkEntityType" ADD VALUE IF NOT EXISTS 'PLANTING';
ALTER TYPE "WorkItemType" ADD VALUE IF NOT EXISTS 'FARM_TASK';

SELECT 'Farm-task enums installed' AS result;
