# 2026-07-02 — БАБХ farm-record data capture (PR 1/3)

**Commit:** `feat(farm-record): capture БАБХ ДНЕВНИК data points (FarmProfile, certs, operationType, product regs)`

## Design

First of a three-PR roadmap that makes the Bulgarian БАБХ *"ДНЕВНИК за
проведените растителнозащитни мероприятия и торене"* (Прил. 1 към заповед
РД 11-3194/31.12.2021) a first-class product surface. **This PR captures data
only — no PDF.** PR 2 generates the filled PDF; PR 3 auto-generates it into a
per-tenant register on task completion.

The document needs data points the schema didn't hold yet. Rather than stuff
them into `attributesJson`, they land as structured columns so the generator
(PR 2) can read them directly and the guardrails keep covering them:

- **FarmProfile** — a one-per-tenant identity block (producer, ЕГН/ЕИК,
  община/населено място, ОД „Земеделие", ОДБХ, ЕКАТТЕ). Singleton config
  modelled on `TenantModuleSettings` (`tenantId @unique`, RLS trio, no
  soft-delete). ЕГН/ЕИК are sensitive identifiers printed on the form →
  registered in the Epic B encrypted-fields manifest (in-place encryption;
  the row is only ever fetched by `tenantId`, never searched, so no
  `contains`/`orderBy` conflict).
- **TenantMembership** gains the plant-protection certificates
  (`applicatorCertNo` чл. 84 ал. 2; `agronomistCertNo` + `agronomistName`
  чл. 84 ал. 1, the latter may name a non-user).
- **Task** gains `operationType FieldOperationType?` (splits SPRAY / химични
  обработки from FERTILIZE / торове rows) + `applicationTechnique` (Техника
  за приложение). `operationType` is set in `createFieldOperation`; a
  `resolveOperationType()` reader derives it from the title prefix for legacy
  rows written before the column existed.
- **Item** gains `quarantinePeriodDays` / `activeIngredient` /
  `pppRegistrationNo`. "Най-ранна дата за прибиране" = `completedAt +
  quarantinePeriodDays`, computed at generation time (PR 2).

**Completion snapshot** — when `markOperationParcel` flips a line to DONE and
an INPUT_APPLICATION LogEntry is minted, the applicator's certificates + the
application technique are frozen into `LogEntry.conditionsJson` *at that
moment*. Auditability: a later certificate renewal (edit on the membership)
must not rewrite the historical record. The PR-2 generator falls back to live
membership values for legacy rows that predate the snapshot.

## Files

| File | Role |
|---|---|
| `prisma/schema/agriculture.prisma` | FarmProfile model + Item regulatory fields |
| `prisma/schema/auth.prisma` | TenantMembership certs + Tenant.farmProfile back-relation |
| `prisma/schema/compliance.prisma` | Task.operationType + applicationTechnique |
| `prisma/migrations/20260702180000_farm_record_data/migration.sql` | DDL + FarmProfile RLS trio |
| `src/lib/security/encrypted-fields.ts` | `FarmProfile: ['egn', 'eik']` manifest entry |
| `src/app-layer/usecases/farm-profile.ts` | get/upsert farm profile |
| `src/app/api/t/[tenantSlug]/admin/farm-profile/route.ts` | GET/PUT (admin.manage) |
| `src/lib/security/route-permissions.ts` | farm-profile permission rule |
| `src/app-layer/usecases/tenant-admin.ts` | `updateMemberCertificates` |
| `src/app/api/t/[tenantSlug]/admin/members/[membershipId]/certificates/route.ts` | PUT (admin.members) |
| `src/app-layer/usecases/field-operation.ts` | persist op type/technique; completion snapshot; `resolveOperationType` |
| `src/app-layer/usecases/catalog.ts` + `items/route.ts` | Item regulatory fields on create |
| `src/lib/schemas/index.ts` | `applicationTechnique` on the field-op create schema |
| admin farm-profile page, members Certificates modal, SprayJobWizard, InventoryClient | capture UI |

## Decisions

- **egn/eik via the Epic B manifest, not PII dual-column.** The PII middleware
  is the usual home for personal identifiers, but these are only ever read by
  `tenantId` (singleton profile, never a lookup key), so the simpler in-place
  manifest encryption fits with zero schema/hash-column overhead — and it's
  what the roadmap prompt specified.
- **Snapshot lives in `markOperationParcel`, not `recordInputApplication`.**
  Keeps the inventory usecase unaware of certificates; the merge preserves any
  pre-existing `conditionsJson` (wind/temp) rather than overwriting.
- **`admin.manage` for farm-profile** (tenant configuration), matching
  `/admin/settings` and `/admin/modules`; certificates reuse the existing
  `/admin/members` permission rule.
- **No backfill migration** for `Task.operationType` — nullable + the
  derive-from-title reader covers legacy rows.
- **Local DB caveat:** the dev/test Postgres here lacks PostGIS, so the ag
  base schema can't materialise locally; the migration DDL was validated
  against a stub DB (enum, FK, unique index, RLS trio all apply). rls-coverage
  + ag integration run against CI's PostGIS DB.
