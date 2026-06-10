-- RQ-4 — what-if scenario storage.
CREATE TABLE "RiskScenario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "baselineRunId" TEXT,
    "overridesJson" JSONB NOT NULL,
    "resultRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "investmentCost" DOUBLE PRECISION,
    "computedRoi" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiskScenario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RiskScenario_tenantId_idx" ON "RiskScenario"("tenantId");
CREATE INDEX "RiskScenario_tenantId_status_idx" ON "RiskScenario"("tenantId", "status");
CREATE INDEX "RiskScenario_tenantId_createdAt_idx" ON "RiskScenario"("tenantId", "createdAt");
ALTER TABLE "RiskScenario" ADD CONSTRAINT "RiskScenario_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS (tenant isolation) ──
ALTER TABLE "RiskScenario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiskScenario" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RiskScenario";
CREATE POLICY tenant_isolation ON "RiskScenario"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "RiskScenario";
CREATE POLICY tenant_isolation_insert ON "RiskScenario"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "RiskScenario";
CREATE POLICY superuser_bypass ON "RiskScenario"
    USING (current_setting('role') != 'app_user');
