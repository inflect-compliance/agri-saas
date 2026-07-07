-- #9 — crop planning per parcel. A CropPlan can target a specific parcel
-- within its location (nullable: plans may stay location-level). The Planting
-- side already carries parcelId (see 20260701 planning migration); this adds
-- the plan-level dimension so the succession engine can stamp it.
ALTER TABLE "CropPlan" ADD COLUMN "parcelId" TEXT;

-- CreateIndex
CREATE INDEX "CropPlan_tenantId_parcelId_idx" ON "CropPlan"("tenantId", "parcelId");

-- AddForeignKey (composite [parcelId, tenantId] -> Parcel[id, tenantId],
-- mirroring the Planting.parcel relation).
ALTER TABLE "CropPlan" ADD CONSTRAINT "CropPlan_parcelId_tenantId_fkey" FOREIGN KEY ("parcelId", "tenantId") REFERENCES "Parcel"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
