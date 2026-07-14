-- ParcelLease — tenant-scoped land-use agreements (аренда/наем). Business data,
-- so RLS is enforced (split tenant_isolation + insert-check + superuser_bypass,
-- non-null tenantId — same shape as AiUsageEvent).

-- CreateEnum
CREATE TYPE "LeaseKind" AS ENUM ('ARENDA', 'NAEM');

-- CreateTable
CREATE TABLE "ParcelLease" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "lessorName" TEXT NOT NULL,
    "lessorEik" TEXT,
    "kind" "LeaseKind" NOT NULL DEFAULT 'ARENDA',
    "rentAmount" DECIMAL(14,2),
    "rentUnit" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "documentRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ParcelLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParcelLease_tenantId_parcelId_idx" ON "ParcelLease"("tenantId", "parcelId");
CREATE INDEX "ParcelLease_tenantId_endDate_idx" ON "ParcelLease"("tenantId", "endDate");

-- AddForeignKey
ALTER TABLE "ParcelLease" ADD CONSTRAINT "ParcelLease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParcelLease" ADD CONSTRAINT "ParcelLease_parcelId_tenantId_fkey" FOREIGN KEY ("parcelId", "tenantId") REFERENCES "Parcel"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security
DO $$
DECLARE t text := 'ParcelLease';
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)::text)', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::text)', t);
    EXECUTE format('DROP POLICY IF EXISTS superuser_bypass ON %I', t);
    EXECUTE format('CREATE POLICY superuser_bypass ON %I USING (current_setting(''role'') != ''app_user'')', t);
END $$;
