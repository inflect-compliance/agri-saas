# Risk Quantification (RQ-1 … RQ-10)

The risk-quantification suite brings Archer-grade quantitative risk analysis to
IC: structured FAIR inputs, Monte Carlo simulation, scenario modelling,
hierarchy roll-up, KRIs, bow-tie analysis, correlated portfolio modelling,
historical trending, and board-ready reporting.

## The keystone

**RQ-1's `resolveALE`** (`src/app-layer/usecases/fair-calculator.ts`) is the
single source of truth for "the annualised loss expectancy of a risk":
FAIR ALE → legacy SLE×ARO → null. Every downstream epic consumes it — analytics,
appetite, Monte Carlo, hierarchy roll-up, snapshots, reports — so the portfolio
number is consistent everywhere. The `risk-quantification-integrity` meta-ratchet
(`tests/guards/risk-quantification-integrity.test.ts`) locks that convergence in.

## The epics

| Epic | What | Keystone module | Schema |
|------|------|-----------------|--------|
| **RQ-1** | FAIR taxonomy: per-factor inputs + Beta-PERT sampling + `resolveALE` | `fair-calculator.ts` | Risk FAIR columns |
| **RQ-2** | Risk appetite & tolerance + breach monitor | `risk-appetite.ts` | RiskAppetiteConfig/Breach |
| **RQ-3** | Monte Carlo simulation → VaR + loss-exceedance curve | `monte-carlo.ts` | RiskSimulationRun |
| **RQ-4** | Scenario / what-if (apply overrides → re-simulate → ROI) | `risk-scenario.ts` | RiskScenario |
| **RQ-5** | Hierarchy aggregation (recursive ALE roll-up, deduped) | `risk-hierarchy.ts` | RiskHierarchyNode/Link |
| **RQ-6** | Key Risk Indicators (RAG thresholds + readings) | `key-risk-indicator.ts` | KeyRiskIndicator/KriReading |
| **RQ-7** | Bow-tie analysis (pure read projection) | `bowtie-projection.ts` | — (no schema) |
| **RQ-8** | Correlation & portfolio modelling (Cholesky + PSD) | `risk-correlation.ts` + `monte-carlo.ts` | RiskCorrelation |
| **RQ-9** | Historical trending & velocity (daily snapshots) | `risk-snapshot.ts` + `risk-velocity.ts` | Risk/PortfolioSnapshot |
| **RQ-10** | Executive reporting + BIA (PDF/CSV + schedules) | `risk-report.ts` | Risk BIA + Report{Template,Run,Schedule} |

Each epic has a structural guard (`tests/guards/rqN-*.test.ts`), pure-core unit
tests, DB-backed integration tests, and an implementation note
(`docs/implementation-notes/2026-06-10-rqN-*.md`).

## Dependency graph

```
RQ-1 (FAIR) ──┬─► RQ-3 (Monte Carlo) ──┬─► RQ-4 (Scenarios)
              │                         └─► RQ-8 (Correlation)
              ├─► RQ-9 (Trending)
              └─► RQ-5 / RQ-2 / RQ-6 / RQ-7 (consume resolveALE)
RQ-10 (Reporting) ◄── pulls from all of the above
```

## Cross-tenant crons

Three daily fan-out jobs (cross-tenant, each builds a per-tenant context):

- `risk-appetite-monitor` (06:00) — detect + record appetite breaches.
- `risk-snapshot` (02:00) — capture per-risk + portfolio snapshots (idempotent
  per UTC day) + prune beyond retention.
- `report-delivery` (06:00) — generate due scheduled reports + advance `nextRunAt`.

## Conscious scope decisions (documented follow-ups)

- **RQ-8 correlated sampling** uses the single-uniform PERT path (standard
  Cholesky→Φ→inverse-CDF); FAIR multi-factor sampling is bypassed when a
  correlation matrix is supplied.
- **RQ-7 bow-tie** ships as a five-column card layout; `toXyFlowGraph` is ready
  for an interactive ReactFlow upgrade.
- **RQ-10 PPTX** export is deferred (no `pptxgenjs` dependency yet); PDF + CSV
  ship. Email/SharePoint delivery of scheduled artefacts is logged pending the
  outbound wiring.
