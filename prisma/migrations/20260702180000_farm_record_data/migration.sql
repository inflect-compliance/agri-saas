-- БАБХ farm-record data capture (PR 1/3).
--
-- Adds the data points the Bulgarian БАБХ "ДНЕВНИК за проведените
-- растителнозащитни мероприятия и торене" needs so a later PR can
-- generate it as a filled PDF. Data + capture only — no PDF here.
--
--   • FarmProfile — one-per-tenant farm identity block (RLS trio below).
--   • Item        — regulatory fields (quarantine / active ingredient / PPP reg).
--   • Task        — operationType + applicationTechnique (split SPRAY vs FERTILIZE).
--   • TenantMembership — plant-protection certificates.
--
-- The "FieldOperationType" Postgres enum already exists (created by
-- 20260613090735_ag_feature1_spray_map), so Task.operationType simply
-- references it — no CREATE TYPE here.

-- AlterTable — Item regulatory fields
ALTER TABLE "Item"
    ADD COLUMN "quarantinePeriodDays" INTEGER,
    ADD COLUMN "activeIngredient" TEXT,
    ADD COLUMN "pppRegistrationNo" TEXT;

-- AlterTable — Task operation type + application technique
ALTER TABLE "Task"
    ADD COLUMN "operationType" "FieldOperationType",
    ADD COLUMN "applicationTechnique" TEXT;

-- AlterTable — TenantMembership plant-protection certificates
ALTER TABLE "TenantMembership"
    ADD COLUMN "applicatorCertNo" TEXT,
    ADD COLUMN "agronomistCertNo" TEXT,
    ADD COLUMN "agronomistName" TEXT;

-- CreateTable — FarmProfile (1:1 Tenant)
CREATE TABLE "FarmProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "producerName" TEXT,
    "egn" TEXT,
    "eik" TEXT,
    "address" TEXT,
    "municipality" TEXT,
    "settlement" TEXT,
    "agricultureDirectorateCity" TEXT,
    "registrationPlace" TEXT,
    "registrationEkatte" TEXT,
    "odbhCity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — unique tenantId (the 1:1 barrier + tenantId-leading index)
CREATE UNIQUE INDEX "FarmProfile_tenantId_key" ON "FarmProfile"("tenantId");

-- AddForeignKey
ALTER TABLE "FarmProfile" ADD CONSTRAINT "FarmProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — canonical tenant-isolation trio (matches the
-- enterprise-grain pattern). FarmProfile carries a non-nullable tenantId,
-- so it enters TENANT_SCOPED_MODELS via the DMMF and rls-coverage requires
-- tenant_isolation + tenant_isolation_insert + superuser_bypass + FORCE.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['FarmProfile']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)::text)', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::text)', t);
    EXECUTE format('DROP POLICY IF EXISTS superuser_bypass ON %I', t);
    EXECUTE format('CREATE POLICY superuser_bypass ON %I USING (current_setting(''role'') != ''app_user'')', t);
  END LOOP;
END $$;
