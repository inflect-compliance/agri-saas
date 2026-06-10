# 2026-06-10 — RQ-4 Scenario & what-if analysis

**Commit:** `<sha>` feat(risk): scenario & what-if analysis (RQ-4)

Turns risk quantification from reporting into decision-support: model a
hypothetical (control investment, threat-frequency change, new risk), re-run the
Monte Carlo, and compare VaR + ROI against the live baseline.

## Design

- **`risk-scenario.ts`** — `applyOverrides(risks, overrides)` is **pure**: a
  field patch mutates a FAIR field and recomputes that risk's ALE (via the RQ-1
  calculator), dropping its distribution (point-resamples in the sim); a
  synthetic override adds a virtual risk. `computeRoi` =
  (baselineMean − scenarioMean) / investment. `simulateScenario` loads the
  portfolio, applies overrides, runs RQ-3's `simulatePortfolio` for baseline +
  scenario **with the same seed** (so the delta reflects the overrides, not RNG
  noise), persists a `triggeredBy:'scenario'` run, links `resultRunId`, sets ROI,
  and returns a baseline/scenario/delta/per-risk comparison.
- **Schema** — `RiskScenario` (overrides JSON + status DRAFT→SIMULATED→ARCHIVED
  + investment + computedRoi) + RLS + migration.
- **Routes** — `risks/scenarios` (list/create), `[scenarioId]` (get/archive),
  `[scenarioId]/simulate`. **UI** — scenarios page: create, simulate, baseline-vs-
  scenario VaR table + per-risk impact.

## Decisions

- **Same-seed paired simulation** for an apples-to-apples delta.
- **Patched risks drop their distribution** — a patched FAIR field invalidates
  the stored PERT shape, so the sim uses `pointToPert(recomputed ALE)`.
- **Override authoring is API-first** for now; the UI ships create + simulate +
  comparison. A visual override editor (risk×field picker) is a follow-up.

## Files

| File | Role |
| --- | --- |
| `usecases/risk-scenario.ts` | pure override/ROI + CRUD + simulateScenario. |
| `prisma/schema/compliance.prisma` + migration | RiskScenario + RLS. |
| `api/t/[slug]/risks/scenarios/**` | list/create/get/archive/simulate. |
| `risks/scenarios/page.tsx` | scenarios + comparison UI. |
