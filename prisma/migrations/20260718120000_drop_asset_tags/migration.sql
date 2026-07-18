-- Drop the dead `Asset.tags` column (B5 make-honest).
--
-- `tags` was a reserved free-text column with NO read or write path anywhere
-- in the app — no UI input, no Zod schema field, no usecase reference. It was
-- an orphaned field from the pre-agri compliance era. externalRef was finished
-- (made editable) in the same PR; tags had no realistic near-term use, so it is
-- removed rather than left dangling.
ALTER TABLE "Asset" DROP COLUMN IF EXISTS "tags";
