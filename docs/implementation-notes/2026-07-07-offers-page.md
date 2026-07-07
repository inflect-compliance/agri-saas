# 2026-07-07 — Offers page (company promotions feed)

**Prompt:** #12 — an "Offers" (Промоции) nav surface: a scrollable feed of
company promotions, each with an "Ask for offer" lead form. Lead-gen only
(no billing, no provider portal, no live third-party APIs).

## Design

Two new models, both **global** (no RLS), mirroring existing precedent:

- `Promotion` — a GLOBAL catalogue with **no `tenantId`** (like `Unit` /
  `AgriEvent`). Every tenant reads the same shared promotions feed. Seeded /
  admin-posted. `category` is a curated String
  (culture/fertilizer/seeds/products/service).
- `PromotionLead` — captured on "Ask for offer". Mirrors `ExchangeInquiry`:
  `inquirerTenantId` is a **plain FK to Tenant.id, NOT a tenantId RLS column**,
  so the row is not tenant-scoped and needs no RLS. A
  `@@unique([promotionId, inquirerTenantId])` caps a tenant to one lead per
  promotion (a P2002 surfaces as a friendly `conflict`).

Because neither model has a real `tenantId`, neither is registered in
`TENANT_SCOPED_MODELS` and the `rls-coverage` guard leaves both alone — the
same treatment `AgriEvent` and `ExchangeInquiry` get.

Read path (`listActivePromotions`) filters the optional validity window
(`validFrom <= now <= validTo`, either bound nullable), orders newest-first,
and is bounded by a clamped `take`. The lead path (`createPromotionLead`)
commits the lead first inside the tenant transaction, then fires a
**best-effort, fail-open** confirmation notification for the requesting user
(promotions are global with no provider tenant, so the confirmation is the
whole notify surface until a provider portal exists).

The page is a plain server-component feed (`<ul>` of cards, like the events
page) — not a `DataTable`/`ListPageShell` list — so the Epic 52 list-page
ratchets don't apply. Each card's "Ask for offer" button is a `'use client'`
child (`AskForOfferModal`) cloned from the Exchange `InquiryModal`.

## Files

| File | Role |
| --- | --- |
| `prisma/schema/promotions.prisma` | `Promotion` + `PromotionLead` models (global, no RLS) |
| `prisma/migrations/20260707170000_promotions/migration.sql` | Tables + indexes + FK (no RLS) |
| `src/app-layer/schemas/promotions.schemas.ts` | `CreatePromotionLeadSchema` |
| `src/app-layer/usecases/promotions.ts` | `listActivePromotions` + `createPromotionLead` + fail-open notify |
| `src/app/api/t/[tenantSlug]/offers/leads/route.ts` | POST lead (inquiry rate limit) |
| `src/app/t/[tenantSlug]/(app)/offers/page.tsx` | Server feed page |
| `src/app/t/[tenantSlug]/(app)/offers/AskForOfferModal.tsx` | Client lead modal (clone of InquiryModal) |
| `src/components/layout/SidebarNav.tsx` | "Offers" nav item (reuses `Coins` glyph) |
| `messages/en.json` · `messages/bg.json` | `ag.offers` block (EN + BG) |
| `scripts/seed-promotions.ts` | Idempotent demo promotions |
| `tests/unit/agriculture-usecases.test.ts` | usecase-test-coverage import assertion |

## Decisions

- **Global, no-RLS Promotion (not nullable-tenantId catalog-RLS).** Promotions
  are a single shared supplier feed with no per-tenant private rows, so the
  simpler `AgriEvent` shape (no tenantId at all) fits — no
  `SINGLE_POLICY_EXCEPTIONS` registration, no asymmetric policy to maintain.
  If per-provider private promotions are ever needed, migrate to the
  `KnowledgeChunk` nullable-tenantId single-policy form.
- **Lead notify = confirmation to the requester, not a cross-tenant blast.**
  Unlike the Exchange inquiry (which emails the seller tenant's admins), a
  promotion has no owning tenant, so there is no seller to notify. The lead
  row itself is the durable artefact a sales team would query; the user gets a
  fail-open "request sent" confirmation. A provider portal + provider
  notification is the clear future seam.
- **Reused `EXCHANGE_INQUIRY_LIMIT` (scope `offers-lead`).** A lead triggers a
  notification write, so it gets the same burst cap as the inquiry endpoint
  rather than the looser default mutation limit.
- **`Coins` nav glyph.** Reuses an already-imported lucide icon (deals /
  pricing register) to satisfy the no-new-lucide guard.
