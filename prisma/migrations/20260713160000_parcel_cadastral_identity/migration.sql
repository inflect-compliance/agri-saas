-- Cadastral identity on Parcel (Bulgarian КАИС integration — Phase 1).
--
-- `cadastralId` holds the `EKATTE.masiv.parcel` identifier (e.g.
-- `68134.8360.729`); `ekatte` is its 5-digit settlement prefix (leading zeros
-- are significant, so both are TEXT, never numeric). New imports populate them
-- from the source attributes; this migration BACKFILLS existing rows from
-- `propertiesJson` (the preserved source feature attributes) or `name`.
--
-- The `[tenantId, ekatte]` index backs per-settlement cadastre lookups AND
-- satisfies the schema-index Layer-A guardrail for the new tenant-scoped
-- columns.

ALTER TABLE "Parcel" ADD COLUMN "cadastralId" TEXT;
ALTER TABLE "Parcel" ADD COLUMN "ekatte" TEXT;

-- Backfill `cadastralId` from, in order of trust:
--   1. an explicit identifier column that already holds a full id;
--   2. an EKATTE + masiv + parcel composition;
--   3. an id embedded in the parcel name (pickName may prefix it).
-- The final value is accepted only when it matches the canonical shape
-- (5-digit EKATTE, then ≥2 dot-parts).
UPDATE "Parcel" p
SET "cadastralId" = c.cad
FROM (
    SELECT
        id,
        COALESCE(
            NULLIF(pj->>'CADNUM', ''),
            NULLIF(pj->>'cadnum', ''),
            NULLIF(pj->>'IDENT', ''),
            NULLIF(pj->>'ident', ''),
            NULLIF(pj->>'PIN', ''),
            NULLIF(pj->>'pin', ''),
            NULLIF(pj->>'KI', ''),
            NULLIF(pj->>'ki', ''),
            CASE
                WHEN COALESCE(pj->>'EKATTE', pj->>'ekatte') ~ '^[0-9]{5}$'
                     AND COALESCE(pj->>'MASIV', pj->>'masiv', pj->>'BLOCK', pj->>'block') IS NOT NULL
                     AND COALESCE(pj->>'PARCEL', pj->>'parcel', pj->>'IMOT', pj->>'imot') IS NOT NULL
                THEN COALESCE(pj->>'EKATTE', pj->>'ekatte') || '.'
                     || COALESCE(pj->>'MASIV', pj->>'masiv', pj->>'BLOCK', pj->>'block') || '.'
                     || COALESCE(pj->>'PARCEL', pj->>'parcel', pj->>'IMOT', pj->>'imot')
            END,
            substring("name" from '[0-9]{5}\.[0-9]+(?:\.[0-9]+)+')
        ) AS cad
    FROM "Parcel"
    LEFT JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof("propertiesJson"::jsonb) = 'object'
                    THEN "propertiesJson"::jsonb END AS pj
    ) j ON TRUE
) c
WHERE p.id = c.id
  AND c.cad IS NOT NULL
  AND c.cad ~ '^[0-9]{5}\.[0-9]+(\.[0-9]+)+$';

-- Derive the EKATTE prefix from any backfilled identifier.
UPDATE "Parcel"
SET "ekatte" = substring("cadastralId" from '^[0-9]{5}')
WHERE "cadastralId" IS NOT NULL AND "ekatte" IS NULL;

CREATE INDEX "Parcel_tenantId_ekatte_idx" ON "Parcel"("tenantId", "ekatte");
