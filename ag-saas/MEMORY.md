# ag-saas — MEMORY (latest status)

**Repo:** `agri-saas` (the product), built ON the inflect-compliance (IC) chassis.
**Updated:** end of Inventory traceability build.
**Active branch:** `feat/inventory` (pushed; **not yet merged to main**),
branched from `feat/journal`. The feat/journal→feat/inventory line carries the
full ag stack: Feature-1 (spray map), WP-2 module gating, the inventory ledger
(#13), the Field Journal, and now lot traceability. (`feat/phase0-platform` is
a SEPARATE, richer module-gating cut off `main` — see Open follow-ups.)

## Product (1-liner)
Enterprise agriculture-management SaaS on the IC chassis. Moat = a repurposed
compliance/certification engine (audit-ready spray/harvest records;
GlobalG.A.P. / EU-organic / Red Tractor / CAP). Two personas: smallholders →
large grain producers.

## Chassis (kept as-is)
IC = Next 16 / React 19 / Prisma 7 / Postgres-RLS multi-tenancy, hash-chained
audit, BullMQ, Stripe entitlements, S3+ClamAV, SSO, OTel, i18n, guardrail CI.
The compliance domain is **repurposed + module-gated** (NOT deleted).

## Built so far (feature branches; only deps/CodeQL merged to main)
- **Feature 1 — spray-prescription map**: boundaries → parcels on a map →
  assign spray products/dosages → operators execute. `agriculture.prisma`
  (Unit/Item/Location/Parcel/OperationParcel); `src/lib/spatial/parse.ts`;
  `src/lib/db/geo.ts`; migration `…_ag_feature1_spray_map`.
