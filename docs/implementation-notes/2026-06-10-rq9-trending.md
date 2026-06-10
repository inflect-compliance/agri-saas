# 2026-06-10 — RQ-9 Historical trending & risk velocity

**Commit:** `<sha>` feat(risk): historical trending & risk velocity (RQ-9)

Daily snapshots of every risk + the portfolio so analysts can show "portfolio
ALE fell 18% over 6 months" — data a point-in-time register can't produce. Plus
velocity (rate of change) to surface fastest-rising / fastest-falling risks.

## Design

- **Schema** — `RiskSnapshot` (per-risk daily metrics: score/likelihood/impact +
  ALE/FAIR factors + treatment count) + `PortfolioSnapshot` (one aggregate row
  per tenant per day, `@@unique([tenantId, snapshotAt])`) + RLS + migration.
- **`risk-snapshot.ts`** — `takeSnapshot(db, tenantId, now)` is **idempotent per
  UTC day** (skips if a PortfolioSnapshot exists for the day), excludes
  soft-deleted risks, aggregates via RQ-1's `resolveALE`. `cleanupSnapshots`
  (730-day retention) + `getRiskHistory` / `getPortfolioTrend` reads.
- **`risk-velocity.ts`** — `velocityOf` + `classifyTrend` are **pure** (RISING
  >+5%, FALLING <−5%, else STABLE). `computeVelocity` compares each risk's
  current ALE to its nearest snapshot ≤ window-cutoff → top rising/falling +
  portfolio direction.
- **`risk-snapshot` cron** — daily 02:00 UTC, cross-tenant: snapshot + prune.
- **Routes** — `risks/velocity`, `risks/portfolio-trend`, `risks/[id]/history`.
  **UI** — dashboard Velocity card (portfolio direction + top movers) + a History
  tab on the risk detail (score/ALE unicode sparklines).

## Decisions

- **Idempotent per day** via the unique PortfolioSnapshot key — re-running the
  cron is safe; verified by an integration test (2nd same-day run = no-op).
- **"Previous" = nearest snapshot ≤ cutoff** so velocity is robust to missing
  days. Falling ALE = "improving" in the UI (lower exposure is good).

## Files

| File | Role |
| --- | --- |
| `usecases/risk-snapshot.ts` | capture (idempotent) + cleanup + history/trend reads. |
| `usecases/risk-velocity.ts` | pure trend + computeVelocity. |
| `jobs/risk-snapshot-jobs.ts` (+ registry/schedules/types) | daily cron. |
| `prisma/schema/compliance.prisma` + migration | two models + RLS. |
| `api/t/[slug]/risks/{velocity,portfolio-trend,[id]/history}` | reads. |
| `risks/dashboard/VelocityCard.tsx` + `[riskId]/RiskHistoryPanel.tsx` | UI. |
