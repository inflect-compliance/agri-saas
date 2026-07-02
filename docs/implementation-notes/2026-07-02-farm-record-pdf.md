# 2026-07-02 — БАБХ ДНЕВНИК PDF generator (PR 2/3)

**Commit:** `feat(farm-record): generate the БАБХ ДНЕВНИК as a filled Cyrillic PDF`

## Design

Second of the three-PR roadmap. PR 1 captured the data; this PR generates the
Bulgarian БАБХ *"ДНЕВНИК за проведените растителнозащитни мероприятия и торене"*
(Прил. 1 към заповед РД 11-3194/31.12.2021) as a filled PDF from completed farm
tasks. Engine + generator + API + a minimal one-button trigger; the full product
surface (register, auto-generation) is PR 3.

**Cyrillic (the blocker).** PDFKit's built-in Standard-14 `Helvetica` is
AFM/latin-only and renders tofu (or throws) for Cyrillic. `createPdfDocument`
gained a `fontFamily: 'latin' | 'unicode'` option (on `ReportMeta`). For
`'unicode'` it re-registers the `Helvetica` / `Helvetica-Bold` **names** with the
bundled DejaVu Sans TTFs — so every existing layout/table/section helper that
calls `.font('Helvetica…')` renders Cyrillic transparently, with **zero helper
changes** and every existing latin report untouched (they never register). DejaVu
Sans (full Cyrillic coverage, Bitstream Vera license) is vendored under
`src/lib/pdf/fonts/` with its LICENSE.

**Generator** `farm-record-diary.ts` is split so the layout is DB-free-testable:
`renderFarmRecordDiary(doc, data, L)` (pure, draws the form) + `gatherFarmRecordData`
(Prisma) + `generateFarmRecordDiaryPdf` (gather → `createPdfDocument({fontFamily:
'unicode'})` → render → return doc, never `.end()` — the route's `collectPdfBuffer`
finalises, per the year-on-farm convention). The shared PDF helpers are
portrait-locked, so the generator carries its **own** orientation-aware
`drawRuledTable` (header-repeat on page breaks, Cyrillic cell-wrap, blank ruled
rows) and page numbering ("стр. X от Y"), and hand-draws the boxed-cell cover.

Sections faithful to the real form (`babh-dnevnik-form-structure`): portrait cover
(Община / производител / boxed ЕГН+ЕИК+ЕКАТТЕ / offices / legal line, dotted lines
when unset), landscape 11-col observation, landscape 12-col **ПРОВЕДЕНИ ХИМИЧНИ
ОБРАБОТКИ** (one row per DONE spray OperationParcel — дка = areaHa×10, earliest
harvest = completedAt + PHI days, cert columns from the PR-1 `conditionsJson`
snapshot with live-membership fallback), portrait 5-col fertilizer, and empty
ruled sampling + ОДБХ-inspector sections.

## Files

| File | Role |
|---|---|
| `src/lib/pdf/pdfKitFactory.ts` + `types.ts` | `fontFamily` option; DejaVu registration |
| `src/lib/pdf/fonts/{DejaVuSans,DejaVuSans-Bold}.ttf` + `LICENSE` | vendored Cyrillic font |
| `src/app-layer/reports/pdf/farm-record-diary.ts` | generator (render + gather + compose) |
| `src/app/api/t/[tenantSlug]/locations/[id]/farm-record/route.ts` | POST {from,to,save?} — stream or FileRecord |
| `src/app/t/[tenantSlug]/(app)/locations/[locationId]/page.tsx` | "Дневник (PDF)" trigger + date-range modal |
| `Dockerfile` | ship the TTFs into the non-standalone runtime image |
| `tests/pdf/farm-record-diary.test.ts`, `tests/unit/farm-record-route.test.ts` | render/row/route + font-invariant guard |

## Decisions

- **Alias-remap over threading the font through helpers.** Re-registering
  `Helvetica`→DejaVu for unicode docs achieves Cyrillic with no change to the
  shared helpers and no risk to latin reports — cleaner than threading a face
  param through every `.font()` call site. The functional guarantee is the
  render test asserting the PDF bytes embed `DejaVu`; a structural guard asserts
  the generator opts into `fontFamily:'unicode'` (a literal "no Helvetica string"
  guard would be wrong here — the generator uses the remapped names on purpose).
- **FarmProfile read under `assertCanRead`, not `getFarmProfile`.** The latter is
  admin-gated (`assertCanViewAdminSettings`); a regular operator must be able to
  generate the diary, so the gatherer reads `farmProfile.findUnique` directly
  under the report's read gate. egn/eik still auto-decrypt via the Epic B extension.
- **No `requirePermission` on the route** — report routes gate at the usecase
  layer (`assertCanRead`), matching `year-on-farm`; reports aren't a privileged
  root in `api-permission-coverage`, so no route-permissions rule is needed.
- **Fonts shipped via a Dockerfile COPY.** The build is non-standalone and the
  runtime image copies only `.next`/`public`/`node_modules`, so the `.ttf` assets
  read at runtime (`process.cwd()`) are copied explicitly. (PR 3's BullMQ worker
  will need the same — handled there.)
- **PDF body strings are inline Bulgarian** (`BG_LABELS`), matching the
  `year-on-farm` precedent: the document is always Bulgarian regardless of UI
  locale, and no request-locale translator is wired into PDF generation.
