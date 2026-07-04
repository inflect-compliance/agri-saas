# 2026-07-04 — Exchange listing lifecycle + deep-linking

**Commit:** `<sha>` feat(exchange): EXPIRED sweep + single-listing GET/deep-link

## Design

Two functional gaps the Exchange MVP left open.

### 1. The EXPIRED sweep

`ExchangeListingStatus.EXPIRED` and the `@@index([status, expiresAt])` were
built for a sweep that never existed — an ACTIVE listing past its `expiresAt`
is hidden from browse (the read filter excludes it) yet lingers ACTIVE forever
in the seller's my-listings. `src/app-layer/jobs/exchange-expiry-sweep.ts`
(modelled on `exception-expiry-monitor`'s Phase-1) finds ACTIVE rows whose
expiry has elapsed, flips each **atomically** (prior-state predicate so a
concurrent withdraw/fulfil/renew is never clobbered), and emits one
`status_change` audit row per transition scoped to the row's `sellerTenantId`.
Bounded batch (500), oldest-first. Registered daily at 05:00 UTC in
`schedules.ts` + wired in `executor-registry.ts`. Global sweep (Exchange has no
tenant axis) → added to the `job-scope-audit` exemption list.

### 2. Single-listing GET + deep-link

The browse feed only holds the current page, so a shared/emailed link to one
listing couldn't resolve. `GET /api/t/[slug]/exchange/listings/[listingId]` →
`getListing` usecase → `toPublicListing` projection (404 if missing),
module-gated. `ExchangeClient` seeds its selection from `?listing=<id>` at mount
and, if that id isn't on the loaded page, fetches it standalone and opens the
detail Sheet. The seller inquiry email/notification now deep-links to the
specific listing on the seller's management page
(`/exchange/my-listings#listing-<id>` — native anchor scroll; the card carries
the matching `id`).

## Files

| File | Role |
|---|---|
| `src/app-layer/jobs/exchange-expiry-sweep.ts` | the sweep (ACTIVE→EXPIRED + audit) |
| `src/app-layer/jobs/{types,schedules,executor-registry}.ts` | payload + 05:00 schedule + executor |
| `src/app/api/.../exchange/listings/[listingId]/route.ts` | new `GET` (public projection, 404) |
| `src/app/t/.../exchange/ExchangeClient.tsx` | `?listing=` deep-link fetch + open Sheet |
| `src/app/t/.../exchange/my-listings/MyListingsClient.tsx` | `id="listing-<id>"` anchor target |
| `src/app-layer/usecases/exchange.ts` | inquiry link deep-links to the listing |

## Decisions

- **Global sweep, not per-tenant.** Exchange tables carry no `tenantId`; the
  sweep scans all ACTIVE-past-expiry rows and scopes each audit row by the
  row's own `sellerTenantId`. Hence the `job-scope-audit` exemption.
- **Atomic per-row flip** (updateMany keyed on the prior state) over a bulk
  updateMany so each transition gets its own audit row and a concurrent
  withdraw/fulfil is never overwritten.
- **Seller email → my-listings, not the browse Sheet.** The browse Sheet is
  read-only; the seller needs to Accept/Decline, which lives on my-listings.
  A native `#listing-<id>` anchor avoids extra JS.
- **`selectedId` seeded from the deep link via the `useState` initialiser**
  (not a setState-in-effect) — the effect only performs the fetch.
