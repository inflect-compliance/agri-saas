# 2026-07-19 — Rent: expiry deep-link, live KPI card, one expiry clock

**Commit:** `<pending>` feat(rent): deep-link expiry alerts to /rent, revalidate the KPI card, unify the expiry window

## Design

Three rent-page correctness fixes (roadmap prompt A of 3):

1. **Deep-link** — the daily `lease-expiry-sweep` notification pointed at
   `/t/{slug}/reports` (the compliance SoA page). It now deep-links to the Rent
   register, scoped to the parcel's location when it has one — the same
   `/rent?locationId=` URL the location page already links.
2. **Live KPI card** — `RentRollCard` owned its own `/reports/rent-roll` SWR
   that no RentClient mutation revalidated, so totals went stale and the card
   never appeared after the first lease. The SWR is lifted into RentClient and
   revalidated alongside `/leases` on save / undo-commit / pull-to-refresh; the
   card is now presentational.
3. **One expiry clock** — the feature had three disagreeing windows (sweep 30,
   table badge 60, card/report 90) and an ad-hoc 14-day red cutoff. A single
   `src/lib/agro/lease-expiry.ts` now owns them, and one `leaseExpiryTier()`
   drives every badge so the table row and the card agree by construction.

## The expiry-window fork (decision)

Kept **three named horizons** rather than collapsing:

| Constant | Value | Role |
|----------|-------|------|
| `ALERT_DAYS` | 30 | red tier **and** the sweep's notification window |
| `WARN_DAYS` | 60 | amber tier |
| `REPORT_DAYS` | 90 | "expiring soon" horizon for the roll / card / exports |

**Rationale:** the three windows encode genuinely different questions —
*"alert me"* (30), *"warn me"* (60), *"what's on my 90-day horizon"* (90). What
was broken wasn't having three, it was that the **badge tones** were ad-hoc
(14-day red, 60-day amber) and disagreed between the table and the card.
Routing every badge through `leaseExpiryTier(daysLeft) → expired|alert|warn|ok`
+ `LEASE_EXPIRY_TONE` makes them identical functions of `daysLeft`. Bonus
coherence: because the sweep alerts at `ALERT_DAYS` (30), the moment the
notification fires the row + card badges turn red — one story. The old 14-day
red cutoff is gone (a 25-day lease is now red, matching the alert).

## Files

| File | Role |
|------|------|
| `src/lib/agro/lease-expiry.ts` | **New** — `ALERT/WARN/REPORT_DAYS`, `leaseExpiryTier`, `LEASE_EXPIRY_TONE`, `daysUntil`. Server-safe (no client imports). |
| `src/app-layer/jobs/lease-expiry-sweep.ts` | Selects `parcel.locationId`; `linkUrl` → `/t/{slug}/rent[?locationId=]`; window ← `ALERT_DAYS`. Dedupe key unchanged (PRESERVE). |
| `src/app-layer/usecases/rent-roll.ts` | Default expiring window ← `REPORT_DAYS`. |
| `src/app/api/t/[tenantSlug]/reports/rent-roll/route.ts` + `src/app-layer/reports/pdf/rent-roll.ts` | Hardcoded `90` → `REPORT_DAYS`. |
| `src/components/ui/map/RentRollCard.tsx` | Presentational (`data` + `hasLeases` props); zero-state when leases exist but none active; shared badge. |
| `src/app/t/[tenantSlug]/(app)/rent/RentClient.tsx` | Lifts the rent-roll SWR; revalidates it on save/undo-commit/pull-to-refresh; badge via shared classifier. Optimistic-undo delete unchanged (PRESERVE). |
| `messages/{en,bg}.json` | New `ag.rentRoll.noActive`. |
| `tests/e2e/mobile/horizontal-drift.spec.ts` | `rent` added to `PAGES`. |
| `tests/unit/lease-expiry-sweep.test.ts` | **New** — locks the `linkUrl` shape (+ dedupeKey). |
| `tests/rendered/rent-client.test.tsx` | **New** — modal-open, shared-clock badge, card-key revalidation on save. |

## Decisions

- **Lift the SWR, don't global-mutate the key.** Passing `data` down keeps the
  card a pure function of props (testable) and avoids matching `useTenantSWR`'s
  internal tenant-scoped key string from RentClient.
- **`hasLeases` distinguishes zero-state from no-data.** The card can't tell
  "no leases" from "all expired" from rent-roll data alone (both give
  `activeLeaseCount === 0`), so RentClient — which holds the full `/leases`
  list — passes the boolean. `null` is reserved for the true no-data case.
