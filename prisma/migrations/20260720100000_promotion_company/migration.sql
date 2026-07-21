-- Promotions #12 — extract the free-text `Promotion.company` string into a
-- first-class `Company` catalogue, and add the editorial `publishedAt` gate.
--
-- WHY: a supplier runs repeat campaigns, so its identity has to outlive any
-- single promotion. As a bare string, "Syngenta" and "Syngenta " were two
-- unrelated advertisers, and there was nowhere to hold the contact address the
-- lead-digest needs to send to.
--
-- The backfill is order-sensitive: Company rows must exist and every Promotion
-- must be pointed at one BEFORE companyId can go NOT NULL and the old column
-- can be dropped. Written to be correct on a populated dev/demo database, not
-- just on production (which currently holds zero promotions).

-- 1. The new catalogue.
CREATE TABLE "Company" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "nameKey"      TEXT NOT NULL,
    "eik"          TEXT,
    "websiteUrl"   TEXT,
    "logoUrl"      TEXT,
    "contactName"  TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_nameKey_key" ON "Company"("nameKey");
CREATE INDEX "Company_name_idx" ON "Company"("name");

-- 2. Backfill one Company per DISTINCT normalised supplier name.
--    Normalisation matches `companyNameKey()` in the app layer: lowercase,
--    trim, collapse internal whitespace. Doing it here as well as there is
--    deliberate — the unique index is the real guarantee, and this migration
--    must not depend on application code.
--    Ids are uuids rather than cuids: cuid cannot be generated in SQL, and
--    these are backfilled rows, not app-created ones.
INSERT INTO "Company" ("id", "name", "nameKey", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    -- Keep the first spelling encountered as the display name.
    (array_agg("company" ORDER BY "createdAt"))[1],
    lower(btrim(regexp_replace("company", '\s+', ' ', 'g'))),
    now(),
    now()
FROM "Promotion"
WHERE "company" IS NOT NULL
  AND btrim("company") <> ''
GROUP BY lower(btrim(regexp_replace("company", '\s+', ' ', 'g')));

-- 3. Point every promotion at its supplier.
ALTER TABLE "Promotion" ADD COLUMN "companyId" TEXT;

UPDATE "Promotion" p
SET "companyId" = c."id"
FROM "Company" c
WHERE c."nameKey" = lower(btrim(regexp_replace(p."company", '\s+', ' ', 'g')));

-- Any promotion whose company string was null/blank has no supplier to point
-- at. Rather than fail the migration or invent a company, park them under an
-- explicit placeholder so the NOT NULL below succeeds and support can see and
-- fix them. In practice this matches zero rows (`company` was NOT NULL).
INSERT INTO "Company" ("id", "name", "nameKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Unknown supplier', '__unknown__', now(), now()
WHERE EXISTS (SELECT 1 FROM "Promotion" WHERE "companyId" IS NULL);

UPDATE "Promotion"
SET "companyId" = (SELECT "id" FROM "Company" WHERE "nameKey" = '__unknown__')
WHERE "companyId" IS NULL;

ALTER TABLE "Promotion" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Promotion" DROP COLUMN "company";

ALTER TABLE "Promotion"
    ADD CONSTRAINT "Promotion_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Promotion_companyId_idx" ON "Promotion"("companyId");

-- 4. The editorial gate.
ALTER TABLE "Promotion" ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Existing promotions were LIVE — insert was publish before this column
-- existed. Backfilling them as published preserves current behaviour; leaving
-- them null would silently unpublish every offer in the feed.
UPDATE "Promotion" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;

-- 5. Back the active-window predicate, which was scanning unindexed.
CREATE INDEX "Promotion_validTo_idx" ON "Promotion"("validTo");
