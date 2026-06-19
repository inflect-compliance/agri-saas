# ag-saas — MEMORY (latest status)

**Repo:** `agri-saas` (the product), built ON the inflect-compliance (IC) chassis.
**Updated:** end of the Integration capstone — **MVP feature-complete**.
**Active branch:** `feat/integration` (pushed; **not yet merged to main**),
branched from `feat/knowledge-base`. The
feat/journal→inventory→farm-tasks→knowledge-base→integration line carries the
full ag stack: Feature-1 (spray map), WP-2 module gating, the inventory ledger
(#13), the Field Journal, lot traceability, farm tasks, the Knowledge Base, and
the two-persona integration. (`feat/phase0-platform` is a SEPARATE, richer
module-gating cut off `main` — see Open follow-ups.)

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
- **Inventory traceability** (`feat/inventory`, PUSHED, not merged).
- **Farm Tasks** (`feat/farm-tasks`, PUSHED, not merged).
- **Knowledge Base** (`feat/knowledge-base`, PUSHED, not merged).
- **Integration capstone** (THIS session, `feat/integration`, PUSHED, not merged)
  — two personas, one product.

## Integration capstone (this session) — what + where
Goal: one coherent product for a startup farmer AND a large grain producer.
Achieved almost entirely by WIRING existing systems. Commits `9f93099c`
(backend + seed) + `82444136` (ag dashboard strip).

- **Simple mode vs enterprise** = the existing module gating, no new flag.
  `SIMPLE_MODE_MODULES` (src/lib/modules.ts) = [JOURNAL, INVENTORY, PLANNING];
  `isSimpleMode()`. A startup tenant saves that curated `enabledModules` list →
  `useNavSections` hides everything else. Enterprise keeps ALL modules + an
  Organization of child farms.
- **Entitlements re-keyed** (src/lib/billing/entitlements.ts): `GatedResource +=
  user, location` (FREE 3/5, PRO/TRIAL 25/50, ENTERPRISE unlimited);
  `assertWithinLimit` wired at `createLocation` + `createInviteToken`. Caps bite
  in SAAS mode; self-hosted/dev resolves to ENTERPRISE (unlimited).
- **Persona onboarding** (src/lib/onboarding-steps.ts): ag-focused Driver.js
  tour. `filterStepsForCurrentPage` drops absent-nav steps, so ONE set adapts
  per persona automatically; `getTourStepsForPersona()` is the explicit selector.
- **Dual-persona demo seed** (`scripts/seed-demo.ts`, `npm run seed:demo`): a
  Green Acres startup farm (simple mode, FREE) + a BigFarm Co Organization with
  3 child farms (enterprise, hub-and-spoke), each with location / lot+ledger /
  journal / farm task / 6 CC0 guides, plus an org admin (`admin@bigfarm.demo`)
  provisioned across the farms. Idempotent; **uses direct prisma for task +
  journal** (seed convention — the createTask BullMQ enqueue hangs without
  Redis) and force-exits.
- **Ag dashboard strip** (src/app/.../dashboard/AgDashboardStrip + 3 cards +
  `/dashboard/ag` route + `getAgDashboard` usecase): recent journal / low stock
  / my farm tasks, gated by the enabledModules the payload carries; renders
  nothing for a pure-GRC tenant. The configurable react-grid-layout widget
  system stays at the ORG level (the enterprise portfolio).

**Verified:** tsc 0; demo seed runs clean (both personas, DB-verified data);
billing/entitlements + modules + onboarding + invite + control-mutations suites
green; structural guardrails green (codebase-hygiene meta-ratchet, module-gate,
rls-coverage, no-secrets, no-explicit-any, …) + 12 design-system ratchets for
the dashboard strip. Manual verification log in
`docs/implementation-notes/2026-06-14-integration-capstone.md`.

## Knowledge Base (this session) — what + where
Goal: versioned SOPs + growing guides workers READ and ACKNOWLEDGE — by
**repurposing IC's Policy machinery**. Commits `4ddce966` (backend) + `bf302f86`
(UI). `KnowledgeArticle` / `KnowledgeArticleVersion` / `KnowledgeAcknowledgement`
mirror `Policy` / `PolicyVersion` / `PolicyAcknowledgement`; the usecases mirror
`createPolicy` / `createPolicyVersion` / `publishPolicy` / `attestPolicy`.

- Schema (migration `20260614211943`, hand-stripped): the 3 models, ALL carrying
  `tenantId` → direct-RLS trio (Policy's ack table is ownership-chained).
  `KnowledgeArticleStatus` (DRAFT/PUBLISHED/ARCHIVED) + `KnowledgeContentType`
  (HTML/MARKDOWN).
- `usecases/knowledge.ts` — simpler lifecycle than Policy (NO IN_REVIEW/APPROVED
  gate, no SharePoint/templates/PDF): create (slug loop + v1), version
  (auto-increment + PUBLISHED→DRAFT rollback), publish, archive, list/get +
  listCategories, and acknowledge (idempotent on [version, user]) +
  listAcknowledgements. Content sanitised on write (HTML→sanitizeRichTextHtml,
  MARKDOWN→sanitizePlainText). Repos mirror Policy{,Version}Repository.
- Search: a `knowledge` SearchHitType + `db.knowledgeArticle.findMany` branch +
  hit builder + SEARCH_TYPE_DEFAULTS / rank / filter / recents / command-palette
  (BookOpen heading) registrations. `search-palette-migration` guard updated.
- Seed: `scripts/import-knowledge.ts` (`npm run import:knowledge`) — 6 CC0
  OpenFarm-modelled growing guides as PUBLISHED articles, idempotent on
  (tenantId, slug), `source="OpenFarm (CC0)"`.
- UI: knowledge list (EntityListPage) + detail (EntityDetailLayout) mirroring the
  Policy UI — version-content render via sanitizeRichTextHtml +
  dangerouslySetInnerHTML, version history + admin Publish, TipTap new-version
  editor, Acknowledge affordance (PUBLISHED-only), admin Archive; SidebarNav +=
  Knowledge.

**Verified:** tsc 0; knowledge integration (lifecycle + sanitize-on-write +
search discovery) + rls-coverage (3 RLS tables) + schema-index/query-shape/
audit-structured/module-gate/api-permission/async-params/contract-drift + 17
design-system ratchets green (MAX_PRIMARY_COUNT 136→141, CONFIRM_CALL_CEILING
19→20, both documented). Also fixed two PRE-EXISTING ratchet failures the sweep
surfaced in earlier ag UI (inventory raw `<h4>`→`<Eyebrow>`; farm-tasks
primary-action-budget entry).

## Farm Tasks (this session) — what + where
Goal: assignable farm work tied to places/crops/equipment, with a calendar —
built ON the IC Task module, **reused unchanged**. The realisation: almost
everything already existed, so this is a thin orchestration + two enum
widenings, not a new module. Commits `cf7fa0a0` (backend) + `7112bab4` (UI).

Why it was lean (all pre-existing): `TaskMetadataJsonSchema` is a free-form
`z.record` (catalog type/category ride in `Task.metadataJson`, no schema
change); `TaskFilters` already has type/assignee filters (operator queue =
`listTasks` reuse); `loadTaskEvents` already sweeps every Task with a `dueAt`
(calendar shows farm tasks with NO change); Feature-1 added LOCATION/PARCEL to
`TaskLinkEntityType` and `addTaskLink` takes a plain string (Equipment link =
enum-only); create-with-assignee already fires `TASK_ASSIGNED`.

- Schema (migration `20260614210000`, enum-only → no table → no RLS):
  `WorkItemType += FARM_TASK` (the queryable "is farm work" discriminator,
  distinct from Feature-1's `FIELD_OPERATION` spray job); `TaskLinkEntityType
  += EQUIPMENT, PLANTING` (PLANTING reserved for a future crop-planting model).
- `src/lib/agriculture/farm-task-types.ts` — the LiteFarm task-type catalog
  (28 types × 11 categories; names/categories only — LiteFarm is GPL,
  reimplemented + attributed) + `getFarmTaskType`/`isFarmTaskType`.
- `usecases/farm-task.ts` — `createFarmTask` (validate type + link ownership
  BEFORE create → reuse `createTask`/`addTaskLink`; type/category in
  `metadataJson`) + `listMyFarmTasks` (operator queue: FARM_TASK ∪
  FIELD_OPERATION assigned to me, soonest-due first, via `listTasks`).
- `usecases/equipment.ts` + `JournalRepository.listEquipment`/`validParcelIds`
  (equipment picker + parcel link validation; reuses `validLocationIds`/
  `validEquipmentIds`).
- API: `POST/GET /farm-tasks`, `GET /equipment`. UI: farm-tasks operator-queue
  page (EntityListPage) + create modal (catalog picker + Location/Equipment
  links + assignee); SidebarNav += Farm Tasks.

**Verified:** tsc 0; farm-task-types unit (4) + farm-task integration (5: real
Task/TaskLink reuse, metadata, calendar inclusion, foreign-tenant link
rejection, unknown-type rejection); schema-index/query-shape/module-gate/
api-permission/async-params/contract-drift + 10 design-system ratchets green
(primary-secondary-ratio 134→136, documented).

## Inventory traceability (prior session) — what + where
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

## Next (MVP feature-complete — what remains)
The MVP loop is done: ~~Farm Journal~~ ✓ · ~~Inventory/traceability~~ ✓ ·
~~Ag Tasks~~ ✓ · ~~Knowledge Base~~ ✓ · ~~Onboarding + simple-mode + dual-persona
integration~~ ✓. **The #1 next step is INTEGRATION/MERGE** — collapse the 7-branch
stack into `main` and decide WP-2-vs-Phase-0 gating (see Open follow-ups).
Remaining feature ideas: Weather feed · richer InvenTree-style stock list UI ·
PWA field-entry polish · Plantings/crops (the reserved `PLANTING` TaskLink target
+ harvest provenance) · Certification module surfacing (the gated GRC surface for
certified producers).

## Open follow-ups / deferrals
- **Branch topology (THE big one):** the ag work is a 7-branch stack —
  `feat/journal → inventory → farm-tasks → knowledge-base → integration` (plus
  the earlier spray-map / module-gating / parcel-drawing / offline branches),
  each PUSHED, NONE merged to `main`. `feat/phase0-platform` is a PARALLEL,
  richer module-gating cut off `main`. **Integration/merge order + which gating
  wins (the WP-2 gating on this stack vs Phase-0's plan∧tenant resolution) is the
  #1 open decision.** Open PRs + collapse to `main` when ready.
- **Demo seed needs Redis-free usecases:** `seed-demo.ts` uses direct prisma for
  the task + journal entry because `createTask`'s BullMQ assignment-notification
  enqueue hangs without Redis. If the seed should exercise those usecases, run a
  local Redis (docker-compose) or add an enqueue kill-switch env.
- **Ag dashboard is hardcoded cards, gated by modules** (not a tenant-level
  react-grid-layout widget system). For a pure-ag (simple-mode) tenant the
  existing GRC cards below the ag strip render empty — a follow-up should hide
  the GRC grid when CERTIFICATION/RISK modules are off. The configurable RGL
  widget system lives at the ORG level (enterprise portfolio).
- **Harvest form has no parcel picker** — there is no tenant-wide `/parcels`
  endpoint (parcels are nested under `locations/[id]/parcels`). The `harvest`
  payload's `parcelId` (which drives DERIVATION genealogy) is therefore not set
  from the UI yet; genealogy still works via API/automation. Add a parcels
  endpoint + picker to close the loop.
- **LotLink SPLIT/MERGE + bin→bin TRANSFER + unit conversion** deferred (only
  DERIVATION on harvest is wired).
- **Farm-task UI gaps:** (a) the operator-queue list shows the WorkItemType,
  not the LiteFarm catalog name — the shared `taskListSelect` doesn't return
  `metadataJson` (Task module reused unchanged); widen the select or do a
  per-task metadata read to light up the catalog name in the list. (b) The
  create modal omits the parcel picker — `/locations/{id}/parcels` returns a
  GeoJSON envelope, not a flat list; the API's `parcelIds` is wired + validated
  but unset from the UI (Location + Equipment links cover the common case).
- **`PLANTING` TaskLink value is reserved** — there is no Planting/crop model
  yet; wire it when plantings land.
- **Equipment** still has no standalone CRUD UI (model + `GET /equipment` list +
  journal/farm-task link target only; the Assets-template page is a follow-up).
- **Knowledge Base parity gaps:** no approval gate (publish is admin-direct, by
  design — knowledge ≠ controlled compliance doc); no SharePoint sync /
  templates / PDF export (Policy has these; out of scope). The seed embeds CC0
  guides rather than calling the OpenFarm/Growstuff API at seed time.
- **PROCESS LESSON (UI subagents):** the inventory + farm-tasks UI builds didn't
  run `typography-eradication` / `heading-primitive-discipline` /
  `primary-action-budget` in their ratchet sweeps, so a raw `<h4>` (inventory)
  and a missing primary-budget entry (farm-tasks) slipped through and only
  surfaced during the knowledge sweep (now fixed). **Future UI delegations must
  run the FULL design-system ratchet set**, not just the obvious ones.
- **Vocabulary pass deferred** (nav brand hardcoded; bg.json i18n parity).
- Nav module resolution uses a raw prisma read (dev-superuser correct; prod
  `app_user` falls back to `DEFAULT_MODULES` — page/API gates stay RLS-correct).

---

## Phase 7 — Certification Reseat (feat/certification-reseat)

Turned the (now CERTIFICATION-gated) IC compliance domain back ON as ag
"Certification" — minimal schema, mostly vocabulary + a thin scheme layer.

- **`AG_SCHEME` is just a `FrameworkKind` value.** A "certification scheme" =
  a GLOBAL `Framework` row (no tenantId) with `kind='AG_SCHEME'`; requirements
  are ordinary `FrameworkRequirement` rows. The whole compliance engine
  (control↔requirement mapping, readiness scoring, coverage) works against
  AG_SCHEME rows verbatim. `certification-scheme.ts` is a thin kind-filtered
  facade — no new tenant-scoped tables, no new link endpoints.
- **Scheme creation is admin-gated + GLOBAL.** Because Framework is a shared
  catalog, `createScheme` writes a global row (assertCanAdmin). A tenant-private
  scheme would need a tenant-scoped Framework (deferred) — today schemes are
  shared like ISO frameworks (fine for industry standards: Organic/GLOBALG.A.P.).
- **Vocabulary reseat is messages/en.json VALUES only** (keys unchanged, so the
  i18n-completeness guardrail — which checks key presence — stays green). Global
  reseat: every tenant (incl. the inherited GRC demo) sees Practice/Records/
  Inspection/Nonconformity/Scheme. `nav.controls`→Practice, `nav.evidence`→
  Records, `nav.audits`→Inspection, `nav.findings`→Nonconformities,
  `nav.mapping`→Scheme Mapping + the matching `*.title` keys. Risk/Policy/
  Vendor/Process left as-is (not in the prompt's map). SidebarNav literals
  Control→Practice, Audit→Inspection + a new Schemes nav item (reused
  ClipboardCheck — no new lucide import).
- **E2E label churn from the reseat:** only the `#frameworks-heading` text
  ("Compliance Frameworks"→"Certification Schemes") broke specs —
  `frameworks.spec.ts` + `reporting.spec.ts` updated. Nav E2E uses
  `data-testid="nav-<slug>"` (structural), so the nav label swaps didn't break
  navigation specs. bg.json values keep the old GRC terms (translation debt).
- **Three ratchet ceilings bumped (documented up-increments):** design-drift
  118→120 (schemes page+client), primary-secondary-ratio 141→143 (Scheme header
  primary + create-modal submit), ux-foundation CONFIRM 20→21 (NewSchemeModal
  unsaved-changes window.confirm, same as NewPolicyModal/NewArticleModal).

### Remaining gaps (Phase 7)
- **No tenant-private schemes** — all schemes are global catalog rows. A tenant
  authoring a truly custom scheme would expose it to all tenants. Add a
  tenant-scoped scheme layer (or a Framework.tenantId nullable + filter) when
  per-tenant custom schemes are needed.
- **Scheme requirements are create-only via the modal** — no edit/reorder/delete
  of requirements after creation (reuse the existing framework reorder/tree
  surface to close this).
- **Readiness on the dashboard card uses the top scheme only** (first AG_SCHEME
  by key) — a multi-scheme tenant sees one. A scheme picker is a follow-up.
- **`generateReadinessReport` weights** still use the ISO/NIS2 tables; an
  ag-scheme-specific weight profile (`AG_SCHEME_WEIGHTS`) was NOT added —
  schemes score on the default coverage/evidence/tasks dimensions.
- **LiteFarm organic-cert EXPORT** (the ⚖️ borrow) not built — only the scheme
  authoring + readiness. The export (a certifier-ready PDF/CSV of records
  against requirements) is a follow-up; the readiness report export
  (`exportReadinessReport`) is the nearest existing primitive to reuse.

---

## Phase 8 — Certification real: seeded schemes + farm data as evidence (feat/certification-schemes)

Made certification operational: scheme catalogs as data, farm journal records
auto-flowing in as evidence, inspection-pack assembly + applicability-statement export.

- **Scheme catalogs are concept-only YAML** under `prisma/catalogs/`
  (`globalgap-ifa-demo.yaml`, `eu-organic-2018-848-demo.yaml`), `kind: AG_SCHEME`,
  imported via `scripts/import-schemes.ts` (`npm run schemes:import`) reusing
  `loadAndValidateCatalogFile` + `applyCatalogFile`. LICENSE: paraphrased generic
  control points + illustrative analogue codes, explicitly marked "not the
  official checklist / not verbatim article text". `catalog-loader.ts`'s zod
  `FRAMEWORK_KINDS` enum needed `AG_SCHEME` added (predated Phase 7).
- **Auto-evidence** (`src/app-layer/usecases/auto-evidence.ts`):
  `attachAutoEvidenceFromLogEntry(db, ctx, logEntryId)` walks LogEntry →
  `AUTO_EVIDENCE_RULES[type]` → scheme requirements → tenant Controls
  (`ControlRequirementLink`) → mints one `Evidence` per control, back-referenced
  via the new `Evidence.sourceLogEntryId` scalar FK (idempotency key). Status =
  **SUBMITTED** (auto-collected, human-approved through the existing
  `reviewEvidence` pipeline — nothing unreviewed inflates readiness). Runs
  IN the caller's tenant tx at `db` level (NOT via `createEvidence`, which opens
  its own `runInTenantContext` — Prisma tx can't nest). Hooked in
  `field-operation.ts::markOperationParcel` (after `recordInputApplication`) +
  `journal.ts::createLogEntry` (INPUT_APPLICATION). **Natural gate**: a tenant
  without the scheme pack installed has no mapped control → silent no-op (no
  module check needed). INPUT_APPLICATION → GlobalG.A.P. CB.7.1/7.6/7.9 +
  EU-Organic EUO.2/3.
- **Inspection pack** (`scheme-pack.ts::assembleSchemePack`): reuses
  `createAuditPack`(needs an `auditCycleId`) + `addAuditPackItems`
  (FRAMEWORK_COVERAGE + one EVIDENCE item per APPROVED scheme evidence);
  freeze + share REUSE the existing `freezeAuditPack` + `generateShareLink`
  (`AuditPackShare`/`tokenHash`) endpoints — no sharing rebuilt.
- **Applicability statement = SoA**: `getSoA` gained a `frameworkKey?` option
  (pins to a scheme, bypasses auto-detect); new
  `/api/t/:slug/schemes/:schemeKey/applicability.csv` route reuses the extracted
  `src/lib/reports/soa-csv.ts::buildSoACsv` (the existing `reports/soa/export.csv`
  route was refactored onto it). PDF export deferred (CSV is the deliverable).
- **Evidence↔control bridge**: auto-evidence mirrors `createEvidence`'s
  `ControlEvidenceLink` creation (try/catch tolerates the dup-link race).

### Remaining gaps (Phase 8)
- **No tenant-private scheme controls without pack install** — auto-evidence
  only fires once a tenant installs the scheme's pack (controls mapped to
  requirements). A tenant on a scheme with zero installed controls collects no
  evidence. Surface a "install scheme controls" affordance on the scheme page.
- **Inspection pack needs an `auditCycleId`** — schemes ride the existing
  AuditCycle concept; there's no scheme-native inspection-cycle model. The
  assemble API takes a cycle id; a "start inspection" flow that creates the
  cycle is a follow-up.
- **No PDF applicability statement** — CSV only (reuse `reports/pdf` for PDF).
- **Auto-evidence rules are a hardcoded code map** — moving INPUT_APPLICATION→
  requirement-code mapping into the catalog (a `satisfiedBy` field on a
  requirement/template) would let new schemes declare their own auto-evidence
  without code. LiteFarm-style cert EXPORT (certifier-ready bundle beyond the
  SoA CSV) also deferred.
- **One spray → one evidence row** (distinct-control dedup): the CB.7 templates
  map to a single control, so a spray attaches 1 evidence, not 3. Expected.

---

## Phase 9 — Crop planning: succession engine + auto-generated field work (feat/crop-planning)

Succession planning that auto-generates field Tasks and computes seed demand.

- **Pure succession engine** `src/lib/planning/succession.ts` — CLEAN-ROOM
  reimplementation of Qrop/CropPlanning math (GPL → concepts only, no code).
  `generateSuccessions(config, timing, alloc, spacing)` → evenly-spaced sowings
  (firstSow + i×interval), transplant-vs-direct-sow date offsets, bed/area plant
  counts, germination-overage seed grams. Plus `mergeTiming`/`mergeSpacing`
  (variety overrides crop, field-by-field), `addUtcDays` (UTC-exact, no TZ drift).
  No DB/IO — 24 unit tests. The USECASE maps Prisma↔engine; the engine never
  imports Prisma.
- **Schema** `prisma/schema/planning.prisma` — 6 tenant-scoped models: CropType,
  CropVariety (the agronomic numbers + `sourceUrn`), Season, CropPlan (the
  succession CONFIG), Planting (engine output, PLANNED dates), LogPlanting
  (plan-vs-actual join, mirrors LogLocation). All `@@unique([id, tenantId])` +
  composite child FKs `[xId, tenantId]→[id, tenantId]` + soft-delete trio. RLS
  trio applied via a DO-loop in the migration; the migrate-dev drift (44 lines)
  was hand-stripped. CropType/CropVariety are TENANT-SCOPED catalogs (like Item),
  NOT global — each tenant curates + seeds its own from OpenFarm CC0.
- **generatePlantings(ctx, cropPlanId)** — the integration: load plan+variety
  (validates daysToMaturity), build engine inputs (timing/spacing come from the
  VARIETY; plan.method overrides), `generateSuccessions`, then (tx) `deleteMany`
  only `status:'PLANNED'` plantings (SOWN+ survive — idempotent regenerate) +
  `createMany`. THEN outside the tx, auto-generate SOW/TRANSPLANT(conditional)/
  HARVEST field Tasks via `createTask`+`addTaskLink('PLANTING')`. Task idempotency
  is BATCHED (one taskLink.findMany → `${plantingId}:${stage}` Set) — no
  read-in-loop. Tasks run outside the db tx because createTask opens its own
  context + enqueues BullMQ.
- **Plan-vs-actual** `getCropPlanProgress` — planted dates beside actuals from
  LogPlanting→LogEntry.occurredAt grouped by stage, resolved in ONE findMany.
  `createLogEntry` gained `plantingLinks` (→ LogPlanting rows, mirroring
  locationIds→LogLocation) so a journal entry records the real sow/harvest.
- **UI** `/planning` route group (PLANNING-gated, simple-mode/FREE — NOT
  cert-gated): crop-plans EntityListPage + detail EntityDetailLayout with a
  PlantingBoard (GanttTimeline + plan-vs-actual DataTable) + seasons. Nav
  "Planting" in Govern (reused CalendarIcon — no new lucide).
- **Seed** OpenFarm CC0 (`scripts/import-crop-varieties.ts`, `npm run
  varieties:import`) — 12 crops, generic public-domain horticultural norms,
  `sourceUrn:'openfarm:cc0'`. seed-demo uses the engine directly with prisma
  (Redis-free; createTask enqueue is skipped in seed).

### Remaining gaps (Phase 9)
- **CropType carries no agronomic defaults** — timing/spacing live ONLY on
  CropVariety, so `mergeTiming(null, variety)` is really variety-only. If
  crop-level fallbacks are wanted (a CropType default for varieties that omit a
  number), add the fields to CropType + pass them as the `crop` arg.
- **No bed/Bed model** — allocation is via plan fields (bedLengthM/rowsPerBed/
  targetAreaM2), not a first-class Bed/BedAssignment entity. Spatial siting is a
  loose Location/Parcel FK on CropPlan/Planting, not a packed-bed scheduler.
- **Seed omits the auto-tasks** (createTask enqueues BullMQ → hangs without
  Redis). The demo plantings exist but their SOW/HARVEST tasks don't; run
  `generatePlantings` via the API/usecase with Redis up to get the tasks.
- **PlantingBoard reuses GanttTimeline** by casting a planting lifecycle to a
  task-shaped CalendarEvent — a dedicated planting-timeline tone would be
  cleaner. Plan-vs-actual variance (days early/late) is shown as a check, not a
  computed delta.
- **No seed-demand roll-up** — seedQuantityGrams is per-planting; a season-level
  "total seed to order per variety" report is the obvious next step.

---

## Phase 10 — Agro-intel: weather, GDD, agronomic rules → Risk register (feat/agro-intel)

A data-driven layer over spray/planning/risk: daily weather → obs store; GDD per
planting; spray-window + disease-risk rules → notifications + Risk-register entries;
NDVI map layer; feature-flagged sensor data-stream ingestion.

- **Pure math** `src/lib/agro/{gdd,rules}.ts` — clean-room (no GPL code): GDD
  average method (cap + base floor); spray-window (wind/rain/temp → GOOD/CAUTION/
  UNSUITABLE) + disease-risk (longest warm-wet consecutive run → LOW/MOD/HIGH).
  18 unit tests. Prisma-free; the job/usecases feed them.
- **Schema** `agro.prisma` — 4 tenant-scoped RLS models: WeatherObservation
  (upsert per location/obsDate), DataStream + DataStreamReading (farmOS data-stream
  concept), AgroSignal. AgroSignal's `@@unique([tenantId, locationId, kind,
  signalDate])` is the IDEMPOTENCY key. Risk is REUSED (not a new model) — a
  disease-risk signal `createRisk(category:'Agronomic')` and back-links `riskId`
  on the signal.
- **weather-pull BullMQ job** (`jobs/weather-pull.ts`, daily `0 6 * * *`): iterate
  tenants (distinct Location.tenantId) → synthetic admin ctx + runInTenantContext →
  per Location derive lat/lon (geo.ts `locationParcelBoundsSql` bbox centroid, else
  `boundsJson`, else skip) → Open-Meteo fetch → upsert WeatherObservation → evaluate
  signals. Registered in executor-registry + types.ts JobPayloadMap + schedules.ts.
  Open-Meteo client (`lib/weather/open-meteo-client.ts`) is free/no-key, 15s
  AbortController timeout, mocked in tests.
- **agro-signals** (`usecases/agro-signals.ts`) — CLAIM-then-act idempotency: claim
  the AgroSignal via create (catch P2002 unique → already handled today → no-op);
  only a NEW claim fires the Notification (spray) / createRisk (disease, OUTSIDE the
  claim tx since createRisk opens its own). A failed createRisk leaves a signal
  without a risk (no duplicate on re-run; reconcilable) — acceptable.
- **GDD on plantings** (`usecases/agro-gdd.ts`) — `accumulateGdd` over the
  planting's location WeatherObservation from sowDate→today. Base temp is a module
  constant `GDD_BASE_TEMP_C = 10` (CropVariety has NO base-temp column — per-variety
  base temp is a follow-up). Surfaced via `GET …/planning/plantings/:id/gdd`.
- **DataStream ingestion** — public token-gated endpoint
  `POST /api/agro/data-streams/:streamId/ingest` (bare route, route-exemption):
  feature-flag `env.AGRO_DATASTREAMS_ENABLED==='1'` else 503; SHA-256 constant-time
  token compare; tenant resolved from the matched stream; uniform 401 (anti-
  enumeration). `data-stream.ts` uses global prisma pre-auth (allowlisted, same
  rationale as vendor-assessment-response) then `runWithAuditContext`.
- **NDVI** — a raster `<Source>`/`<Layer>` toggle on the location map over the
  parcel-bbox AOI; tile URL from `env.AGRO_NDVI_TILE_URL` (default '' → "configure a
  source" empty state). The layer RENDERS; real satellite provisioning is a follow-up.

### Remaining gaps (Phase 10)
- **GDD base temp is a flat 10°C** — no per-crop/variety base (would need a
  CropVariety.gddBaseTempC column + migration). Add for accurate maize (10) vs
  brassica (varies) accumulation.
- **NDVI is a tile-URL passthrough, not a real satellite pipeline** — no
  Sentinel/COG fetch, no NDVI computation, no per-AOI clipping beyond the bbox.
  AGRO_NDVI_TILE_URL must point at an existing XYZ raster.
- **Weather job hits live Open-Meteo** — depends on the prod network policy
  allowing api.open-meteo.com egress; CI/tests mock it. No backfill of historical
  obs beyond Open-Meteo's `past_days=7`.
- **Spray-window only fires on UNSUITABLE** (not CAUTION) and disease only on HIGH
  — thresholds are code constants (DEFAULT_*), not per-tenant tunable yet.
- **No GDD/weather card on the ag dashboard** — GDD shows on the planting detail
  only; a dashboard "this week's spray windows / GDD progress" strip is the obvious
  next surface. Data-stream readings have no charting UI (ingest + store only).
- **A failed createRisk orphans a disease AgroSignal** (signal exists, riskId null)
  — a reconcile pass could re-attempt.

---

## Phase 11 — Phone-native operator map (feat/mobile-map)

Made the parcel map the operator's primary phone screen. Branch
`feat/mobile-map` off `main`; **pushed, draft PR open, NOT merged**.

- **`MapCanvas` gains opt-in on-map controls + geolocation** (`showControls`,
  `controlsBottomInset`, `liveTracking` — all default off, so the read-only /
  prescription / operator mounts are byte-for-byte unchanged). Bottom-right
  thumb stack: zoom ±, locate-me, (stretch) live-tracking — each a ≥44px
  (WCAG 2.5.5) target. Geolocation is pure client (`navigator.geolocation`):
  `getCurrentPosition` flies to the device + drops a blue-dot `<Marker>`;
  `watchPosition` follows + draws a breadcrumb `LineString`, high-accuracy
  only while tracking, `clearWatch` on unmount (battery-aware); permission
  denial → non-blocking `aria-live` hint.
- **`ParcelDetailSheet`** (new, vaul bottom-sheet via the canonical `Sheet`,
  `direction="bottom"`): area / crop / last-application + a pure-client
  apply-rate calculator + "Start operation here" (→ spray wizard seeded with
  that parcel via the new `SprayJobWizard.initialParcelIds`). On phones a
  parcel TAP (map) or a Parcels-tab card tap opens it; **desktop keeps the
  inline side panel** unchanged.
- **Full-bleed layouts.** Location Map tab: edge-to-edge (`-mx-4`),
  near-viewport-tall map, no inline panel on mobile. `OfflineFieldPanel` map:
  300px box → full-width `60vh` and now **selectable** (tap a parcel →
  highlight + scroll to its prescription line).
- **TWO incidental fixes folded in (both pre-existing, both verified):**
  1. **`Permissions-Policy: geolocation=()` → `geolocation=(self)`** in
     `src/lib/security/headers.ts` (the middleware emitter) + `next.config.js`
     + the pinning unit test. Geolocation was blocked app-wide — locate-me
     (and ANY future geo feature) would silently fail in prod. camera/mic stay
     closed (photo capture uses file-input `capture`, not getUserMedia).
  2. **`prisma/seed.ts` ag-demo seed was dead** — it called the removed
     synchronous `importLocationSpatialFile`; spatial import is now an async
     BullMQ job (`stageLocationSpatialImport`). A Redis-free seed can't drive
     that, so the demo now creates the 3 `Home Farm — Demo` parcels directly
     via `createParcel` (seed convention). This had been silently skipping the
     demo Location's parcels (breaking `mobile-responsive` / `ag-location-import`
     / `mobile/lists` Home-Farm assertions from a fresh seed).

**Verified:** tsc 0; full UI design-system ratchet set green (spacing,
typography-eradication, heading-primitive, primary-action-budget,
primary-secondary-ratio, icon-only-action-discipline, button-*, …) — fixed one
`gap-2`→`gap-tight`; security-headers unit green; **mobile e2e green** —
`tests/e2e/mobile/map.spec.ts` (NEW, self-seeding: controls 44px, locate-me→dot
with granted+mocked geolocation, parcel card→bottom-sheet→apply-rate→
start-operation→wizard) on BOTH `mobile-android` + `mobile-iphone`, and the
updated `mobile-responsive.spec.ts` (Map-tab now asserts full-bleed + on-map
controls instead of the removed inline panel). Local e2e ran against a postgis
test DB (the committed `docker-compose.test.yml` still uses plain
`postgres:16-alpine` — see gap below).

### Remaining gaps (Phase 11)
- **"Last application" in the sheet is a graceful placeholder** — the Location
  parcels payload carries no per-parcel application history; the sheet shows
  "No applications recorded yet" and exposes a `lastApplication` prop for when
  a per-parcel applications query lands (backend follow-up, deliberately out of
  scope for a map-UX change).
- **`docker-compose.test.yml` uses non-postgis `postgres:16-alpine`** — the ag
  migrations `CREATE EXTENSION postgis`, so local/CI e2e needs a postgis test
  image (I ran a manual `postgis/postgis:16-3.4` test container). Bump the test
  compose image to match dev (`postgis/postgis:16-3.4`) as a follow-up.
- **Map-tap → sheet isn't e2e-clicked** (WebGL canvas taps are non-deterministic
  in CI) — covered structurally; the Parcels-card → same-sheet path is the
  deterministic e2e route.

---

## Phase 12 — Installable offline PWA + Web Push + perf budget (feat/mobile-pwa)

Turned the operator app into an installable, dead-zone-capable, push-enabled
PWA with a CI perf budget. Branch `feat/mobile-pwa` off `main`.

- **Offline outbox moved to IndexedDB** (`src/lib/offline/idb-outbox.ts`,
  `IndexedDbOutboxStore`) so the service worker can replay it — `localStorage`
  is window-only. `getOutboxStore()` prefers IDB, falls back to localStorage /
  in-memory (jsdom/SSR keep old behaviour). One-time migration drains the
  legacy `localStorage` queue into IDB. DB/store names are a CONTRACT shared
  with `public/sw.js`.
- **Background Sync** — `useOfflineSync` registers a `flush-outbox` sync tag on
  first queue (`FLUSH_OUTBOX_SYNC_TAG`). `public/sw.js` (bumped to `agri-v2`)
  gained a `sync` handler that replays the IDB outbox with the SAME policy as
  `sync.ts` (2xx/terminal-4xx remove, transient keep+attempts, MAX 8, reject to
  reschedule). iOS Safari (no Background Sync) falls back to the page-side
  `online` flush + a SW `postMessage('flush-outbox')` from ServiceWorkerRegistrar.
- **Install affordance** — `InstallPrompt` (rendered by `ServiceWorkerRegistrar`):
  captures `beforeinstallprompt` → dismissible mobile banner (7-day localStorage
  snooze); iOS gets an "Add to Home Screen" Share-sheet hint. Mobile-only,
  hidden when already standalone.
- **Offline-first field data** — `sw.js` network-first-with-cache-fallback for a
  NARROW allowlist of field GETs (locations/:id(/parcels), field-operations/:id,
  farm-tasks) so Map / my-Tasks / Field-execute open with no signal; navigations
  already cache. `OfflineSyncBar` extracted (Sync now + pending count), reused in
  `OfflineFieldPanel`.
- **Web Push** — `web-push` dep; VAPID env (`VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/
  `_SUBJECT` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY`), all OPTIONAL → unconfigured =
  silent no-op (dev/CI/self-hosted). `PushSubscription` model (migration
  `20260619000000`, RLS trio, `@@unique([tenantId,userId,endpoint])`).
  `src/lib/notifications/web-push.ts::sendWebPushToUser` reads subs in a short
  tenant tx, sends OUTSIDE any tx, prunes 404/410. Wired post-tx at the
  TASK_ASSIGNED caller (`task.ts`) + the spray-window path (`agro-signals` →
  `weather-pull`), reusing the notification copy returned by the (extended)
  `createAssignmentNotification` / `createAgroSignalNotification` outcomes.
  Self-service subscribe/unsubscribe at `POST/DELETE
  /api/t/:slug/push-subscriptions` (+ `push-subscription.ts` usecase, Zod
  schema, public `/api/metrics` allowlist NOT needed for it). `PushOptIn`
  opt-in UI (permission-graceful, key-gated) on the OfflineFieldPanel. SW
  `push` + `notificationclick` handlers focus the deep link.
- **Perf** — `web-vitals` dep → `WebVitalsReporter` (dynamic-imported, beacons
  LCP/INP/CLS/FCP/TTFB to the public `/api/metrics` sink) mounted in layout.
  `.github/workflows/lighthouse.yml` + `lighthouserc.json`: mobile (390px,
  throttled) Lighthouse-CI on `/login` asserting LCP≤4500 / TBT≤800 / CLS≤0.15
  (error) + perf-score/FCP (warn). Map + terra-draw were ALREADY code-split
  (`dynamic(ssr:false)` + `await import('terra-draw')`); added `DeferredOnMobile`
  (renders heavy children on idle on phones, eager on desktop, eager under jest)
  and applied it to the heavy Monte-Carlo loss-exceedance curve.

**Verified:** tsc 0; full static guard sweep (488 suites / 4080 tests) green;
web-push unit (send/prune/no-op) + offline-pwa-coverage + notif-assignment
wiring + assignment/agro/weather-pull/offline suites (200) green; rls-coverage
(PushSubscription RLS) + schema-index + contract-drift + api-permission +
no-explicit-any green. Mobile e2e + local Lighthouse verified pre-merge.

### Remaining gaps (Phase 12)
- **Real push DELIVERY isn't e2e-tested** — needs a live push service + VAPID;
  CI proves the send wiring via the mocked-web-push unit + the subscribe
  endpoint. Verify delivery manually on staging with real VAPID keys.
- **Offline field-data cache is per-browser tenant data** — narrowly scoped +
  documented; a shared device shows the last operator's cached field data until
  the SW cache is evicted. Acceptable for the field PWA; revisit if shared
  devices become common.
- **INP is field-only** (web-vitals RUM); the Lighthouse lab budget uses TBT as
  its proxy. The `/api/metrics` sink only logs — no dashboard/aggregation yet.
- **Lighthouse audits `/login`** (the public page); authenticated field routes
  need a session Lighthouse can't easily establish in CI. A logged-in run via a
  seeded session cookie is a follow-up.
- **`docker-compose.test.yml` still non-postgis** (carried from Phase 11) — the
  new Lighthouse + e2e CI jobs use the inline `postgis/postgis:16-3.4` service,
  so CI is fine; only the local compose helper needs the bump.

---

## Phase 13 — Delight motion layer (feat/delight-motion)

Every tap feels alive + responsive without slowing the field user. Built
ENTIRELY on the sanctioned motion tokens so the 9 existing motion guards stay
green. Branch `feat/delight-motion` off `main` — **pushed, NOT merged** (the
prompt asked for commit/push/MEMORY only).

- **Key constraint learned:** `src/styles/tokens.css` globally flattens
  `animation-duration` to ~1ms under `prefers-reduced-motion`, so any animation
  using a sanctioned `animate-*` utility is reduced-motion-safe for free. The
  motion guards BAN: `hover:transition-all`, `hover:translate/scale/shadow`,
  `animate-bounce/ping`, hardcoded durations, new animate-* utilities outside
  the tailwind.config allowlist, raw `sonner` imports (must go through the toast
  hooks). I stayed inside all of that → no guard bumps needed.
- **`useReducedMotion` + `prefersReducedMotion`** (`components/ui/hooks/
  use-reduced-motion.ts`, exported from the hooks barrel) — the public hook for
  JS-driven motion (the charts kept their private copies to avoid touching the
  r16 guard).
- **Haptics** (`src/lib/haptics.ts`): `haptic('tap'|'success'|'warning'|
  'error')` + `canVibrate()` — capability-gated (Vibration API) AND
  reduced-motion-gated → silent no-op on desktop/iOS Safari/reduced-motion.
  Wired on: mark-done (OfflineFieldPanel sent + FieldOperationPanel),
  offline-submit (useOfflineSync queue path), photo capture+upload
  (JournalPhotosTab). error pattern on failures.
- **Map fly-to easing** (MapCanvas): locate-me `flyTo` duration is now
  reduced-motion-aware (0 vs 1200); new opt-in `flyToOnSelect` eases
  (`fitBounds` via `@turf/bbox`, padding 64, 800ms) to the SOLE selected parcel
  — enabled on OfflineFieldPanel (operator focus), left OFF on the desktop
  multi-select Map tab so merge isn't disrupted.
- **Cross-fade + list motion** (`components/ui/motion/FadeIn.tsx`): `<FadeIn>`
  + `<SkeletonFade>` on the existing `animate-fade-in` token (opacity-only → no
  CLS, GPU-composited). OfflineFieldPanel content cross-fades in on load;
  prescription lines fade in on mount (list-add). Reduced-motion handled by the
  global token flatten.
- **Optimistic + inline spinners:** mark-done already optimistic (local view +
  outbox); added per-line `loading` spinners (Button `loading` prop) on
  OfflineFieldPanel + FieldOperationPanel — never a blocking modal. Toast
  vocabulary + Undo-on-destructive already shipped (Epic 67 `useToastWithUndo`,
  e.g. JournalPhotosTab photo delete) — reused, not rebuilt.

**Verified:** tsc 0; all 9 motion guards green (81); full static guard sweep;
new haptics unit (capability/reduced-motion gating) + FadeIn/SkeletonFade
rendered tests; no-explicit-any green (caught + fixed a `: any` in a doc
comment, twice now — the regex matches prose). No new animate-* utility, no
guard ratchet bump.

### Remaining gaps (Phase 13)
- **List reorder is not FLIP-animated** — add (enter) + remove (Epic 67 undo
  toast) are covered; true position-swap reorder animation is a follow-up (FLIP
  risks CLS, deferred).
- **`flyToOnSelect` is opt-in, wired only on OfflineFieldPanel** — not on the
  in-app FieldOperationPanel (read-only, no selection) or the desktop Map tab
  (multi-select). Extend if a single-focus desktop view appears.
- **Haptics suppressed under reduced-motion** by choice (treated as
  non-essential feedback) — if a user wants haptics-without-visual-motion,
  that'd need a separate preference.
- **60fps / no-CLS is by construction** (opacity/transform only, GPU layers) —
  not yet asserted by an automated perf test; the Lighthouse CLS budget (Phase
  12) is the nearest gate.
