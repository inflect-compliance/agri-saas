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

---

*When a new component ports a permissively-licensed project's schema or UX,
add a credited entry above in the same diff. When a component takes only a
concept from a copyleft project, record it in the concept-only table so the
"no code copied" boundary stays auditable.*
