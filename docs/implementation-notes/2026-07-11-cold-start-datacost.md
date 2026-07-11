# 2026-07-11 — Cold-start data cost (Roadmap-6 P3)

**Commit:** `<pending> perf(cold-start): persist SWR cache, ETag/304 hot reads, cursor-paginate journal`

## Problem

Every PWA cold start refetched the whole farm. Three compounding costs
on rural LTE:

1. **Memory-only SWR cache.** No persistence provider → a relaunch
   (or an OS tab eviction) refetched every list from scratch.
2. **Zero conditional revalidation.** No ETag/304 anywhere under
   `src/app/api`, so every focus/reconnect revalidation re-downloaded
   the full JSON body even when nothing had changed.
3. **Fetch-all payloads.** The journal list served a flat `take:200`
   of deeply-nested rows (parcel + product + operation includes) on
   first paint. Cursor pagination was built (`listPaginated`,
   `useCursorPagination`) but unwired.

## Design

### 1. Per-tenant persistent SWR cache

`src/lib/swr/persistent-cache.ts` builds a Map for SWR's `provider`
option, hydrated from disk:

- **localStorage (small/fast)** — hydrated SYNCHRONOUSLY at
  construction, so SWR paints from cache on the first render.
- **IndexedDB (large/durable)** — async best-effort backfill for
  buckets above the ~1.5 MB localStorage budget. Unavailable → silent
  no-op, never a crash.
- **Self-eviction** — each bucket carries a schema `v`
  (`SWR_CACHE_VERSION`) + write timestamp; a stale (>24h) or
  wrong-version bucket is dropped on read.

`src/components/providers/SWRPersistenceProvider.tsx` mounts one
`<SWRConfig>` at the root of `providers.tsx`, KEYED by the tenant slug
parsed from the pathname. A tenant switch remounts it with a fresh Map
hydrated from THAT tenant's bucket — one tenant's cached rows can never
surface under another on a shared device. Non-tenant routes use a
`global` bucket.

### 2. ETag / 304 on hot read GETs

`src/lib/http/etag.ts` — one reusable seam. `jsonWithETag(req, payload)`
serializes once, computes a weak ETag (`cyrb53` content hash + byte
length), honors `If-None-Match` with a bodyless `304`, and sets
`Cache-Control: private, no-cache` (store-but-always-revalidate — the
304 short-circuits the payload). Wired into the journal, farm-tasks,
locations, and exchange-listings list GETs. The browser attaches
`If-None-Match` automatically, so SWR's revalidations get cheap 304s
with no client changes.

### 3. Journal cursor pagination

- `page.tsx` server-renders only the first bounded page
  (`JOURNAL_PAGE_SIZE = 50`) via `listLogEntriesPaginated`.
- The route's paginated branch emits the `{ rows, nextCursor }` shape
  `useCursorPagination` consumes.
- `JournalClient` keeps the SWR-keyed first page (per active filters,
  bounded to 50) and drives "Load more" through `useCursorPagination`.
  A content-signature effect reseeds the accumulator (`reload`, added
  additively to the hook) when the first page changes — a filter
  switch, a revalidation returning different rows, or an optimistic
  offline-create prepend — without a component remount that would drop
  filter-toolbar focus.

Farm-tasks got ETag/304 + client-side `useThresholdLoadMore` windowing
(the sibling tenant-table pattern). A true server cursor for its
merged FARM_TASK + FIELD_OPERATION queue (re-sorted by due date) isn't
well-defined without a repository redesign — deferred.

## Files

| File | Role |
| --- | --- |
| `src/lib/http/etag.ts` | Weak-ETag + 304 helper (`jsonWithETag`) |
| `src/lib/swr/persistent-cache.ts` | Per-tenant disk-backed SWR cache provider |
| `src/components/providers/SWRPersistenceProvider.tsx` | Mounts `<SWRConfig>` keyed by tenant |
| `src/app/providers.tsx` | Wraps the tree in the persistence provider |
| `src/components/ui/hooks/use-cursor-pagination.ts` | Added `reload()` reseed method |
| `src/app/.../journal/{page.tsx,JournalClient.tsx}` | Server-seed page 1 + cursor "Load more" |
| `src/app/.../farm-tasks/FarmTasksClient.tsx` | Threshold windowing + load-more footer |
| `src/app/api/t/[tenantSlug]/{journal,farm-tasks,locations,exchange/listings}/route.ts` | `jsonWithETag` on list GETs |

## Decisions

- **Weak (not strong) ETag.** The tag asserts semantic equivalence of
  the JSON list; hashing the serialized body (not promising octet
  equality through compression) is the right contract. `cyrb53` +
  byte-length is a zero-dependency, sync, low-collision change detector
  that runs in both Node and Edge runtimes.
- **localStorage-first, IndexedDB-backfill.** SWR's `provider` must
  return a cache SYNCHRONOUSLY; IndexedDB has no sync API. localStorage
  gives instant first-paint hydration (and is testable in jsdom); IDB
  is the durable large-payload tier layered async on top.
- **`SWRConfig key={tenant}` for isolation + eviction.** Remounting on
  tenant switch is the simplest correct isolation boundary — a fresh
  Map per tenant, no cross-tenant key bleed, and the previous tenant's
  in-memory cache is dropped.
- **SWR page-1 + accumulator reseed (not a full client rewrite).**
  Keeping the filter-keyed SWR entry for page 1 preserves the existing
  filter + offline-optimistic behaviour (and the offline-create e2e);
  `reload()` bridges it to the cursor accumulator without remounting
  the filter toolbar.
- **Flat `/journal` (no params) still returns an array.** The offline
  outbox replay + any consumer hitting the bare endpoint depend on it;
  only the `?limit`/`?cursor` branch returns `{ rows, nextCursor }`.
