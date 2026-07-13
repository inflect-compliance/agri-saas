# 2026-07-13 — Dashboard tasks trendline (created vs completed)

**Commit:** `<sha> feat(dashboard): tasks created-vs-completed trendline`

## Design

A new always-shown dashboard card, `TasksTrendCard`, plots two daily series
over the last 14 days — farm tasks **created** and **completed** — using the
shared Epic-59 `TimeSeriesChart` primitive (two `<Areas>` series + a compact
inline legend with running totals).

Data flows through the existing dashboard read seams:

```
TasksTrendCard (SWR: CACHE_KEYS.dashboard.taskTrend)
  → GET /api/t/:slug/dashboard/task-trend?days=14
    → getFarmTaskTrend(ctx, days)              (usecase, farm-task.ts)
      → WorkItemRepository.farmTaskTrendRows()  (bounded findMany on Task)
```

Farm tasks are `Task` rows with `type IN (FARM_TASK, FIELD_OPERATION)`.
`completedAt` is set only on RESOLVED / CLOSED (never CANCELED), so a non-null
`completedAt` is exactly "completed work" — the completed series counts by it.

## Files

| File | Role |
| --- | --- |
| `src/app-layer/repositories/WorkItemRepository.ts` | `farmTaskTrendRows(db, ctx, since)` — bounded `{createdAt, completedAt}` rows for farm tasks created/completed since the window start |
| `src/app-layer/usecases/farm-task.ts` | `getFarmTaskTrend(ctx, days)` — buckets rows into daily created/completed counts (UTC days), pre-seeded at zero; clamps `days` to [7, 60] |
| `src/app/api/t/[tenantSlug]/dashboard/task-trend/route.ts` | GET endpoint (mirrors the compliance-trends route shape) |
| `src/lib/swr-keys.ts` | `dashboard.taskTrend()` key |
| `src/app/t/[tenantSlug]/(app)/dashboard/TasksTrendCard.tsx` | the card — two-series chart + legend + loading/empty states |
| `src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx` | mounts the card above the module-gated ag strip |
| `messages/{en,bg}.json` | `dashboard.taskTrend.*` copy |

## Decisions

- **Bucket in JS, not SQL.** A bounded `findMany` selecting only the two
  timestamps for the window, bucketed in the usecase, avoids a raw
  `date_trunc` query (and its RLS/timezone caveats). Bounded by `take: 5000`
  — a single farm's N-day task volume sits far below it; the cap only guards
  the dashboard read against a pathological tenant.
- **UTC calendar days.** Simple and deterministic for a 14-day trend; a
  per-tenant timezone offset would be a follow-up if operators report drift
  around midnight.
- **A task created before the window but completed inside it** counts only in
  the completed series (the `OR` on both timestamps fetches it; the created
  bucket for its day is out of range so it's skipped). A task both created and
  completed in-window counts once in each series, on its respective day.
- **Always shown.** Tasks aren't module-gated, so the card renders for every
  tenant, collapsing to a one-line empty state when the window had no activity
  (and a skeleton while the read is in flight).
- **Metric = created vs completed** (operator's choice) rather than
  throughput or backlog — surfaces both intake and clearance on one card.
