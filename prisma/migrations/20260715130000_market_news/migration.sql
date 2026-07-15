-- Market-news backbone — GLOBAL, tenant-agnostic news cache.
--
-- MarketNewsItem carries NO tenantId (public reference data aggregated from
-- free Bulgarian agri RSS/Atom feeds + ДФ Земеделие + EC agri press) —
-- identical for every tenant, exactly like "MarketPriceSeries" / "SoilSample".
-- Because it has no tenantId it is excluded from TENANT_SCOPED_MODELS and
-- carries NO row-level-security policy. Feeds the Trends → News tab.

-- CreateTable
CREATE TABLE "MarketNewsItem" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "guidHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketNewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: idempotent-upsert / dedupe key.
CREATE UNIQUE INDEX "MarketNewsItem_guidHash_key" ON "MarketNewsItem"("guidHash");

-- CreateIndex: filter by category, newest first.
CREATE INDEX "MarketNewsItem_category_publishedAt_idx" ON "MarketNewsItem"("category", "publishedAt");

-- CreateIndex: all-categories read (newest first) + 60-day prune scan.
CREATE INDEX "MarketNewsItem_publishedAt_idx" ON "MarketNewsItem"("publishedAt");
