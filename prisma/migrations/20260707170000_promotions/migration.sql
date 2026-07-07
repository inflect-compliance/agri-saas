-- Company promotions ("Offers" / Промоции) — #12.
-- GLOBAL catalogue (NO tenantId, like "Unit" / "AgriEvent") → not tenant-scoped,
-- no RLS: every tenant reads the same shared promotions feed.
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "mediaUrl" TEXT,
    "category" TEXT NOT NULL DEFAULT 'service',
    "ctaUrl" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- A lead captured on "Ask for offer". Mirrors ExchangeInquiry: inquirerTenantId
-- is a PLAIN FK to Tenant.id (NOT a tenantId RLS column) → not tenant-scoped.
CREATE TABLE "PromotionLead" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "inquirerTenantId" TEXT NOT NULL,
    "inquirerUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contextParcelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_createdAt_idx" ON "Promotion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionLead_promotionId_inquirerTenantId_key" ON "PromotionLead"("promotionId", "inquirerTenantId");

-- CreateIndex
CREATE INDEX "PromotionLead_promotionId_idx" ON "PromotionLead"("promotionId");

-- CreateIndex
CREATE INDEX "PromotionLead_inquirerTenantId_idx" ON "PromotionLead"("inquirerTenantId");

-- AddForeignKey
ALTER TABLE "PromotionLead" ADD CONSTRAINT "PromotionLead_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
