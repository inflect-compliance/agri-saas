-- Exchange product-kind (#11). GLOBAL table (no tenantId, no RLS).
-- CreateEnum
CREATE TYPE "ExchangeKind" AS ENUM ('CULTURE', 'FERTILIZER', 'SEEDS', 'PRODUCT');

-- AlterTable: add kind, backfilling existing listings to CULTURE (crops).
ALTER TABLE "ExchangeListing" ADD COLUMN "kind" "ExchangeKind" NOT NULL DEFAULT 'CULTURE';

-- Index the browse dimension alongside status (perf-only; optional).
CREATE INDEX "ExchangeListing_kind_status_idx" ON "ExchangeListing"("kind", "status");
