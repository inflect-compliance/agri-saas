# 2026-07-04 — Exchange write flows (create offer + inquiry)

**Commit:** `<pending> feat(exchange): create offer + cross-tenant inquiry (notify + email)`

## Design

Adds the write half of the marketplace on top of the browse UI: post an
offer, express interest in someone else's offer (which notifies + emails the
seller), and manage both sides.

```
create offer   CreateOfferModal → POST /exchange/listings
                 createListing stamps sellerTenantId = ctx.tenantId,
                 derives region geo from regionCode (bulgaria-regions).
express interest InquiryModal (from the detail Sheet) → POST /exchange/inquiries
                 createInquiry commits the inquiry (inquirer ctx) THEN, fail-open:
                   • Notification.createMany in the SELLER's tenant context
                     (withTenantDb(sellerTenantId) — Notification is RLS-forced)
                   • sendInquiryEmail to the seller's OWNER/ADMIN members
                     (the ONE cross-tenant channel; email auto-decrypts)
manage          /exchange/my-listings   listMyListings + respondToInquiry (ACCEPT/DECLINE)
                                        withdraw (undo-toast) / fulfill
                /exchange/my-interests  listInquiriesByInquirer (buyer outbox)
```

Sub-routes (not in-page tabs) under the existing group `layout.tsx` gate; an
`ExchangeNav` link bar switches between Browse / My listings / My interests.

## Files

| File | Role |
|---|---|
| `schemas/exchange.schemas.ts` | NEW — Create/Inquiry/Respond/ListingStatus Zod |
| `lib/email/inquiry-email.ts` | NEW — fail-open "new interest" email (invite-email shape) |
| `usecases/exchange.ts` | `createInquiry` seller fanout; +`respondToInquiry` / `listMyListings` |
| `repositories/exchange.ts` | +`getInquiry` / `updateInquiryStatus` / `listListingsBySeller` |
| `api/.../exchange/{listings POST, listings/[id] PATCH, inquiries POST+GET, inquiries/[id] PATCH, my-listings GET}` | write + management routes |
| `exchange/{CreateOfferModal,InquiryModal,ExchangeNav}.tsx` | create + inquiry + sub-nav |
| `exchange/{my-listings,my-interests}/{page,*Client}.tsx` | management views |
| `lib/exchange/public-listing.ts` | +`toPublicInquiry` projection |

## Decisions

- **Cross-tenant Notification uses `withTenantDb(sellerTenantId, …)`** — the
  inquiry commits in the inquirer's context; writing the seller-tenant
  Notification there would be rejected by RLS `WITH CHECK`. The fanout runs
  AFTER commit in a try/catch that only logs — a notify/email failure can
  never roll back the inquiry (matches the invite-route fail-open idiom).
- **Email is the only sanctioned cross-tenant channel.** Notification +
  email carry the sanitized message; contact details are revealed only when
  the seller chooses to respond (the mediated-inquiry privacy model).
- **Privacy projection is exact + tested.** `toPublicListing` exposes only the
  16 coarse fields (lat/lon are the REGION centroid, never parcel geometry);
  a test asserts the exact key set and bans geometry/terms/owner-id fields.
- **`respondToInquiry` reuses the ownership invariant** — only the inquiry's
  listing seller tenant may ACCEPT/DECLINE, and only while PENDING.
- **Withdraw uses the Epic-67 undo-toast** (reversible status flip); fulfill /
  accept / decline are direct PATCH + optimistic refetch.
- **Commodity Combobox is seeded + free-text** via `onCreate`; region Combobox
  drives regionCode (the server derives name/lat/lon from the catalogue).
