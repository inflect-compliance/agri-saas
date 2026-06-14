-- ═══════════════════════════════════════════════════════════════════
--  Inventory — Phase 1 follow-up: lot genealogy (LotLink)
-- ═══════════════════════════════════════════════════════════════════
--  Adds the food-safety provenance graph: a directed DERIVATION edge
--  per input lot consumed on a field → the HARVEST_IN lot recorded from
--  that field. Append-only (immutability trigger mirrors the
--  StockTransaction ledger). Also adds the LOW_STOCK NotificationType
--  fired by the daily low-stock-monitor job.
--
--  Hand-authored (repo convention): only the LotLink table + the two
--  enum changes are kept — `migrate dev --create-only` injected
--  unrelated pre-existing drift (FK churn on ControlException /
--  ProcessMapSnapshot / ReadinessSnapshot / Stock/InventoryLot, the
--  Parcel_geometry_gist GiST index drop, emailHash NOT NULL changes)
--  which is stripped here. Then the canonical RLS trio + the
--  AuditLog-style immutability trigger + app_user privilege hardening.
-- ═══════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "LotLinkType" AS ENUM ('DERIVATION', 'SPLIT', 'MERGE');

-- AlterEnum — new low-stock alert notification type
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LOW_STOCK';

-- CreateTable
CREATE TABLE "LotLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentLotId" TEXT NOT NULL,
    "childLotId" TEXT NOT NULL,
    "type" "LotLinkType" NOT NULL DEFAULT 'DERIVATION',
    "logEntryId" TEXT,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotLink_tenantId_parentLotId_idx" ON "LotLink"("tenantId", "parentLotId");
CREATE INDEX "LotLink_tenantId_childLotId_idx" ON "LotLink"("tenantId", "childLotId");
CREATE INDEX "LotLink_tenantId_logEntryId_idx" ON "LotLink"("tenantId", "logEntryId");
CREATE UNIQUE INDEX "LotLink_id_tenantId_key" ON "LotLink"("id", "tenantId");
CREATE UNIQUE INDEX "LotLink_tenantId_parentLotId_childLotId_key" ON "LotLink"("tenantId", "parentLotId", "childLotId");

-- AddForeignKey
ALTER TABLE "LotLink" ADD CONSTRAINT "LotLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LotLink" ADD CONSTRAINT "LotLink_parentLotId_tenantId_fkey" FOREIGN KEY ("parentLotId", "tenantId") REFERENCES "InventoryLot"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LotLink" ADD CONSTRAINT "LotLink_childLotId_tenantId_fkey" FOREIGN KEY ("childLotId", "tenantId") REFERENCES "InventoryLot"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LotLink" ADD CONSTRAINT "LotLink_logEntryId_tenantId_fkey" FOREIGN KEY ("logEntryId", "tenantId") REFERENCES "LogEntry"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LotLink" ADD CONSTRAINT "LotLink_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
--  Row-Level Security — canonical trio for the new tenant-scoped table.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE "LotLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LotLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LotLink";
CREATE POLICY tenant_isolation ON "LotLink"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "LotLink";
CREATE POLICY tenant_isolation_insert ON "LotLink"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "LotLink";
CREATE POLICY superuser_bypass ON "LotLink"
    USING (current_setting('role') != 'app_user');

-- ═══════════════════════════════════════════════════════════════════
--  Immutability — LotLink genealogy edges are append-only provenance
--  records. A BEFORE UPDATE OR DELETE trigger raises (mirrors the
--  StockTransaction ledger). Defence-in-depth: revoke UPDATE/DELETE
--  on the table from app_user.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION lot_link_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'IMMUTABLE_LOT_GENEALOGY: % operations on "LotLink" are forbidden. '
        'Lot genealogy edges are append-only provenance records.',
        TG_OP
    USING ERRCODE = 'restrict_violation';
    RETURN NULL; -- never reached
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lot_link_immutable ON "LotLink";
CREATE TRIGGER lot_link_immutable
    BEFORE UPDATE OR DELETE ON "LotLink"
    FOR EACH ROW
    EXECUTE FUNCTION lot_link_immutable_guard();

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        REVOKE UPDATE, DELETE ON "LotLink" FROM app_user;
        GRANT SELECT, INSERT ON "LotLink" TO app_user;
    END IF;
END
$$;

SELECT 'Lot genealogy installed — LotLink is append-only' AS result;
