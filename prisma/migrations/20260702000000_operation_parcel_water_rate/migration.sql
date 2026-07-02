-- Water-carrier rate for the spray tank (per-decare), persisted on the
-- treatment OperationParcel line so the per-parcel water total
-- (waterRateValue × parcel dca) can be recomputed anywhere the job is shown.
ALTER TABLE "OperationParcel" ADD COLUMN "waterRateValue" DECIMAL(14,4);
ALTER TABLE "OperationParcel" ADD COLUMN "waterRateUnitId" TEXT;

-- Layer-B FK index (schema-index-coverage guard).
CREATE INDEX "OperationParcel_tenantId_waterRateUnitId_idx" ON "OperationParcel"("tenantId", "waterRateUnitId");

-- Nullable FK to the global Unit catalog → SET NULL on delete (mirrors the
-- completedByUserId optional relation on this table).
ALTER TABLE "OperationParcel" ADD CONSTRAINT "OperationParcel_waterRateUnitId_fkey" FOREIGN KEY ("waterRateUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
