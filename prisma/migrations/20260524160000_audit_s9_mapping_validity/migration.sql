-- Audit Coherence S9 (2026-05-24) — temporal validity window on
-- RequirementMapping.
--
-- `validFrom` defaults to creation time (existing rows backfill
-- to their `createdAt` via a one-shot UPDATE below). `validTo` is
-- nullable and represents "currently active when null"; the
-- traceability resolver excludes mappings whose `validTo < now()`
-- so historical / superseded mappings don't pollute current
-- gap-analysis reports.

ALTER TABLE "RequirementMapping"
  ADD COLUMN IF NOT EXISTS "validFrom" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "validTo" TIMESTAMP(3);

-- Backfill: existing rows are treated as having always been valid
-- from their creation time, with no expiry yet set. NOT NULL on
-- validFrom is enforced after the backfill.
UPDATE "RequirementMapping"
   SET "validFrom" = COALESCE("validFrom", "createdAt")
 WHERE "validFrom" IS NULL;

ALTER TABLE "RequirementMapping"
  ALTER COLUMN "validFrom" SET NOT NULL,
  ALTER COLUMN "validFrom" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "RequirementMapping_validTo_idx"
  ON "RequirementMapping"("validTo");
