# 2026-07-04 — Exchange write-path hardening

**Commit:** `<sha>` fix(exchange): harden the write path against bad input & abuse

## Design

The Exchange tables (`ExchangeListing`, `ExchangeInquiry`) are GLOBAL — no
`tenantId`, no RLS — because tenants must read each other's offers. That makes
the **app layer the only guard** on writes. This PR closes five holes that a
GLOBAL, FREE-plan-available marketplace exposes:

1. **Input validation → clean 400, never a Prisma 500.** `exchange.schemas.ts`
   previously accepted any string for `quantityTonnes` / `pricePerTonne`
   (`z.union([z.number(), z.string()])`), so `"abc"` passed Zod and only blew
   up at the `Decimal` column; there was no upper bound (Decimal overflow) and
   `expiresAt` could be in the past. A `boundedDecimal(min,max)` coercer now
   accepts a number OR a strict numeric string (`/^\d+(\.\d{1,3})?$/`) and
   returns a bounded finite number — `quantityTonnes` `(0, 1e6]`,
   `pricePerTonne` `[0, 1e7]`. `priceCurrency` is an enum (`BGN|EUR|USD`,
   default `BGN`); `expiresAt` must be a **future** ISO datetime.

2. **Inquiry dedup.** New `@@unique([listingId, inquirerTenantId])` — a tenant
   may inquire on a listing at most once. `createInquiry` catches the `P2002`
   and rethrows a friendly `conflict(...)` instead of a 500.

3. **Per-tenant ACTIVE-listing quota** — the real spam control, since the
   EXCHANGE module is FREE. New `exchange_listing` GatedResource in
   `entitlements.ts` (FREE 5, TRIAL/PRO 50, ENTERPRISE unlimited), counting
   ACTIVE listings by `sellerTenantId`. `assertWithinLimit` at the top of
   `createListing`; self-hosted stays unlimited (resolves to ENTERPRISE, no
   DB count).

4. **Route rate limits.** `EXCHANGE_LISTING_CREATE_LIMIT` (20/min) on
   `POST /exchange/listings` and the tighter `EXCHANGE_INQUIRY_LIMIT` (10/min)
   on `POST /exchange/inquiries` (it triggers cross-tenant email fanout), wired
   via the `withApiErrorHandling({ rateLimit })` option.

5. **Bounded fanout.** `notifySellerOfInquiry` dropped `take: 5000` → `take: 25`,
   dedupes recipients by email, and sends via `Promise.allSettled` (one slow
   SMTP call no longer serializes the rest). Still fail-open — the inquiry is
   already committed.

## Files

| File | Role |
|---|---|
| `src/app-layer/schemas/exchange.schemas.ts` | `boundedDecimal` coercer; currency enum; future-`expiresAt` refine |
| `prisma/schema/exchange.prisma` | `@@unique([listingId, inquirerTenantId])` |
| `prisma/migrations/20260704120000_exchange_inquiry_dedup_unique/` | defensive de-dup + unique index |
| `src/lib/billing/entitlements.ts` | `exchange_listing` resource + limits + count |
| `src/lib/security/rate-limit.ts` | two Exchange presets (re-exported via `rate-limit-middleware`) |
| `src/app-layer/usecases/exchange.ts` | quota gate, P2002→conflict, bounded/deduped fanout |
| `src/app/api/.../exchange/{listings,inquiries}/route.ts` | wire the rate-limit presets |

## Decisions

- **Coerce to `number`, not keep as string.** The bounds (1e6 / 1e7 with ≤3 dp)
  sit far inside `Number.MAX_SAFE_INTEGER`, so precision is exact and the usecase
  hands Prisma a clean number.
- **Kept the redundant `@@index([listingId])`** alongside the new unique
  (which already leads with `listingId`). Dropping it would need a `DROP INDEX`
  in the migration for no runtime gain; redundant-but-harmless is cheaper and
  keeps the migration a single `CREATE UNIQUE INDEX`.
- **Migration de-dupes first** (keep earliest per listing+inquirer) so the
  unique index can be created even if repeat inquiries already exist.
- **Quota counts only ACTIVE** listings — WITHDRAWN / FULFILLED / EXPIRED free
  up the budget, matching the "open offers on the shared feed" intent.
