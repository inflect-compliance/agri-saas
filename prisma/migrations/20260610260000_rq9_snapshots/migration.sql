-- RQ-9 — risk + portfolio historical snapshots.
CREATE TABLE "RiskSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "inherentScore" INTEGER NOT NULL,
    "residualScore" INTEGER,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "ale" DOUBLE PRECISION,
    "fairAle" DOUBLE PRECISION,
    "sleAmount" DOUBLE PRECISION,
    "aroAmount" DOUBLE PRECISION,
    "tef" DOUBLE PRECISION,
    "vulnerability" DOUBLE PRECISION,
    "plm" DOUBLE PRECISION,
    "activeTreatmentPlans" INTEGER NOT NULL DEFAULT 0,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RiskSnapshot_tenantId_riskId_snapshotAt_idx" ON "RiskSnapshot"("tenantId", "riskId", "snapshotAt");
CREATE INDEX "RiskSnapshot_tenantId_snapshotAt_idx" ON "RiskSnapshot"("tenantId", "snapshotAt");
CREATE INDEX "RiskSnapshot_riskId_snapshotAt_idx" ON "RiskSnapshot"("riskId", "snapshotAt");
ALTER TABLE "RiskSnapshot" ADD CONSTRAINT "RiskSnapshot_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskSnapshot" ADD CONSTRAINT "RiskSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "totalRiskCount" INTEGER NOT NULL,
    "openRiskCount" INTEGER NOT NULL,
    "quantifiedCount" INTEGER NOT NULL,
    "totalAle" DOUBLE PRECISION,
    "avgAle" DOUBLE PRECISION,
    "maxSingleAle" DOUBLE PRECISION,
    "totalScore" INTEGER NOT NULL,
    "avgScore" DOUBLE PRECISION NOT NULL,
    "appetiteBreached" BOOLEAN NOT NULL DEFAULT false,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortfolioSnapshot_tenantId_snapshotAt_key" ON "PortfolioSnapshot"("tenantId", "snapshotAt");
CREATE INDEX "PortfolioSnapshot_tenantId_snapshotAt_idx" ON "PortfolioSnapshot"("tenantId", "snapshotAt");
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS (tenant isolation) ──
ALTER TABLE "RiskSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiskSnapshot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RiskSnapshot";
CREATE POLICY tenant_isolation ON "RiskSnapshot" USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "RiskSnapshot";
CREATE POLICY tenant_isolation_insert ON "RiskSnapshot" FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "RiskSnapshot";
CREATE POLICY superuser_bypass ON "RiskSnapshot" USING (current_setting('role') != 'app_user');

ALTER TABLE "PortfolioSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortfolioSnapshot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PortfolioSnapshot";
CREATE POLICY tenant_isolation ON "PortfolioSnapshot" USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "PortfolioSnapshot";
CREATE POLICY tenant_isolation_insert ON "PortfolioSnapshot" FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "PortfolioSnapshot";
CREATE POLICY superuser_bypass ON "PortfolioSnapshot" USING (current_setting('role') != 'app_user');
