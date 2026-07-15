# 2026-07-15 — Trends → News tab (roadmap prompt 3/3)

**Status:** approved (design), implementing.
**Shape:** two PRs, mirroring #303 (backbone) + #305 (UI).

## Problem

The Trends page (`/t/[slug]/trends`) shipped in #305 with two tabs: **Prices**
(fully built) and **News** — a 26-line `EmptyState` placeholder whose own
docstring says *"a real, minimal section the later 'market news' PR fills in."*
This is the outstanding third prompt of the trends roadmap. Build the News tab:
a unified, category-tagged feed of Bulgarian agricultural news.

## Decisions (from brainstorming)

1. **Content** — one unified feed; every item tagged **Market** / **Policy** /
   **General**; user can filter by category.
2. **Source** — aggregate **free RSS/Atom feeds** from Bulgarian agri outlets +
   ДФ Земеделие + EC agri press. Bulgarian-native (no translation), no API cost.
3. **Tagging** — **feed default category + deterministic BG+EN keyword
   override** (pure, unit-testable — no AI). Policy keywords
   (`субсидия/ДФЗ/CAP/плащания/регламент`) and market keywords
   (`цена/реколта/износ/борса/пазар`) promote; else the feed's default.
4. **Refresh** — daily pull; **60-day retention** (job prunes older rows).
5. **Workspace** — git worktree off `origin/main`; the `feat/cadastre-vector-parcels`
   branch and its staged revert stay untouched.

## Architecture (mirrors the prices backbone exactly)

```
Daily job                 Global cache table         Read path               UI
market-news-pull    →     MarketNewsItem        →    getMarketNews()   →    NewsTab.tsx
 ├ rss-client.ts          (no tenantId — public,     trends usecase          (replaces the
 ├ feeds.ts (registry)     like MarketPriceSeries)    GET /trends/news        placeholder)
 └ categorize.ts                                       (Redis 1h cache)
```

Everything **global / tenant-agnostic** — news is public reference data,
identical for every tenant. No `tenantId`, no RLS (same class as `SoilSample`,
`MarketPriceSeries`).

## Data model — `MarketNewsItem` (new, `prisma/schema/market.prisma`)

| Field | Type | Purpose |
|---|---|---|
| `id` | `String @id @default(cuid())` | pk |
| `source` | `String` | feed slug (`agri-bg`, `dfz`, `ec-agrifood`) |
| `category` | `String` | `market` \| `policy` \| `general` |
| `title` | `String` | headline |
| `summary` | `String?` | short RSS excerpt (sanitised, plain text) |
| `url` | `String` | canonical article link (tap-through) |
| `imageUrl` | `String?` | optional enclosure/media image |
| `publishedAt` | `DateTime` | RSS `pubDate` — feed order |
| `guidHash` | `String @unique` | `sha256(guid‖link)` — idempotent upsert + dedupe |
| `fetchedAt` | `DateTime @default(now())` | last seen by the pull |
| `createdAt` | `DateTime @default(now())` | first seen |

Indexes: `@@unique([guidHash])`, `@@index([category, publishedAt])`,
`@@index([publishedAt])`. No `tenantId` ⇒ no RLS, no tenant-index guard.

## PR1 — News data backbone

- **`src/lib/news/feeds.ts`** — curated `{ slug, url, defaultCategory }[]`
  registry (BG ag outlets + ДФЗ + EC agri press). Optional `MARKET_NEWS_FEEDS`
  env (JSON) overrides the list for prod tuning; feeds are public URLs, no secret.
- **`src/lib/news/rss-client.ts`** — fetch + parse RSS 2.0 / Atom into
  normalised items. Bounded (timeout, max items/feed), per-feed fail-soft (one
  dead feed never fails the batch). XML parsed via `fast-xml-parser` if not
  already a dep (audit-clean, no native build) — resolved at implementation.
- **`src/lib/news/categorize.ts`** — pure
  `categorize(title, summary, feedDefault): NewsCategory`. BG+EN keyword
  dictionaries; unit-tested like `price-parse.ts`.
- **`src/app-layer/jobs/market-news-pull.ts`** — daily: fetch every feed →
  categorize → idempotent upsert on `guidHash` → prune `publishedAt` older than
  60 days. Injectable `deps` seam (fetch + db) so integration tests drive it
  without network. Registered in `executor-registry.ts`, `types.ts`
  (`JobPayloadMap` + `JOB_DEFAULTS`), `schedules.ts` (daily cron).
- **`getMarketNews(ctx, { category?, limit=50 })`** appended to
  `usecases/trends.ts` — bounded `take`, `publishedAt desc`, optional category
  filter; Redis-cached 1h.
- **`GET /api/t/[slug]/trends/news?category=&limit=`** → `{ items }`.
- **`trends.schemas.ts`** — `NewsCategory` enum + `TrendNewsQuerySchema`.
- **`CACHE_KEYS.trends.news(category)`** SWR key.

Guard bumps in the same diff: `infrastructure-guards` job count 26→27 + add
`'market-news-pull'` to the expected-names set; register the job as global in
`job-scope-audit` + `job-tenant-isolation-regression`; `no-direct-prisma`
allowlist entry for `market-news-pull.ts` if jobs are scanned (read path is
already covered via `trends.ts`). Tests: `categorize`, `rss-client` (fixture
XML), `getMarketNews` usecase, `market-news-pull` integration.

## PR2 — News tab UI

Replace `NewsTab.tsx` placeholder with:
- `<TabSelect>` category filter — **All / Market / Policy / General**.
- A card feed: category `<StatusBadge>` tag, title as external link
  (`target=_blank rel="noopener noreferrer"`), source name, relative published
  time via `formatDate`, optional thumbnail.
- States: loading skeleton, empty (with an operator hint about feed config,
  matching the Prices tab's unconfigured-vs-empty pattern), error.
- Mobile-first 390px; add the News tab to the `/trends` horizontal-drift e2e.
- Data via `useTenantSWR(CACHE_KEYS.trends.news(category))`.
- `trends.news.*` i18n keys in **both** en + bg (category labels, empty/error
  copy, "read more"/source line).

Tests: rendered (renders items, category filter switches, empty/error states,
no raw English string in the bg render), e2e drift.

## Non-goals

- No translation pipeline (Bulgarian sources are already Bulgarian).
- No per-item AI classification.
- No admin CRUD surface (feeds are code/env config, not user-managed).
- No changes to the Prices tab or `MarketTrendsWidget`.
