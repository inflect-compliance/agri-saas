# 2026-07-03 — SWR-hybrid instant nav (ported from inflect-compliance #1365 + #1366)

**Commit:** `perf(swr): instant nav via Router Cache + hover-warm detail SWR cache`

## Design

agri-saas already had the Epic-69 SWR-hybrid data layer (SSR-first list +
`useTenantSWR` background revalidation). This ports the two "instant app feel"
performance PRs from the upstream inflect-compliance platform — the layer that
removes the perceptible latency on navigation and list→detail clicks — onto
agri-saas's ag surfaces.

**Two independent, fully-reversible levers:**

1. **Instant navigation via the client Router Cache (upstream #1366).** The hot
   app routes are `force-dynamic` (per-tenant auth + URL filters), so their
   default client Router Cache stale time is 0 — every back/forward or
   re-navigation re-runs the full server RSC render (the ~0.5s "not instant"
   feel), even though the SSR list query is already `cachedSsrPayload`-cached.
   - `next.config.js`: `experimental.staleTimes.dynamic = 30` (`static = 180`)
     — a prefetched/visited dynamic RSC stays in the client router cache for
     30s, so re-navigation renders from cache. The Epic-69 SWR layer still
     revalidates the *data* on mount/focus, so the list is never more than one
     fetch stale.
   - `nav-item.tsx`: `prefetch` on the sidebar `<Link>` forces a full-RSC
     prefetch (not just the loading-boundary slice Next prefetches by default
     for dynamic routes), so the *first* click is served from cache too. The
     sidebar is always in the viewport → every hot route warms on mount.

2. **Hover-warm the detail SWR cache (upstream #1365).** `usePrefetchTenant()`
   — the prefetch companion to `useTenantSWR` — SWR-`preload`s a tenant path
   under the exact key the detail page reads. Wired into the DataTable's new
   `onRowPrefetch` (fires once per row on pointer-enter, deduped by row id) on
   the entity list pages, alongside the existing `router.prefetch`. Hovering a
   row warms both the route RSC and the detail data, so the click renders
   instantly from cache instead of spinning.

## Files

| File | Role |
|---|---|
| `next.config.js` | `staleTimes` client Router Cache config |
| `src/components/layout/nav-item.tsx` | `prefetch` on the sidebar link |
| `src/lib/hooks/use-tenant-swr.ts` | `usePrefetchTenant()` hook |
| `src/components/ui/table/data-table.tsx` | `onRowPrefetch` prop + hover mechanism |
| `src/components/layout/EntityListPage.tsx` | forwards `onRowPrefetch` to DataTable |
| list clients (locations / tasks / journal / …) | wire `onRowPrefetch` → warm each detail's SWR key |

## Decisions

- **Two cache layers, expiring in lockstep.** `staleTimes.dynamic = 30` mirrors
  the `cachedSsrPayload` SSR TTL, so the Router Cache and SSR cache expire
  together and the SWR layer covers data freshness on top. No page refactor.
- **Prefetch key must match the detail page's `useTenantSWR` key exactly** —
  the warmed entry is only a hit if the absolute URL is identical. Lists whose
  rows don't lead to an id-keyed SWR detail page are left unwired (a mismatched
  preload is wasted work).
- **The table primitive stays router-free.** `onRowPrefetch` fires a
  consumer-provided callback (the consumer holds `useRouter`), so a DataTable
  still renders without an app-router context. Hover dedup is a `useRef<Set>`.
- **Virtualized tables (>1000 rows) don't hover-warm** — entity lists render
  well under the threshold and take the standard `<Table>` path the mechanism
  attaches to; the rare virtualized case simply falls back to normal fetch.
