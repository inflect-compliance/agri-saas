-- Phase-7 — agriculture certification schemes layer over the Framework catalog.
-- Adds the AG_SCHEME discriminator to FrameworkKind so ag schemes (Organic,
-- GlobalGAP, LEAF, …) coexist with ISO/NIST frameworks and reuse the whole
-- compliance engine. Enum-value-only change; the unrelated FK / index / column
-- drift that `prisma migrate dev` emitted against the live schema was stripped
-- (pre-existing schema-folder vs migration-history skew, not part of this change).

-- AlterEnum
ALTER TYPE "FrameworkKind" ADD VALUE 'AG_SCHEME';
