# 2026-07-19 — Promotions: an honest surface, and THE FORK

**Commit:** _(this PR)_ `feat(promotions): gate the nav, tell the truth, unify the term`

Prompt A of a 3-prompt roadmap. Makes the `/offers` surface stop lying **now**,
and records the decision that gates the rest of the roadmap.

## THE FORK — decision: **FINISH IT**

The question was whether to finish the promotions feature (Prompts B + C) or
retire it and its insurance-leads twin.

### Evidence gathered before deciding

Measured against the live production database and the code, not intuition:

| Signal | Finding |
|---|---|
| `Promotion` rows (prod) | **0** |
| `PromotionLead` rows (prod) | **0** — never used, so no PII at risk |
| `InsuranceLead` rows (prod) | **0** |
| Readers of `PromotionLead` | **none** — create-only dead-end |
| `scripts/seed-promotions.ts` wiring | **orphaned** — no entrypoint runs it |
| Tenants (prod) | **1** |
| Code surface | promotions **557 LOC**, insurance twin **178 LOC** |

So the feature has never delivered value, cannot be populated (no writer), and
its leads have no destination. On the technical evidence alone, RETIRE was the
cheaper and safer read: it would delete a lying, empty surface *and* the latent
PII/RLS liabilities in one move, with zero data loss.

### Why FINISH anyway

The decision was escalated rather than taken unilaterally, because the missing
input is not in the repo: whether there are **suppliers lined up** to populate
the catalogue and receive leads. That is a commercial fact, not a code fact.
The product owner chose FINISH.

**Consequence:** Prompts B and C are in scope. The pre-requisite recorded here
is that real suppliers must exist, or the surface ships empty again — the nav
gate below means it will at least ship *silently* empty rather than dishonestly.

### Insurance twin — scoped IN, deferred

`src/app-layer/usecases/insurance.ts` has the identical dead-end shape (a
create-only lead table, 0 rows, no reader). FINISH covers it in principle, but
this PR does not touch it: Prompt B's governance work (consent, encryption,
RLS, delivery) is the same work for both, and doing it once for promotions
first establishes the pattern. **Carry-over: apply the B-series treatment to
`InsuranceLead`, or retire it, before either is considered done.** It remains a
create-only PII table with no RLS until then.

## What shipped here

### 1. The nav no longer links to an empty page

`Promotion` is a GLOBAL catalogue (no `tenantId`), so "is there anything to
show?" is one tenant-independent probe. It resolves in the tenant layout
alongside the existing plan / module lookups — **not** in nav render, which
would be a query per navigation.

This deliberately **mirrors `hasUpcomingAgriEvents`**, which landed for the
sibling global catalogue (#15) while this work was in flight. Agri-events and
promotions are the same problem — a permanent nav entry over impermanent
global content — and shipping a second, differently-shaped solution for it
would have been the worse outcome. So: probe in the usecase, lazy `globalDb()`,
in-process memo + TTL, `invalidatePromotionsCache()` for curation writes, and
the same `!== false` gate shape.

```
tenant layout (server)          promotions.ts
  Promise.all([                   activeWhere(now)  ← one predicate
    getTenantPlan,                    ↑          ↑
    getAvailableModules,   listActivePromotions  hasActivePromotions (memoised)
    hasUpcomingAgriEvents,
    hasActivePromotions,   ]) ──────────────────────────────┘
        ↓
  TenantProvider{ promotionsAvailable }
        ↓
  SidebarNav: visible: tenant.promotionsAvailable !== false
```

The active-window predicate is shared deliberately: two copies of "active"
would let the nav link outlive the content it points at, which is the exact
bug being fixed.

**Gate polarity.** An earlier draft failed CLOSED (`=== true`) on the reasoning
that showing a dead link is the bug being fixed. It now matches its sibling's
`!== false` instead: the flag is always set by the layout, so the two are
identical in every real environment, and two ADJACENT data-driven nav gates
behaving differently on the same edge case is a maintenance trap worth more
than the theoretical difference. The memo TTL means a cached `true` can briefly
outlive the last expiring promotion — harmless, because the page still renders
its own empty state.

### 2. The confirmation stops making promises

The lead notification claimed two things that were false:

- _"The supplier will get back to you"_ — nothing notifies a supplier.
  `Promotion` is global with no provider tenant.
- _"You can track requests from the Offers page"_ — `PromotionLead` has no
  reader; there is no such view.

The modal's `ask.description` made the **same** supplier-follow-up promise
(„доставчикът ще се свърже с вас"), which the cited line numbers didn't cover
but the acceptance criterion did. Both are now plain receipts.

It was also hardcoded English, in a table that stores literal text — so a
Bulgarian farmer received an English notification, permanently. Fixed via a new
`translateFor(locale, key, params)` that resolves against the **recipient's**
persisted `User.uiLanguage`, not the ambient request locale. That distinction
is the whole point: a notification is addressed to someone, and next-intl's
request-scoped helpers would have used the language of whoever triggered the
write.

### 3. One Bulgarian term

Sidebar „Оферти" vs page „Промоции" → **„Промоции"** everywhere (en:
"Promotions"), matching the page and the promotions domain.

## Files

| File | Role |
|---|---|
| `src/lib/i18n/server-messages.ts` | **new** — `translateFor(locale, key, params)`; explicit-locale translation outside request scope |
| `src/app-layer/usecases/promotions.ts` | shared `activeWhere` predicate + memoised `hasActivePromotions` / `invalidatePromotionsCache`; truthful, recipient-localised notification |
| `src/app/t/[tenantSlug]/layout.tsx` | resolves `promotionsAvailable` server-side, in the existing `Promise.all` |
| `src/lib/tenant-context-provider.tsx` | carries `promotionsAvailable` |
| `src/components/layout/SidebarNav.tsx` | data-driven nav gate + „Промоции" |
| `offers/AskForOfferModal.tsx` | passes `{company}` to the rewritten description |
| `messages/{en,bg}.json` | `leadNotification.*`, honest `ask.description`, unified term |

## Decisions

- **Follow the sibling, don't invent a second pattern.** `hasUpcomingAgriEvents`
  landed mid-flight solving the identical problem; this adopts its shape wholesale
  (usecase-owned probe, `globalDb()`, memo + TTL + invalidator, `!== false` gate)
  rather than shipping a competing `src/lib/*-server.ts` variant.
- **Memoise the probe.** The answer depends only on the catalogue and the clock,
  while the tenant layout is `force-dynamic` — without the memo this would be one
  query per navigation per user across the fleet.
- **Existence probe, not a count.** `findFirst` + `select: { id }` — the gate
  only needs "≥ 1", and a count on a global catalogue would grow with it.
- **One predicate, two callers.** The alternative (duplicate the where-clause)
  is how a nav link and its page drift apart.
- **Translate at write time, not render time.** The correct fix is
  `Notification` storing a key + params and translating at display, so the text
  follows the reader's *current* language. That is a schema + every-writer +
  every-reader change, disproportionate here — and `exchange.ts` /
  `insurance.ts` have the identical hardcoded-English bug, so the shared helper
  is the seam that makes fixing them later cheap. Recorded as the known limit:
  language is frozen at write time.
- **Simple `{param}` interpolation only, no ICU.** Notification copy is short
  and pre-formatted; anything needing plural/select should render through
  next-intl at display time instead.
- **The insurance twin is deferred, not ignored** — see above. It is still a
  create-only PII table with no RLS.
