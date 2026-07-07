-- AlterTable: per-parcel modelled soil profile (SoilGrids-derived estimate).
ALTER TABLE "Parcel" ADD COLUMN     "soilType" TEXT,
ADD COLUMN     "soilJson" JSONB;

-- AlterTable: per-variety soil-preference defaults for advisory suitability.
ALTER TABLE "CropVariety" ADD COLUMN     "soilDefaultsJson" JSONB;

-- CreateTable: GLOBAL soil-sample cache (NO tenantId — shared open-data
-- catalog, like "Unit"). Keyed by a rounded lat/lon grid cell so nearby
-- parcels reuse one provider call and we stay within SoilGrids fair-use.
CREATE TABLE "SoilSample" (
    "id" TEXT NOT NULL,
    "latE3" INTEGER NOT NULL,
    "lonE3" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "dataJson" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoilSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoilSample_latE3_lonE3_key" ON "SoilSample"("latE3", "lonE3");
