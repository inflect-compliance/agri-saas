# ag-saas — MEMORY (latest status)

**Repo:** `agri-saas` (the product), built ON the inflect-compliance (IC) chassis.
**Updated:** end of Field Journal build.
**Active branch:** `feat/journal` (pushed; **not yet merged to main**).
Branched from `main` (pre-Phase-0) → it does **not** carry the module-gating;
`feat/journal` and `feat/phase0-platform` are parallel branches to be
integrated later (see Open follow-ups for the topology).

## Product (1-liner)
Enterprise agriculture-management SaaS on the IC chassis. Moat = a repurposed
compliance/certification engine (audit-ready spray/harvest records;
GlobalG.A.P. / EU-organic / Red Tractor / CAP). Two personas: smallholders →
large grain producers.

## Chassis (kept as-is)
IC = Next 16 / React 19 / Prisma 7 / Postgres-RLS multi-tenancy, hash-chained
audit, BullMQ, Stripe entitlements, S3+ClamAV, SSO, OTel, i18n, guardrail CI.
The compliance domain is **repurposed + module-gated** (NOT deleted).

## Built so far (each on its own feature branch; only deps/CodeQL merged to main)
- **Feature 1 — spray-prescription map**: upload boundaries → parcels on a map →
  assign spray products/dosages → operators execute. `agriculture.prisma`
  (Unit/Item/Location/Parcel/OperationParcel); `src/lib/spatial/parse.ts`;
  `src/lib/db/geo.ts`; migration `…_ag_feature1_spray_map`.
- **Feature-1 follow-ups**: module-gating scaffold, inventory ledger +
  stock-deduction, in-map parcel drawing (terra-draw), offline operator PWA.
- **Dependency modernization**: production group (37 pkgs), visx 3→4,
  typescript 6, dev-deps. eslint 10 blocked upstream (Next-16 ESLint preset).
- **CodeQL security-and-quality cleanup**: 40 → 0 (FPs dismissed). Secret-scan
  alerts were test fixtures (excluded via `.github/secret_scanning.yml`).
- **Phase 0 — module gating** (`feat/phase0-platform`, PUSHED, not merged).
- **Field Journal** (THIS session, `feat/journal`, PUSHED, not merged).

## Field Journal (this session) — what + where
The daily logbook: activities, observations, inputs, harvests. farmOS
Log/Quantity ontology **reimplemented** (concept only — no GPL code copied);
HortusFox photo-log UX; Ekylibre intervention-cost concept (`costAmount`).

Schema (`prisma/schema/journal.prisma`; commit `7eec3dca`):
- `LogEntry` — `type` (ACTIVITY | OBSERVATION | INPUT | HARVEST), `occurredAt`,
  `status` (PLANNED | DONE), `title`, `notes` (TipTap HTML), optional
  `costAmount Decimal(14,2)` / `costCurrency`, soft-delete trio.
- `LogQuantity` — measured/applied/harvested amounts (value + Unit + label).
- 4 new models: **`Equipment`** (generalized from the IC Asset concept —
  name/category/make/model/serial/year/meter; soft-delete trio;
  `@@unique([id, tenantId])`), **`LogLocation`** (LogEntry ↔ Feature-1
  `Location`, composite FKs, `@@unique([logEntryId, locationId])`),
  **`LogEquipment`** (LogEntry ↔ Equipment), **`LogEntryFile`** (LogEntry ↔
  `FileRecord`, optional `caption`).
- Migration `20260614180352_journal_full_field_record`: LogEntry ALTER +
  CREATE for the 4 tables + indexes + FKs + **RLS trio** on the 4
  tenant-scoped tables (Equipment/LogLocation/LogEquipment/LogEntryFile).
  Hand-stripped from `migrate dev --create-only` per the house rule (dropped
  unrelated drift; kept journal-only + RLS).

Backend (commit `577d2149`):
- `src/app-layer/usecases/journal.ts` — list/paginated, get, create, update,
  soft-delete, restore, purge, uploadPhoto, attach/detach file. `title` →
  `sanitizePlainText`, `notes` → `sanitizeRichTextHtml`;
  assertCanRead/Write/Admin; `logEvent` on every mutation; all DB work inside
  `runInTenantContext`.
- `src/app-layer/repositories/JournalRepository.ts` — tenant-scoped queries,
  soft-delete lifecycle, tenant-scoped link validation (locations/equipment/files).
- `src/lib/schemas/index.ts` — Create/UpdateLogEntrySchema, AttachLogEntryFileSchema.

API: `src/app/api/t/[tenantSlug]/journal/` — `route.ts` (GET/POST),
`[id]/route.ts` (GET/PATCH/DELETE), `[id]/restore`, `[id]/purge`, `[id]/files`.

UI: `src/app/t/[tenantSlug]/(app)/journal/` — `JournalClient.tsx`
(`EntityListPage` list + `filter-defs.ts`), `[id]/page.tsx`
(`EntityDetailLayout`, tabs Details / Quantities / Photos), `JournalPhotosTab.tsx`,
TipTap `JournalEntryModal.tsx`. `swr-keys` += `journal: makeResource('journal')`;
`SidebarNav` += Journal item (NotebookPen).

