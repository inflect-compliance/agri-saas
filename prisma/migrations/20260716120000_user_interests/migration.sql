-- User interests — powers the News page's "For You" tab (items matching any of
-- the user's chosen keywords). Tenant-scoped (RLS) + per-user; syncs across the
-- user's devices within a tenant. Mirrors the Class-A RLS pattern of
-- `ParcelLease` (non-nullable tenantId): tenant_isolation (FOR ALL) +
-- tenant_isolation_insert (FOR INSERT WITH CHECK) + superuser_bypass, FORCE RLS.

-- CreateTable
CREATE TABLE "UserInterest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: idempotent PUT-replace key.
CREATE UNIQUE INDEX "UserInterest_tenantId_userId_keyword_key" ON "UserInterest"("tenantId", "userId", "keyword");

-- CreateIndex: tenant-leading (RLS + per-user list read); FK userId as 2nd col.
CREATE INDEX "UserInterest_tenantId_userId_idx" ON "UserInterest"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (tenant isolation).
DO $$
DECLARE t text := 'UserInterest';
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
