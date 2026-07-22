-- PromotionLead: consent, retention, and row-level security.
--
-- Three separate defects, one migration because they all reshape the same
-- table and splitting them would mean three RLS-less windows.
--
-- 1. `consentedAt` — a lead is contact PII forwarded to a third party. Without
--    a recorded consent timestamp there is nothing to point at when asked why
--    a farmer's name and message reached a supplier. NOT NULL on purpose: the
--    column IS the enforcement point, not a flag beside it.
--
-- 2. `deletedAt` — contact PII needs a retention window and a way to honour an
--    erasure request without breaking the @@unique(promotionId, inquirerTenantId)
--    dedup by hard-deleting rows.
--
-- 3. RLS — `PromotionLead` is CROSS-TENANT (`inquirerTenantId` is a plain FK,
--    deliberately not a `tenantId` RLS column), so it never entered the
--    rls-coverage inventory, which keys off `tenantId`. It has therefore been
--    a table holding one tenant's PII, readable by any tenant's session, and
--    invisible to the ratchet that exists to catch exactly that. It goes on
--    the same parallel-axis footing as the Organization layer: its own named
--    policy, plus the canonical superuser_bypass and FORCE.

-- ── 1 + 2. Columns ────────────────────────────────────────────────────────
-- Backfill order matters: add nullable, fill, then SET NOT NULL. Production
-- holds zero leads, but dev/demo databases may hold some and a bare NOT NULL
-- would fail there. Existing rows predate the consent checkbox, so they are
-- backfilled from `createdAt` — the honest reading is "consent unrecorded at
-- this time", and the retention sweep will age them out.
ALTER TABLE "PromotionLead" ADD COLUMN IF NOT EXISTS "consentedAt" TIMESTAMP(3);
ALTER TABLE "PromotionLead" ADD COLUMN IF NOT EXISTS "deletedAt"   TIMESTAMP(3);
UPDATE "PromotionLead" SET "consentedAt" = "createdAt" WHERE "consentedAt" IS NULL;
ALTER TABLE "PromotionLead" ALTER COLUMN "consentedAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "PromotionLead_deletedAt_createdAt_idx"
    ON "PromotionLead" ("deletedAt", "createdAt");

-- ── 3. Row-level security, keyed on inquirerTenantId ─────────────────────
-- A single policy (not the split tenant_isolation / tenant_isolation_insert
-- pair) because `inquirerTenantId` is NOT NULL: there is no nullable-row case
-- to read permissively, so USING and WITH CHECK can both be the strict
-- own-tenant predicate. Naming it for the column it keys on keeps it obvious
-- that this is a parallel axis, not the standard tenantId isolation.
ALTER TABLE "PromotionLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromotionLead" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promotion_lead_inquirer_isolation ON "PromotionLead";
DROP POLICY IF EXISTS superuser_bypass                  ON "PromotionLead";

CREATE POLICY promotion_lead_inquirer_isolation ON "PromotionLead"
    USING      ("inquirerTenantId" = current_setting('app.tenant_id', true)::text)
    WITH CHECK ("inquirerTenantId" = current_setting('app.tenant_id', true)::text);

-- Privileged paths (platform-admin curation, the future lead digest, seeds,
-- migrations) run as a non-`app_user` role and bypass, exactly as every other
-- table in the schema does.
CREATE POLICY superuser_bypass ON "PromotionLead"
    USING (current_setting('role') != 'app_user');