Tests + ratchets: `tests/unit/journal.test.ts` (23). Six guard registrations
(ux-foundation, primary-secondary-ratio, no-lucide, entity-detail-shell-coverage,
csp-script-guardrails, schema-index-coverage) + two **documented** baseline
bumps — `MAX_PRIMARY_COUNT` 132 → 134 (list "Entry" CTA + modal confirm),
`CONFIRM_CALL_CEILING` 18 → 19 (JournalEntryModal). schema-index-coverage gets
Equipment.createdByUserId (R_ACTOR), LogEntryFile.fileRecordId
(R_CHILD_VIA_PARENT) + LogEntry/Equipment triage entries.

**Verified:** tsc 0; 333 tests green across the touched suites
(journal unit + rls-coverage + schema-index-coverage + audit-structured-events
+ the six ratchets); pre-commit secret scan clean.

## Dev DB (native PostGIS — Docker registry may be blocked)
PostgreSQL 16 + `postgresql-16-postgis-3` installed; cluster `16/main`.
- Start: `sudo pg_ctlcluster 16 main start` (it can go **down on container idle**
  — just restart it).
- db `inflect_compliance` + role `app_user` + `CREATE EXTENSION postgis`.
- `.env` `DATABASE_URL` / `DIRECT_DATABASE_URL` → `127.0.0.1:5432` (postgres
  superuser in dev; RLS bypassed in dev, enforced via `runInTenantContext`).
- **Prisma 7 gotcha:** CLI does NOT auto-load `.env` →
  `set -a && . ./.env && set +a && npx prisma <cmd>`.
- `psql` gotcha: strip Prisma's `?schema=public` → `${DATABASE_URL%%\?*}`.
- Validate: `prisma migrate deploy`; `prisma generate`; `tsc --noEmit` (0).

## House rules (non-negotiable)
- New tenant-scoped table (`tenantId`) ⇒ RLS trio (`tenant_isolation` +
  `tenant_isolation_insert` + `superuser_bypass` + `FORCE`) in its migration, or
  `rls-coverage` fails. Global catalogs (no `tenantId`, e.g. `Unit`) get none.
- Reuse IC patterns; the **Assets module** (`usecases/asset.ts`,
  `app/api/t/[tenantSlug]/assets/`, `app/t/[tenantSlug]/(app)/assets/`) is the
  end-to-end template (usecase→repo→Zod→DTO→route→ListPageShell/EntityDetailLayout).
- Client data via `useTenantSWR`/`useTenantMutation` + `makeResource()`
  (`src/lib/swr-keys.ts`).
- `logEvent` (`app-layer/events/audit.ts`) on every state change; audit-event guardrail.
- Sanitize on write: plain fields → `sanitizePlainText`, rich text →
  `sanitizeRichTextHtml` (`src/lib/security/sanitize.ts`).
- All `ST_*` SQL stays in `src/lib/db/geo.ts`; `shpjs` needs
  `globalThis.self = globalThis` server-side (see `parse.ts`).
- Migrations: `prisma migrate dev --create-only` → hand-edit (drop unrelated
  drift + add RLS) → `prisma migrate deploy`.
- **LICENSE:** never copy GPL/AGPL (farmOS, LiteFarm, ERPNext, Ekylibre,
  Nekazari-core) — concept only. Port MIT/Apache/BSD/CC0 (InvenTree, HortusFox,
  OFBiz, Tania, MapLibre/terra-draw/shpjs/togeojson, OpenFarm) with attribution
  in `THIRD_PARTY_NOTICES.md` (NOT yet created — make on first port).

## Next (MVP core — expected build prompts)
Locations/Fields on the map · ~~Farm Journal~~ (DONE) · Ag Tasks · Basic
Inventory (InvenTree UI on the existing ledger) · Weather feed · Onboarding +
simple-mode + PWA field entry.

## Open follow-ups / deferrals
- **Branch topology:** `feat/journal` was cut from `main`, NOT from
  `feat/phase0-platform` → it has no module-gating. When integrating, decide
  whether the journal lives under an ag module and wire the gate at merge time.
  Both branches are pushed, neither merged; open PRs when ready.
- **Equipment has no standalone CRUD UI yet** — it exists as a model + journal
  link target only. A dedicated Equipment list/detail page (Assets template) is
  a follow-up if/when equipment management is a prompt.
- **Vocabulary pass deferred** (nav brand is a hardcoded string, not
  `common.appName`; bg.json i18n-parity guardrail — defer with the Prisma model
  renames).
- API gating (Phase 0) is per **entry route** (12 list endpoints); sub-routes
  rely on the page + nav gates. Exhaustive sub-route API gating is a follow-up.
- Nav module resolution uses a raw prisma read (RLS-correct under dev superuser;
  under prod `app_user` falls back to `DEFAULT_MODULES` — page/API gates stay
  RLS-correct via `runInTenantContext`). Revisit for prod nav fidelity.
- `THIRD_PARTY_NOTICES.md` to be created on first MIT/Apache/BSD/CC0 port.
