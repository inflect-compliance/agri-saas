# 2026-06-12 — RQ3-3: portfolio honesty — stop summing means

**Commit:** _(see PR — `feat(rq3-3): portfolio honesty — simulated percentiles headline; appetite tests at a configured percentile`)_

## Design

The dashboard headline was `Σ(mean ALE)` — a sum of averages.
Raydugin's core claim: a portfolio is a distribution, not a sum;
correlation and tail compounding make the gap real information. The
correlation machinery existed (RQ-8) but the default simulation path
never used it, and the appetite ceiling was tested against the naive
sum. Three moves:

**The headline is the distribution.** The risk dashboard's
quantitative-analytics card now reads the latest simulation run
(lifted to page state, shared with the RQ3-1 MonteCarloPanel stage
via `run`/`onReload` props). With a run: the KPI tiles are
Portfolio P50/P80/P95 (+ max single ALE), and the Σ figure is demoted
to a subordinate line ("a sum of averages, not a distribution") with
an `InfoTooltip` explaining the gap. Without a run: the Σ tiles
survive honestly, with a nudge to run a simulation.

**Stored correlations apply by default.** `runSimulation` now loads
the tenant's pairwise `RiskCorrelation` rows into an NxN matrix
aligned to the simulated risk order whenever no explicit matrix is
passed (scenario engine still wins). Identity-equivalent (no nonzero
pair) or oversized (>500 risks — Cholesky is O(n³)) portfolios skip
the matrix and keep independent sampling.

**The appetite ceiling is tested at a configured percentile.**
`RiskAppetiteConfig.testedPercentile` (`Int @default(80)`, migration
`20260612020000_rq3_3_tested_percentile`) is board-level policy:
which simulated portfolio percentile the ceiling is compared to.
`detectBreaches` (still pure) takes an optional
`SimulatedPortfolioPercentiles` record; the PORTFOLIO_ALE check runs
against `simulated[testedPercentile]` when available, falling back to
Σ(means) — and the result's new `portfolioTested {value, percentile,
simulated}` says exactly which figure was used. `getAppetiteStatus`'s
APPROACHING band tracks the tested figure, not the sum. The admin
appetite page gets a P50/P80/P90/P95/P99 selector and shows the
tested figure in the status badge.

## Files

| File | Role |
| --- | --- |
| `prisma/schema/compliance.prisma` + migration | `RiskAppetiteConfig.testedPercentile` |
| `src/app-layer/usecases/risk-appetite.ts` | `detectBreaches` percentile honesty, `portfolioTested`, `loadSimulatedPercentiles`, upsert field |
| `src/app-layer/usecases/monte-carlo.ts` | `loadStoredCorrelationMatrix` + default-path wiring |
| `src/app/api/t/[tenantSlug]/risk-appetite/route.ts` | `testedPercentile` zod literal union |
| `src/app/t/[tenantSlug]/(app)/risks/dashboard/page.tsx` | lifted run state; P50/P80/P95 headline; Σ demotion + tooltip + nudge |
| `src/app/t/[tenantSlug]/(app)/risks/dashboard/MonteCarloPanel.tsx` | run/onReload props (exported `SimulationRun`) |
| `src/app/t/[tenantSlug]/(app)/admin/risk-appetite/page.tsx` | percentile selector + tested-figure badge |
| `tests/guards/rq3-3-portfolio-honesty.test.ts` | the ratchet |

## Decisions

- **Σ kept, demoted, explained.** Deleting the sum would hide the
  gap that teaches users why the percentiles matter; the subordinate
  line + tooltip turn the gap into the lesson.
- **Per-risk / per-category appetite checks stay on resolved ALEs.**
  Those thresholds are per-risk statements; testing them against
  portfolio percentiles would be a category error. Only the
  portfolio ceiling moves to the distribution.
- **Fallback is explicit, not silent.** `portfolioTested.simulated`
  travels through `checkPortfolioAppetite` → `getAppetiteStatus` →
  the admin badge, so a Σ-fallback state is visibly different from a
  simulated test (badge reads `P95 €1.2M/yr` vs `€4M/yr`).
- **Missing percentile key → Σ fallback.** Pre-RQ3-1 runs lack P80;
  treating a partial record as "no simulation" for the configured
  percentile avoids testing the board's P95 policy against a P50
  column.
- **Ratchet shape** (`rq3-3-portfolio-honesty.test.ts`): pins the
  P50/P80/P95 tiles + sum-line + tooltip + nudge on the dashboard;
  the percentile parameter, run loader, and APPROACHING wiring in
  the usecase; the schema/migration/route pairing; the admin
  selector; and the default-path correlation load in the engine.