- **Feature-1 follow-ups**: WP-2 module gating (`resolveEnabledModules` +
  `TenantModuleSettings`; defaults enable JOURNAL+INVENTORY), inventory ledger
  + stock-deduction on spray completion (#13), in-map parcel drawing
  (terra-draw), offline operator PWA.
- **Dependency modernization**: production group (37 pkgs), visx 3→4,
  typescript 6, dev-deps. eslint 10 blocked upstream (Next-16 ESLint preset).
- **CodeQL security-and-quality cleanup**: 40 → 0 (FPs dismissed).
- **Phase 0 — module gating** (`feat/phase0-platform`, PUSHED, not merged —
  separate/richer than the WP-2 gating on the feat/journal line).
- **Field Journal** (`feat/journal`, PUSHED, not merged).
- **Inventory traceability** (THIS session, `feat/inventory`, PUSHED, not merged).

## Inventory traceability (this session) — what + where
Goal: a traceability-grade ledger for seeds/fertiliser/pesticide/harvest. The
ledger spine (InventoryLot + append-only hash-chained StockTransaction, single
writer `stock-ledger.ts`, immutability trigger, FEFO consumption, spray→
CONSUMPTION+INPUT_APPLICATION wiring) already shipped in #13 — this build adds
the genealogy + recall layer. Commit `3956535a`.

Schema + migration `20260614194014_inventory_lot_genealogy` (hand-authored,
drift stripped):
- **`LotLink`** — directed, append-only genealogy edge (parentLot consumed/used
  to produce childLot). RLS trio + `IMMUTABLE_LOT_GENEALOGY` trigger + app_user
  privilege revoke (mirrors the ledger). `LotLinkType` (DERIVATION/SPLIT/MERGE).
- `LOW_STOCK` NotificationType. Back-relations on Tenant/User/InventoryLot/LogEntry.

Backend:
- `stock-ledger.ts` += **`appendLotLink`** (the SECOND table written only here,
  idempotent + self-edge-rejecting). `no-direct-stock-writes` guard extended to
  cover LotLink.
- `inventory.ts` += **`recordHarvestLot`** (HARVEST LogEntry → HARVEST_IN lot +
  DERIVATION edges from input lots consumed on the field; INVENTORY-gated, runs
  in the journal create txn via `journal.createLogEntry`) and **`traceLot`**
  (bidirectional N+1-safe BFS over LotLink, fields annotated).
- `InventoryRepository.ts` += batched genealogy/harvest queries.
- `CreateLogEntrySchema` += optional `harvest` payload.
- API: `GET …/inventory/lots/[lotId]/trace`.
- **`low-stock-monitor`** BullMQ job (daily 09:00, cross-tenant Σ-on-hand vs
  `Item.reorderLevel` → LOW_STOCK alerts to OWNER/ADMIN, deduped per
  item/recipient/day). Wired into types/executor-registry/schedules/JOB_DEFAULTS.
- `scripts/verify-stock-chain.ts` + `npm run verify:stock-chain` (twin of
  verify-audit-chain.ts).

UI: lot **Traceability** view on the inventory lot detail (InventoryClient;
secondary "Show genealogy" toggle, lazy trace fetch) + optional **Harvest
output** form on HARVEST journal entries (JournalEntryModal).

**Verified:** tsc 0; inventory-traceability (5) + inventory-ledger (4)
integration green; low-stock unit + journal regression green; rls-coverage,
schema-index-coverage, no-direct-stock-writes, query-shape,
audit-structured-events, contract-drift, infrastructure-guards (job count
20→21), + 8 design-system ratchets green (no baseline bumps — the trace toggle
is a secondary button).

## Field Journal (prior session) — what + where
The daily logbook (`feat/journal`, commit `577d2149`; schema `7eec3dca`). farmOS
Log/Quantity ontology reimplemented; HortusFox photo-log UX; Ekylibre cost
concept. `LogEntry` (type ACTIVITY/OBSERVATION/INPUT_APPLICATION/SEEDING/
TRANSPLANTING/HARVEST/IRRIGATION/MAINTENANCE/LAB_TEST/GRAZING, status
PLANNED/DONE) + `LogQuantity` + `Equipment`/`LogLocation`/`LogEquipment`/
`LogEntryFile` (migration `20260614180352`, RLS trio on the 4 tenant tables).
Usecase `journal.ts` (CRUD + soft-delete + photos), routes under
`…/journal/`, UI (EntityListPage list + EntityDetailLayout detail: Details/
Quantities/Photos + TipTap modal). `swr-keys` += journal; SidebarNav += Journal.

## Dev DB (native PostGIS — Docker registry may be blocked)
PostgreSQL 16 + `postgresql-16-postgis-3`; cluster `16/main`.
- Start: `sudo pg_ctlcluster 16 main start` (goes **down on container idle** —
  just restart it).
- db `inflect_compliance` + role `app_user` + `CREATE EXTENSION postgis`.
- **Prisma 7 gotcha:** CLI does NOT auto-load `.env` →
  `set -a && . ./.env && set +a && npx prisma <cmd>`.
- `psql` gotcha: strip Prisma's `?schema=public` → `${DATABASE_URL%%\?*}`.
- **Test gotcha:** the dev env has **no Redis** → BullMQ floods jest logs with
  `ECONNREFUSED 6379` and holds the process open. Integration suites that touch
  queue-emitting usecases need `--forceExit`. `npx jest <path>` (NOT
  `--selectProjects node <path>`, which ignores path filters and runs the whole
  project).
- Validate: `prisma migrate deploy`; `prisma generate`; `tsc --noEmit` (0).

## House rules (non-negotiable)
- New tenant-scoped table (`tenantId`) ⇒ RLS trio (`tenant_isolation` +
  `tenant_isolation_insert` + `superuser_bypass` + `FORCE`) in its migration, or
  `rls-coverage` fails. Global catalogs (no `tenantId`, e.g. `Unit`) get none.
- Append-only ledgers (StockTransaction, LotLink) write ONLY through
  `src/lib/inventory/stock-ledger.ts`; DB immutability trigger + the
  `no-direct-stock-writes` guard enforce it.
- Reuse IC patterns; the **Assets module** is the end-to-end template
  (usecase→repo→Zod→DTO→route→ListPageShell/EntityDetailLayout).
- Client data via `useTenantSWR`/`useTenantMutation` + `makeResource()`.
- `logEvent` on every state change (structured `detailsJson`); audit guard.
- Sanitize on write: `sanitizePlainText` / `sanitizeRichTextHtml`.
- All `ST_*` SQL in `src/lib/db/geo.ts`; `shpjs` needs `globalThis.self`.
- Migrations: `prisma migrate dev --create-only` → hand-edit (drop unrelated
  drift + add RLS/triggers) → `prisma migrate deploy`.
- New BullMQ job ⇒ wire ALL of types(JobPayloadMap+JOB_DEFAULTS) +
  executor-registry + schedules, and bump the count in
  `tests/regression/infrastructure-guards.test.ts`.
- **LICENSE:** never copy GPL/AGPL (farmOS, LiteFarm, ERPNext, Ekylibre,
  Nekazari-core) — concept only. Port MIT/Apache/BSD/CC0 (InvenTree, HortusFox,
  OFBiz, …) with attribution in **`THIRD_PARTY_NOTICES.md`** (CREATED this
  session — append a credited entry on each new port).

## Next (MVP core — expected build prompts)
Locations/Fields on the map · ~~Farm Journal~~ ✓ · ~~Inventory/traceability~~ ✓
(ledger + lots + genealogy + low-stock done; a richer InvenTree-style stock
list UI is still open) · Ag Tasks · Weather feed · Onboarding + simple-mode +
PWA field entry · Certification module (the gated GRC surface, returns later).

## Open follow-ups / deferrals
- **Branch topology:** the ag work lives on a `feat/spray-map → … → feat/journal
  → feat/inventory` stack (each PUSHED, none merged). `feat/phase0-platform` is a
  PARALLEL module-gating cut off `main`. Integration/merge order + which gating
  wins (WP-2 on the stack vs Phase-0) is an open decision; open PRs when ready.
- **Harvest form has no parcel picker** — there is no tenant-wide `/parcels`
  endpoint (parcels are nested under `locations/[id]/parcels`). The `harvest`
  payload's `parcelId` (which drives DERIVATION genealogy) is therefore not set
  from the UI yet; genealogy still works via API/automation. Add a parcels
  endpoint + picker to close the loop.
- **LotLink SPLIT/MERGE + bin→bin TRANSFER + unit conversion** deferred (only
  DERIVATION on harvest is wired).
- **Equipment** still has no standalone CRUD UI (model + journal link target only).
- **Vocabulary pass deferred** (nav brand hardcoded; bg.json i18n parity).
- Nav module resolution uses a raw prisma read (dev-superuser correct; prod
  `app_user` falls back to `DEFAULT_MODULES` — page/API gates stay RLS-correct).
