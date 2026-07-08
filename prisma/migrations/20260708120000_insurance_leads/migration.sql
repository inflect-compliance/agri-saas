-- Insurance quote requests from the per-parcel Risk page (#13).
-- Lead-gen only. inquirerTenantId is a PLAIN FK to Tenant.id (NOT a tenantId
-- RLS column), so the row is not tenant-scoped — no RLS (mirrors PromotionLead).
CREATE TABLE "InsuranceLead" (
    "id" TEXT NOT NULL,
    "inquirerTenantId" TEXT NOT NULL,
    "inquirerUserId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "locationId" TEXT,
    "message" TEXT NOT NULL,
    "riskJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceLead_parcelId_inquirerTenantId_key" ON "InsuranceLead"("parcelId", "inquirerTenantId");

-- CreateIndex
CREATE INDEX "InsuranceLead_inquirerTenantId_idx" ON "InsuranceLead"("inquirerTenantId");

-- CreateIndex
CREATE INDEX "InsuranceLead_parcelId_idx" ON "InsuranceLead"("parcelId");
