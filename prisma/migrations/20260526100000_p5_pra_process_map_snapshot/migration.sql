-- Epic P5-PR-A — ProcessMapSnapshot table.
--
-- Per-version archival snapshot of the full graph JSON. Written
-- inside the same transaction as `replaceGraph` so a successful
-- version bump produces exactly one snapshot row. The
-- (processMapId, version) unique constraint guards against
-- retries.
--
-- RLS — direct-scoped Class A, mirrors the rest of the
-- processes.prisma family:
--   tenant_isolation        (USING)
--   tenant_isolation_insert (FOR INSERT WITH CHECK)
--   superuser_bypass        (USING role != 'app_user')
-- plus FORCE ROW LEVEL SECURITY.

CREATE TABLE "ProcessMapSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processMapId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graphJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "ProcessMapSnapshot_pkey" PRIMARY KEY ("id")
);

-- Foreign keys.
ALTER TABLE "ProcessMapSnapshot"
    ADD CONSTRAINT "ProcessMapSnapshot_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id");
ALTER TABLE "ProcessMapSnapshot"
    ADD CONSTRAINT "ProcessMapSnapshot_processMapId_tenantId_fkey"
    FOREIGN KEY ("processMapId", "tenantId")
    REFERENCES "ProcessMap"("id", "tenantId") ON DELETE CASCADE;
ALTER TABLE "ProcessMapSnapshot"
    ADD CONSTRAINT "ProcessMapSnapshot_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id");

-- Unique (processMapId, version) — one snapshot per version.
CREATE UNIQUE INDEX "ProcessMapSnapshot_processMapId_version_key"
    ON "ProcessMapSnapshot"("processMapId", "version");

-- Read indexes — descending-by-version list query + tenant-scope
-- audit reads.
CREATE INDEX "ProcessMapSnapshot_tenantId_processMapId_version_idx"
    ON "ProcessMapSnapshot"("tenantId", "processMapId", "version");
CREATE INDEX "ProcessMapSnapshot_tenantId_createdAt_idx"
    ON "ProcessMapSnapshot"("tenantId", "createdAt");

-- ── RLS ──
ALTER TABLE "ProcessMapSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessMapSnapshot" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ProcessMapSnapshot";
CREATE POLICY tenant_isolation ON "ProcessMapSnapshot"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "ProcessMapSnapshot";
CREATE POLICY tenant_isolation_insert ON "ProcessMapSnapshot"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "ProcessMapSnapshot";
CREATE POLICY superuser_bypass ON "ProcessMapSnapshot"
    USING (current_setting('role') != 'app_user');
