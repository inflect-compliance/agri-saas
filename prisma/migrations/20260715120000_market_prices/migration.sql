-- Market-price backbone — GLOBAL, tenant-agnostic price cache.
--
-- MarketPriceSeries + MarketPricePoint carry NO tenantId (public reference
-- data from the EC AGRI-food open API / Alpha Vantage, plus a k-anonymised
-- cross-tenant listings median) — identical for every tenant, exactly like
-- "SoilSample" / "CadastreArchive". Because they have no tenantId they are
-- excluded from TENANT_SCOPED_MODELS and carry NO row-level-security policy.

-- CreateTable
CREATE TABLE "MarketPriceSeries" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "stage" TEXT,
    "label" TEXT,
    "unit" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketPriceSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPricePoint" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: natural key for idempotent series upsert.
CREATE UNIQUE INDEX "MarketPriceSeries_source_commodity_region_stage_key" ON "MarketPriceSeries"("source", "commodity", "region", "stage");

-- CreateIndex: idempotent-upsert key for points.
CREATE UNIQUE INDEX "MarketPricePoint_seriesId_date_key" ON "MarketPricePoint"("seriesId", "date");

-- CreateIndex: FK index (schema-index Layer B).
CREATE INDEX "MarketPricePoint_seriesId_idx" ON "MarketPricePoint"("seriesId");

-- AddForeignKey
ALTER TABLE "MarketPricePoint" ADD CONSTRAINT "MarketPricePoint_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MarketPriceSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
