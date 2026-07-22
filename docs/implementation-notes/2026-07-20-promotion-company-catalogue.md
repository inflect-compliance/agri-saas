# 2026-07-20 — Promotions: a first-class supplier catalogue

**Commit:** `<pending>` feat(promotions): extract Company from the free-text string, add the draft gate

First of a planned sequence for the "support uploads product promotions" flow.
This PR is the **data model** only — no admin UI, no image pipeline, no lead
digest. Those depend on this shape being right.

## Why a table and not a string

`Promotion.company` was a bare `String`. A supplier runs repeat campaigns, so
its identity has to outlive any single promotion, and a string can't carry one:

- **Identity forked silently.** "Syngenta", "syngenta " and "  Syngenta" were
  three unrelated advertisers. For support typing this from an email, that is a
  matter of when, not if.
- **There was nowhere to put the contact address.** The chosen lead-delivery
  design (a digest job emailing the advertiser) needs somewhere durable to send
  to. Per-promotion contact fields would mean re-typing it every campaign and
  having no answer for "which address is current".

`Company.nameKey` — lowercased, trimmed, whitespace-collapsed — is the dedup
key, with a unique index as the actual guarantee. `companyNameKey()` is how
callers compute it; the migration reimplements the same normalisation in SQL on
purpose, because a migration must not depend on application code.

## Two privacy classes in one row

This is the part worth reviewing carefully.

- **Public**: `name`, `eik`, `websiteUrl`, `logoUrl`. The name renders in every
  tenant's offers feed. The ЕИК is commercial-register data for a legal entity —
  unlike `Lease.lessorEik`, which is often a natural person and *is* encrypted.
- **Internal, encrypted**: `contactName`, `contactEmail`, `contactPhone`,
  `notes`. A named individual's work contact details are personal data, and
  support notes routinely mention people.

`listActivePromotions` joins **only** `company.name`. The encrypted fields must
never reach a tenant-facing DTO.

### The global-KEK trap

`Company` is global (no `tenantId`) but is WRITTEN by support operating *inside*
the platform tenant — so `ctx.tenantId` is set, and the Epic B middleware would
have happily encrypted global supplier contacts under that one tenant's DEK.

That would bind global data to a tenant's key: the digest job could only decrypt
while running in that tenant's context, and changing `PLATFORM_TENANT_SLUG` or
rotating that tenant's DEK independently would orphan every supplier's contact
address.

So the middleware's existing `model === 'Tenant'` special case is generalised
into `GLOBAL_KEK_MODELS = { Tenant, Company }`. The rule is written at the
declaration: a model with no `tenantId` belongs there if any field is encrypted;
a tenant-scoped model must never be added, since it would lose per-tenant key
isolation.

## The draft gate

`publishedAt` is new, and it is a second gate rather than a replacement for the
validity window:

- `publishedAt` — editorial. Null means draft, invisible however the dates read.
- `validFrom` / `validTo` — the campaign window.

Both must pass. Before this, **insert was publish**: a half-finished row with
blank dates went live in every tenant's feed immediately, which is the likeliest
way support ships an unfinished ad. `createPromotionLead` now also refuses leads
against an unpublished promotion — the card isn't in the feed, so such a request
can only come from a stale page.

Scheduling and expiry already worked; they needed nothing.

## Migration

Order-sensitive and written to be correct on a **populated** dev/demo database,
not just on production (which holds zero promotions):

1. Create `Company`.
2. Backfill one row per distinct normalised name, keeping the earliest spelling
   as the display name.
3. Add `companyId`, point every promotion at its supplier, *then* `SET NOT NULL`
   and drop the old column.
4. `publishedAt` backfilled from `createdAt` for existing rows — leaving them
   null would have silently unpublished every live offer.

Verified against a scratch database seeded with the failure case: three spelling
variants of "Syngenta" collapsed to one supplier, "Syngenta BG" correctly stayed
separate, and every row came out published.

Backfilled ids are uuids, not cuids — cuid can't be generated in SQL. A blank
supplier name parks under an explicit `__unknown__` placeholder rather than
failing the migration or inventing a name; in practice it matches zero rows,
since `company` was `NOT NULL`.

## Also in this PR

- **`@@index([validTo])`** — the active-window predicate was scanning unindexed.
- **The seed is now composable and wired in.** `seedPromotions(prisma)` follows
  the `importUnits` shape and is called from `prisma/seed.ts` + `seed:demo`.
  This closes the sibling half of the dead-catalogue defect fixed for AgriEvent
  in #341 — `/offers` was empty in every environment for the same reason.
  Contact addresses in the seed are `@example.com` deliberately: the digest job
  will email `contactEmail`, and a demo row with a real address would mail a
  real supplier about a campaign they never bought.
- **`company.ts`** — the write seam. `sanitizeCompanyInput` is the single point
  both create and update route through (the `parcel-lease.ts::mapLeaseData`
  pattern), because two paths that sanitise independently are how the journal's
  two creation paths drifted apart. It exists in this PR rather than the UI PR
  because the sanitiser-coverage guardrail correctly refuses a new encrypted
  model with no proven write path, and parking `Company` in `KNOWN_UNCOVERED` is
  exactly what that ratchet's own comment warns against.

## Decisions

- **`deliveredAt` deferred.** It belongs to the digest PR; adding it here would
  have been a column with no reader.
- **Demo seed data is plaintext at rest.** Seed scripts build a raw
  `PrismaClient` with no encryption extension, as every existing seed does. This
  is safe: the middleware's decrypt path skips values without a `v1:`/`v2:`
  envelope, so plaintext passes through, and any write through the app encrypts
  it. Verified in the code rather than assumed.
- **`ON DELETE RESTRICT`** on the promotion → company FK. Deleting a supplier
  that still has campaigns should fail loudly, not cascade away its promotions.

## Next

1. Platform-tenant gate (`PLATFORM_TENANT_SLUG`, failing closed) + the support
   admin CRUD for companies and promotions, with audit carrying a real `userId`.
2. Image pipeline — inline AV scan, canvas re-encode, `promotions/<id>.webp`,
   and rendering `mediaUrl` on the offers card (nothing renders it today).
3. Lead digest — the leads inbox, the daily job, `deliveredAt`, and a
   `PROMOTION_CREATE_LIMIT` preset.

Two smaller follow-ups noted while here: `/offers` has an unconditional nav
entry and can be empty (the same dead-link bug `/events` just had), and
`listActivePromotions` silently truncates at 100 with no pagination.
