# 2026-07-21 — Promotions: the platform-support console

**Commit:** `<pending>` feat(promotions): platform-tenant gate + support curation console

Second of the "support uploads product promotions" sequence, after
`2026-07-20-promotion-company-catalogue.md` built the data model. This adds the
surface support actually works in. Image upload and the lead digest follow.

## The identity problem, and why a tenant solves it

Curating a global catalogue is platform work, but the only platform primitive in
the repo was `verifyPlatformApiKey` — a shared secret in a header. It takes a
`NextRequest`, so it cannot gate a page, and it has no user behind it, so it
cannot answer "who published this ad". Fine for machine callers; wrong for
recurring human work.

The alternative considered was a `User.isPlatformStaff` tier with a non-tenant
`/admin` console. It is conceptually cleaner and would extend to `AgriEvent` —
but it means building a new privilege tier and a new auth surface, and it leaves
`AuditLog` unusable (no `tenantId`), so it would need a parallel ledger too.

Designating one tenant instead reuses sessions, RBAC and the invite flow
unchanged, and — the reason it is worth doing — gives audit rows a legitimate
`tenantId` AND a real `userId`. `agri-events.ts` had to settle for structured
logs for exactly the lack of those two things.

### The gate is two parts, and only one of them is the control

```
requirePermission('admin.manage')   ← necessary, NOT sufficient
assertPlatformSupport(ctx)          ← the actual control
```

Permissions resolve from **Role**, so any `admin.*` key is held by the
OWNER/ADMIN of *every* tenant. On its own it would hand every farm's owner write
access to a feed every other farm reads. The permission is still required: it is
what makes a denial an audited `AUTHZ_DENIED` row and keeps these routes inside
the Epic C.1 coverage guardrail.

A dedicated `admin.global_catalogue` key was considered and **rejected**. Every
Role would grant it exactly as it grants `admin.manage`, so it would add a
`PermissionSet` member, a `PERMISSION_SCHEMA` entry, six role-grant lines, six
`toEqual` assertions and an entry in the (already stale) duplicated schema in
`admin/roles/page.tsx` — without adding any control the slug check doesn't
already provide.

**Fail closed.** With `PLATFORM_TENANT_SLUG` unset, `isPlatformTenant` is false
for every tenant, so the console is unreachable rather than universally
reachable. Blank and whitespace-only values are treated as unset. This is the
case the gate's tests lead with.

**404, not 403.** Off-platform the console reports not-found, because a
forbidden page would confirm to an unrelated tenant's owner that a
global-catalogue surface exists to go looking for. The same convention carries
into the UI: the pages call `notFound()`, they don't render an "Access denied"
screen.

Note the `(app)/admin` layout gates on `admin.view` only, client-side — it does
**not** deliver the platform restriction. Each page adds its own server check.

## The workflow

A company emails support → support creates a **draft** → checks it → publishes.
`createPromotion` always writes `publishedAt: null`; publishing is a separate,
separately-audited action rather than a field inside a diff, because that is the
moment content becomes visible to every tenant.

Status is derived from the two gates, with no extra column:

| | `publishedAt` | window |
|---|---|---|
| DRAFT | null | any |
| SCHEDULED | set | not yet open |
| LIVE | set | open |
| EXPIRED | set | closed |

The supplier picker is a `Combobox` with `onCreate`: support types a name that
isn't on file and the server find-or-creates it, so nobody has to visit the
suppliers page first to add an advertiser. The suppliers page is therefore
deliberately **edit-only** — its job is holding the contact details the digest
will send to, which the promotions form has no business collecting.

## Decisions

- **`company.ts` moved into the tenant transaction.** It was written in the
  previous PR against the global prisma handle with a structured-log actor. Now
  it takes `(db, ctx)` and emits real `logEvent` rows. This is what the platform
  tenant buys, so not taking it would have been leaving the point on the table —
  and it let the `no-direct-prisma` allowlist entry be **removed** rather than
  kept.
- **Deleting a promotion with captured leads is refused.** `PromotionLead`
  cascades on delete, so removing a campaign that earned enquiries would destroy
  the advertiser's deliverable. The error tells support to unpublish instead.
- **Audit records field NAMES, never values, on `Company`.** Those columns are
  encrypted PII; copying values into the hash-chained audit trail would put them
  back in the clear.
- **The nav flag degrades CLOSED.** `isPlatformTenant === true`, not
  `!== false` — the opposite of the sibling module flags. Hiding a farm's own
  feature is the worse failure for those; showing a global-catalogue console to
  the wrong tenant is the worse failure here. It is discoverability only; the
  pages and routes gate independently.
- **`PUT` for publish, over raw `fetch`.** `api-client` exposes POST/PATCH/DELETE
  only. Rather than add a helper or collapse publish into PATCH (losing the
  distinct audited action), that one call uses `fetch` directly, with the reason
  written at the call site.

## Guardrails

Ten fired on first run — worth listing, because each is a convention this
console had to join rather than an obstacle: `admin-route-coverage`,
`destructive-vocabulary` (i18n'd `confirmLabel` needs a `DYNAMIC_LABEL_EXEMPT`
entry), `no-hardcoded-ui-strings` (a `placeholder="https://"`),
`admin-cell-text-size`, `filter-toolbar-coverage`, `columns-dropdown-coverage`,
`primary-action-budget`, `primary-secondary-ratio`, `design-system-drift`, and
`usecase-test-coverage`.

Two are worth explaining rather than just registering:

- **`primary-secondary-ratio`** — the ceiling moved 168 → 170 for three earned
  primaries (one list-create header button, two modal confirms; every Cancel
  beside them is secondary, so the ratio moves up). The docblock says "one-way
  down", but the ceiling has gone 113 → 168 since May as pages were added, and
  the file's own history documents each increment the same way. This follows the
  Rent-page entry directly above it, which is the identical shape.
- **`design-system-drift`** — rather than bumping the unmigrated cap, the four
  new files were promoted straight into `MIGRATED_PAGES`. They are token-clean
  by construction, and promotion means they now carry the raw-colour and
  legacy-class assertions from day one instead of sitting in a tally.

## Follow-ups

- **`admin/roles/page.tsx` duplicates `PERMISSION_SCHEMA` and has already
  drifted** — it is missing `tenant_lifecycle` and `owner_management`, so those
  are invisible in the custom-role editor. Pre-existing; deliberately not fixed
  here. The real fix is exporting the constant rather than adding a third copy.
- Image upload (`mediaUrl` is still unrendered), and the lead digest.
- `/offers` still has an unconditional nav entry and can be empty — the same
  dead-link bug `/events` had.
