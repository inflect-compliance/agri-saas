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
