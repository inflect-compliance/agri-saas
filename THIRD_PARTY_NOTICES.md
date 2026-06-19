# Third-Party Notices

This product (agri-saas) is built on the inflect-compliance platform and
reuses **design concepts** — schema shapes, domain ontologies, and UX
patterns — from a number of open-source agriculture and ERP projects.

**License hygiene.** We do **not** copy source code from GPL/AGPL-licensed
projects; from those we take *concepts only* (the idea of a stock ledger,
an intervention record, a log-type ontology) and reimplement them
independently against our own Prisma/TypeScript stack. From
permissively-licensed projects (MIT / Apache-2.0 / BSD / CC0) we may port
schema structure and UX patterns, and we credit them below as those
licenses require.

This file documents **design-concept attribution**. Bundled npm runtime
dependencies carry their own license texts in `node_modules/<pkg>/LICENSE`
and are not re-listed here.

---

## Ported / adapted (permissive — credited)

### InvenTree — MIT License
- **Project:** https://github.com/inventree/InvenTree
- **Used for:** The inventory domain — Item / batch-lot / stock-location
  tree and the stock-movement model. Translated from its Django/ORM shape
  to our Prisma schema (`prisma/schema/inventory.prisma`,
  `prisma/schema/agriculture.prisma`: `Item`, `InventoryLot`,
  `StockTransaction`). No InvenTree source was copied; the schema concepts
  were re-expressed for our multi-tenant, RLS-isolated, hash-chained model.

### Apache OFBiz — Apache License 2.0
- **Project:** https://ofbiz.apache.org/
- **Used for:** The lot-genealogy graph (`LotLink`) — OFBiz's inventory
  lot-tracking and parent/child lot lineage informed the directed
  DERIVATION edge model that threads seed/input lot → field → harvest lot
  for food-safety traceability.

### HortusFox — MIT License
- **Project:** https://github.com/danielbrendel/hortusfox-web
- **Used for:** Field-journal UX concepts — the photo-log and
  calendar/observation patterns behind the journal entry + photo surfaces
  (`src/app/t/[tenantSlug]/(app)/journal/`).

### OpenFarm — CC0 1.0 (Public Domain)
- **Project:** https://openfarm.cc — "all data is released under CC0".
- **Used for:** The seeded growing-guide crop data (sowing method, spacing,
  sun, days to maturity) in `scripts/import-knowledge.ts`. CC0 data is public
  domain and may be embedded + redistributed freely; this attribution is
  courtesy. Each seeded article also records `source = "OpenFarm (CC0)"`.

---

## RAG knowledge corpora (feat/ai-rag — ingested as retrievable text)

The retrieval-augmented-generation layer (`src/app-layer/ai/rag/`,
`scripts/rag/`) ingests third-party agricultural knowledge into the GLOBAL
`KnowledgeChunk` catalog so the general model can give grounded, cited
answers. **Only the corpora below are permitted for TEXT ingestion** — the
allowlist `LICENSED_SOURCES` in `scripts/rag/corpus.ts` is the single source
of truth and `assertLicensedSource()` refuses anything else. Each ingested
chunk records its corpus + licence in its `source` field.

### KCC (Kisan Call Centre) — Government Open Data Licence – India (GODL)
- **Project:** Kisan Call Centre transcripts, data.gov.in.
- **Licence:** GODL-India — permits reuse + redistribution with attribution.
- **Used for:** GLOBAL agronomy Q&A chunks (pest/disease + nutrient advice).
- **Attribution:** Chunks record `source = "KCC (GODL)"`.

### FAIR Forward / Digital Green — open agricultural advisory Q&A
- **Project:** FAIR Forward (GIZ) / Digital Green open datasets.
- **Licence:** Open / permissive (CC-BY-class) — redistribution with credit.
- **Used for:** GLOBAL crop-advisory Q&A chunks.
- **Attribution:** Chunks record `source = "FAIR-Forward / Digital Green QA"`.

### EU Regulation 2018/848 — organic production rules
- **Project:** Official Journal of the European Union.
- **Licence:** EU legislation — reusable (CELEX/EUR-Lex reuse policy).
- **Used for:** GLOBAL organic-compliance chunks (conversion, GMO ban, …).
- **Attribution:** Chunks record `source = "EU 2018/848"`.

### USDA National Organic Program — 7 CFR Part 205
- **Project:** US Code of Federal Regulations.
- **Licence:** US Government work — public domain.
- **Used for:** GLOBAL organic-compliance chunks (buffer zones, records, …).
- **Attribution:** Chunks record `source = "USDA 7 CFR 205"`.

### ⛔ GlobalG.A.P. — PROHIBITED (proprietary; cite-only, NEVER ingested)
GlobalG.A.P. standards, checklists, and control points are **proprietary
and copyrighted**. They are **CITE-ONLY**: the product may reference that a
GlobalG.A.P. requirement exists and direct the user to the official
document, but it **MUST NEVER ingest GlobalG.A.P. text** into a RAG chunk.
`assertLicensedSource()` in `scripts/rag/corpus.ts` **hard-refuses** any
source matching GlobalG.A.P. regardless of the allowlist. No GlobalG.A.P.
text is bundled, sampled, or ingested anywhere in this repository.

---

## Concept-only (copyleft — NO code used)

The following projects are GPL/AGPL-licensed. We studied them for **domain
modelling ideas only** and copied **no source code**. Our implementations
are independent.

| Project | License | Concept referenced |
|---------|---------|--------------------|
| farmOS | GPL-2.0 | Log / Asset / Quantity ontology (journal `LogEntry` / `LogQuantity` types) |
| ERPNext | GPL-3.0 | Append-only stock-ledger valuation concept (`StockTransaction`) |
| Ekylibre | AGPL-3.0 | Intervention + per-activity costing concept (`LogEntry.costAmount`) |
| LiteFarm | GPL-3.0 | Farm-management domain breadth; the farm task-type catalog (`src/lib/agriculture/farm-task-types.ts`) — type names + category grouping, reimplemented (keys/enum/TS surface are ours) |
| frappe/wiki | GPL-3.0 | Wiki / knowledge-base feature shape (versioned articles, draft→publish, read-acknowledge) — independently built on IC's Policy machinery |

---

*When a new component ports a permissively-licensed project's schema or UX,
add a credited entry above in the same diff. When a component takes only a
concept from a copyleft project, record it in the concept-only table so the
"no code copied" boundary stays auditable.*
