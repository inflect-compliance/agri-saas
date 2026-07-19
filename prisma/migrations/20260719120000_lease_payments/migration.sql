-- Rent-roll unit-awareness + the lease payment leg.
--
-- 1) ParcelLease.rentUnitRaw preserves the operator's original free-text unit
--    while rentUnit becomes the CANONICAL value the roll groups by.
-- 2) ParcelLease gains the cross-tenant row barrier @@unique([id, tenantId]) so
--    LeasePayment can carry a composite [leaseId, tenantId] FK.
-- 3) LeasePayment records rent actually paid per season, so the roll can answer
--    "who hasn't been paid".

-- ── 1. rentUnitRaw + backfill ──────────────────────────────────────────────
ALTER TABLE "ParcelLease" ADD COLUMN "rentUnitRaw" TEXT;
-- Existing rows: the typed value IS what was entered; canonical form is
-- already „лв/дка" for every current row, so a straight copy is faithful.
UPDATE "ParcelLease" SET "rentUnitRaw" = "rentUnit" WHERE "rentUnit" IS NOT NULL;

-- ── 2. cross-tenant row barrier on ParcelLease ─────────────────────────────
CREATE UNIQUE INDEX "ParcelLease_id_tenantId_key" ON "ParcelLease"("id", "tenantId");

-- ── 3. LeasePayment ────────────────────────────────────────────────────────
CREATE TABLE "LeasePayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL,
    "unit" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "LeasePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeasePayment_tenantId_leaseId_idx" ON "LeasePayment"("tenantId", "leaseId");
CREATE INDEX "LeasePayment_tenantId_seasonYear_idx" ON "LeasePayment"("tenantId", "seasonYear");

ALTER TABLE "LeasePayment" ADD CONSTRAINT "LeasePayment_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeasePayment" ADD CONSTRAINT "LeasePayment_leaseId_tenantId_fkey"
    FOREIGN KEY ("leaseId", "tenantId") REFERENCES "ParcelLease"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security — same shape as ParcelLease.
DO $$
DECLARE t text := 'LeasePayment';
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
