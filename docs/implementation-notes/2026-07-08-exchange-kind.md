# 2026-07-08 — Exchange typed product kind + kind filter

**Prompt:** #11 — let users buy/sell culture / fertilizer / seeds / products in
the Exchange and filter by product type. The Exchange had `side` (BUY/SELL) +
free-text `commodity` + region, but no product-class dimension.

## Design

Added an `ExchangeKind` enum (`CULTURE | FERTILIZER | SEEDS | PRODUCT`) and a
non-null `ExchangeListing.kind` column (default `CULTURE`, so existing listings
backfill to crops). Wired it end-to-end:

- **Create** — `CreateOfferModal` gains a `kind` `RadioGroup` (mirrors the
  `side` field); `CreateListingSchema` validates `z.nativeEnum(ExchangeKind)`;
  the route threads `body.kind`; `createListing` stamps it + records it in the
  audit `after`.
- **Browse** — a `kind` filter def (multi-select) joins the Epic-53 filter bar.
  Filtering is client-side over the fetched array (as `side`/`commodity`/
  `region` already are), so the single `filtered` memo now also drops
  non-matching kinds — which narrows **both the list and the map** (the map
  renders that same `filtered` array). `ExchangePublicListing`/`toPublicListing`
  carry `kind`; the list row shows a kind badge.

## Files

| File | Role |
| --- | --- |
| `prisma/schema/enums.prisma` · `exchange.prisma` · migration | `ExchangeKind` + `kind` column (backfill CULTURE) |
| `src/app-layer/schemas/exchange.schemas.ts` | `kind` in `CreateListingSchema` |
| `src/app-layer/usecases/exchange.ts` | `CreateListingInput.kind` + create data + audit |
| `src/app-layer/repositories/exchange.ts` | `ListingFilters.kind` + where clause |
| `src/lib/exchange/public-listing.ts` | `kind` on row + DTO projection |
| `src/app/api/.../exchange/listings/route.ts` | thread `body.kind` |
| `src/app/.../exchange/filter-defs.ts` | `kind` filter def |
| `src/app/.../exchange/CreateOfferModal.tsx` | `kind` RadioGroup + reset + POST |
| `src/app/.../exchange/ExchangeClient.tsx` | kind filter branch + list badge |
| `messages/en.json` · `messages/bg.json` | kind labels (EN + BG) |

## Decisions

- **Map marker colouring left as-is (by side), not recoloured by kind.** The
  Exchange map was *just* rewritten from MapLibre to a bespoke Canvas renderer
  (#197/#198) that colours markers by SELL/BUY. Recolouring it by kind would
  fight that fresh design decision and risk conflicts with the agent that owns
  it. The kind **filter** already achieves "filter the map by product type"
  (the map shows only the filtered kinds); a kind-colour legend on the Canvas
  is a clean follow-up if wanted (`EXCHANGE_SIDE_COLORS` shows the export
  pattern to mirror).
- **`kind` NOT NULL with default CULTURE.** Existing seeded listings are crops,
  so CULTURE is the correct backfill; a required field keeps the create form
  honest (the RadioGroup defaults to CULTURE).
- **Global table, no RLS/index churn.** `ExchangeListing` is a global no-RLS
  table, so `kind` triggers no rls-coverage / FK-index guardrail; the
  `@@index([kind, status])` is perf-only. `CreateListingSchema` is not a
  registered OpenAPI schema, so no snapshot regen.
