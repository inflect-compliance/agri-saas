-- ═══════════════════════════════════════════════════════════════════
--  Agriculture — Phase 1: inventory ledger + journal
-- ═══════════════════════════════════════════════════════════════════
--  Adds InventoryLot (physical batches), the append-only hash-chained
--  StockTransaction ledger, and a focused journal (LogEntry +
--  LogQuantity). On OperationParcel completion the field-operation
--  usecase emits an INPUT_APPLICATION LogEntry + a CONSUMPTION
--  StockTransaction against the product's FEFO lot.
--
--  Hand-authored (repo convention): table DDL + indexes + FKs (matching
--  Prisma's constraint naming so no drift), then the canonical RLS trio
--  for every new tenant-scoped table, then the AuditLog-style
--  immutability trigger + privilege hardening on the ledger.
--  Unit is global (no tenantId) → no RLS, by design.
-- ═══════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "StockTransactionType" AS ENUM ('RECEIPT', 'CONSUMPTION', 'HARVEST_IN', 'TRANSFER', 'ADJUSTMENT', 'SALE_OUT', 'DISPOSAL');

-- CreateEnum
CREATE TYPE "LogEntryType" AS ENUM ('ACTIVITY', 'OBSERVATION', 'INPUT_APPLICATION', 'SEEDING', 'TRANSPLANTING', 'HARVEST', 'IRRIGATION', 'MAINTENANCE', 'LAB_TEST', 'GRAZING');

-- CreateEnum
CREATE TYPE "LogEntryStatus" AS ENUM ('PLANNED', 'DONE');

-- AlterTable — Item low-stock threshold
ALTER TABLE "Item" ADD COLUMN "reorderLevel" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "locationId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "quantityOnHand" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "unitId" TEXT NOT NULL,
    "attributesJson" JSONB,
    "unitCostAmount" DECIMAL(14,4),
    "unitCostCurrency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "retentionUntil" TIMESTAMP(3),

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "type" "StockTransactionType" NOT NULL,
    "quantityDelta" DECIMAL(16,4) NOT NULL,
    "unitId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "logEntryId" TEXT,
    "reason" TEXT,
    "costAmount" DECIMAL(14,2),
    "costCurrency" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousHash" TEXT,
    "entryHash" TEXT NOT NULL,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "LogEntryType" NOT NULL,
    "status" "LogEntryStatus" NOT NULL DEFAULT 'DONE',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "conditionsJson" JSONB,
    "operationParcelId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "retentionUntil" TIMESTAMP(3),

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogQuantity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logEntryId" TEXT NOT NULL,
    "measure" "QuantityMeasure" NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "unitId" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "LogQuantity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryLot_tenantId_itemId_idx" ON "InventoryLot"("tenantId", "itemId");
CREATE INDEX "InventoryLot_tenantId_locationId_idx" ON "InventoryLot"("tenantId", "locationId");
CREATE INDEX "InventoryLot_tenantId_expiresAt_idx" ON "InventoryLot"("tenantId", "expiresAt");
CREATE UNIQUE INDEX "InventoryLot_id_tenantId_key" ON "InventoryLot"("id", "tenantId");
CREATE UNIQUE INDEX "InventoryLot_tenantId_itemId_lotCode_key" ON "InventoryLot"("tenantId", "itemId", "lotCode");

-- CreateIndex
CREATE INDEX "StockTransaction_tenantId_lotId_occurredAt_idx" ON "StockTransaction"("tenantId", "lotId", "occurredAt");
CREATE INDEX "StockTransaction_tenantId_type_occurredAt_idx" ON "StockTransaction"("tenantId", "type", "occurredAt");
CREATE INDEX "StockTransaction_tenantId_logEntryId_idx" ON "StockTransaction"("tenantId", "logEntryId");
CREATE UNIQUE INDEX "StockTransaction_id_tenantId_key" ON "StockTransaction"("id", "tenantId");

-- CreateIndex
CREATE INDEX "LogEntry_tenantId_type_occurredAt_idx" ON "LogEntry"("tenantId", "type", "occurredAt");
CREATE INDEX "LogEntry_tenantId_status_occurredAt_idx" ON "LogEntry"("tenantId", "status", "occurredAt");
CREATE INDEX "LogEntry_tenantId_operationParcelId_idx" ON "LogEntry"("tenantId", "operationParcelId");
CREATE UNIQUE INDEX "LogEntry_id_tenantId_key" ON "LogEntry"("id", "tenantId");

-- CreateIndex
CREATE INDEX "LogQuantity_tenantId_logEntryId_idx" ON "LogQuantity"("tenantId", "logEntryId");
CREATE INDEX "LogQuantity_tenantId_unitId_idx" ON "LogQuantity"("tenantId", "unitId");

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "Item"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_locationId_tenantId_fkey" FOREIGN KEY ("locationId", "tenantId") REFERENCES "Location"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_lotId_tenantId_fkey" FOREIGN KEY ("lotId", "tenantId") REFERENCES "InventoryLot"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_logEntryId_tenantId_fkey" FOREIGN KEY ("logEntryId", "tenantId") REFERENCES "LogEntry"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_operationParcelId_fkey" FOREIGN KEY ("operationParcelId") REFERENCES "OperationParcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogQuantity" ADD CONSTRAINT "LogQuantity_logEntryId_tenantId_fkey" FOREIGN KEY ("logEntryId", "tenantId") REFERENCES "LogEntry"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LogQuantity" ADD CONSTRAINT "LogQuantity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
--  Row-Level Security — canonical trio for the new tenant-scoped tables
--  (mirrors the Feature 1 migration). Unit is global → none.
-- ═══════════════════════════════════════════════════════════════════

-- ── InventoryLot ───────────────────────────────────────────────────
ALTER TABLE "InventoryLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryLot";
CREATE POLICY tenant_isolation ON "InventoryLot"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "InventoryLot";
CREATE POLICY tenant_isolation_insert ON "InventoryLot"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "InventoryLot";
CREATE POLICY superuser_bypass ON "InventoryLot"
    USING (current_setting('role') != 'app_user');

-- ── StockTransaction ───────────────────────────────────────────────
ALTER TABLE "StockTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockTransaction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockTransaction";
CREATE POLICY tenant_isolation ON "StockTransaction"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "StockTransaction";
CREATE POLICY tenant_isolation_insert ON "StockTransaction"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "StockTransaction";
CREATE POLICY superuser_bypass ON "StockTransaction"
    USING (current_setting('role') != 'app_user');

-- ── LogEntry ───────────────────────────────────────────────────────
ALTER TABLE "LogEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LogEntry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LogEntry";
CREATE POLICY tenant_isolation ON "LogEntry"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "LogEntry";
CREATE POLICY tenant_isolation_insert ON "LogEntry"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "LogEntry";
CREATE POLICY superuser_bypass ON "LogEntry"
    USING (current_setting('role') != 'app_user');

-- ── LogQuantity ────────────────────────────────────────────────────
ALTER TABLE "LogQuantity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LogQuantity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LogQuantity";
CREATE POLICY tenant_isolation ON "LogQuantity"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS tenant_isolation_insert ON "LogQuantity";
CREATE POLICY tenant_isolation_insert ON "LogQuantity"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "LogQuantity";
CREATE POLICY superuser_bypass ON "LogQuantity"
    USING (current_setting('role') != 'app_user');

-- ═══════════════════════════════════════════════════════════════════
--  Immutability — StockTransaction is the append-only ledger. A
--  BEFORE UPDATE OR DELETE trigger raises (mirrors AuditLog). The
--  InventoryLot.quantityOnHand cache is refreshed by re-reading the
--  ledger sum, never by mutating a ledger row. Defence-in-depth:
--  revoke UPDATE/DELETE on the ledger from app_user.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION stock_transaction_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'IMMUTABLE_STOCK_LEDGER: % operations on "StockTransaction" are forbidden. '
        'The stock ledger is append-only; post a reversing/ADJUSTMENT entry instead.',
        TG_OP
    USING ERRCODE = 'restrict_violation';
    RETURN NULL; -- never reached
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_transaction_immutable ON "StockTransaction";
CREATE TRIGGER stock_transaction_immutable
    BEFORE UPDATE OR DELETE ON "StockTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION stock_transaction_immutable_guard();

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        REVOKE UPDATE, DELETE ON "StockTransaction" FROM app_user;
        GRANT SELECT, INSERT ON "StockTransaction" TO app_user;
    END IF;
END
$$;

SELECT 'Inventory ledger + journal installed — StockTransaction is append-only' AS result;
