-- CadastreOwner — GLOBAL legal-entity ownership cache from КАИС OpenData
-- „собственост ПИ". No tenantId / no RLS (public open data, shared across
-- tenants), keyed by cadastral identifier for read-time parcel hydration.
-- Physical persons are never stored (masked at source; dropped in
-- lib/cadastre/ownership.ts).

-- CreateTable
CREATE TABLE "CadastreOwner" (
    "id" TEXT NOT NULL,
    "cadastralId" TEXT NOT NULL,
    "ekatte" TEXT NOT NULL,
    "eik" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rightType" TEXT NOT NULL DEFAULT '',
    "subjectKind" TEXT,
    "sourceDate" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadastreOwner_pkey" PRIMARY KEY ("id")
);

-- Upsert key: one row per (parcel, legal entity, right type).
CREATE UNIQUE INDEX "CadastreOwner_cadastralId_eik_rightType_key" ON "CadastreOwner"("cadastralId", "eik", "rightType");
-- Read-time parcel-ownership join key.
CREATE INDEX "CadastreOwner_cadastralId_idx" ON "CadastreOwner"("cadastralId");
-- Settlement-scoped refresh / accounting.
CREATE INDEX "CadastreOwner_ekatte_idx" ON "CadastreOwner"("ekatte");
