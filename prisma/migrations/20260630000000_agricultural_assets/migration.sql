-- Agricultural assets rework.
--
-- The Asset model pivots from an information-security "information asset"
-- (CIA triad, data classification, residency, retention) to a physical
-- AGRICULTURAL asset (machines, buildings, equipment): manufacturer,
-- model, serial number, year, purchase date/cost.
--
-- AssetType is replaced wholesale (no infosec value maps cleanly to a
-- machine/building), so every existing row's type is reset to OTHER for
-- the operator to re-categorise. AssetStatus gains IN_MAINTENANCE.

-- AlterEnum: AssetStatus gains an in-maintenance state (additive).
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'IN_MAINTENANCE';

-- AlterEnum: rebuild AssetType with agricultural categories. No old
-- (infosec) value has a sensible agricultural mapping, so every existing
-- Asset.type is reset to OTHER.
ALTER TYPE "AssetType" RENAME TO "AssetType_old";
CREATE TYPE "AssetType" AS ENUM (
  'TRACTOR',
  'HARVESTER',
  'IMPLEMENT',
  'VEHICLE',
  'IRRIGATION',
  'BUILDING',
  'STORAGE',
  'LIVESTOCK_EQUIPMENT',
  'TOOL',
  'OTHER'
);
ALTER TABLE "Asset"
  ALTER COLUMN "type" TYPE "AssetType" USING ('OTHER'::"AssetType");
DROP TYPE "AssetType_old";

-- AlterTable: drop the information-security columns and add the
-- agricultural attribute columns.
ALTER TABLE "Asset"
  DROP COLUMN "classification",
  DROP COLUMN "confidentiality",
  DROP COLUMN "integrity",
  DROP COLUMN "availability",
  DROP COLUMN "dependencies",
  DROP COLUMN "businessProcesses",
  DROP COLUMN "dataResidency",
  DROP COLUMN "retention",
  DROP COLUMN "retentionUntil",
  ADD COLUMN "manufacturer" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "serialNumber" TEXT,
  ADD COLUMN "year" INTEGER,
  ADD COLUMN "purchaseDate" TIMESTAMP(3),
  ADD COLUMN "purchaseCost" DECIMAL(12,2);
