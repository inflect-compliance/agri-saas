# 2026-07-16 — News interests + "For You" tab

**Status:** approved, implementing.

## Problem
Let users personalise the News feed. Introduce **interests** (chosen keywords)
and a **"For You"** tab that shows only news matching any of them.

## Decisions (from brainstorming)
1. **Storage** — server-side, per user, **tenant-scoped** (`UserInterest` with
   RLS). Syncs across the user's devices. Cross-*tenant* sync is a non-goal
   (fits the RLS-by-tenant model; farmers are usually single-tenant).
2. **Manage** — a **modal** ("Edit interests") opened from the For You tab; a
   chip editor (removable keyword chips + add box).
3. **Filtering** — **client-side**: For You fetches the `all` feed and keeps
   items matching *any* interest keyword (title/summary/source), same instant
   approach as the keyword search, which composes on top.
4. **Persistence API** — **PUT-replace** the whole keyword set.

## Data model — `UserInterest` (auth.prisma, tenant-scoped, RLS)
```prisma
model UserInterest {
  id        String   @id @default(cuid())
  tenantId  String
  userId    String
  keyword   String   // normalized: trimmed, lowercased
  createdAt DateTime @default(now())
  user   User   @relation("UserInterestOwner", fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant @relation("TenantUserInterest", fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, userId, keyword])
  @@index([tenantId, userId])
}
```
Migration mirrors `parcel_lease`: CREATE + indexes + FKs + the RLS `DO $$` block
(`tenant_isolation` + `tenant_isolation_insert` + `superuser_bypass`, FORCE RLS).
Back-relations added to `User` + `Tenant`.

## API (self-service, under the tenant tree)
- `GET /api/t/[slug]/me/interests` → `{ keywords: string[] }`
- `PUT /api/t/[slug]/me/interests` (body `{ keywords: string[] }`) → replaces,
  returns the normalized set.
- `usecases/user-interests.ts`: `getUserInterests(ctx)` / `setUserInterests(ctx,
  keywords)` via `runInTenantContext`, filtered by `(tenantId, userId)`. Normalize:
  trim, lowercase, drop empties, dedupe, cap keyword length (50) + count (20).
  Self-service (own preference) — no role-permission gate; `getTenantCtx` auth +
  RLS + userId filter is the isolation. Add to `api-permission-coverage`
  `EXCLUDED_ROUTES` if the guard flags it.
- `CACHE_KEYS.interests()` SWR key.

## UI — News page (`NewsTab`)
- **"For You"** becomes the FIRST option in the category tab bar:
  `[ For You | All | Market | Policy | General ]`.
- When selected: `useTenantSWR` interests + the `all` news feed; keep items
  matching any interest keyword. The keyword search box still filters on top.
- **"Edit interests"** button (shown on the For You tab) opens a `<Modal>` with a
  chip editor: removable chips + an add input (Enter or "Add"); Save → `PUT` →
  `mutate`. Cancel discards.
- **Empty interests** → an empty state inviting the user to add their first
  interest (opens the modal).
- `trends.news.forYou.*` i18n in en + bg (tab label, edit button, modal title +
  add placeholder + save/cancel, empty states).

## Tests
- Unit: `setUserInterests` normalization (mocked `runInTenantContext`).
- Integration: `UserInterest` RLS + PUT-replace CRUD (real DB, auto-skips w/o one).
- Rendered: For You tab filters by interests, composes with search, empty-interests
  state, modal add/remove/save wiring.

## Non-goals
- Cross-tenant interest sync. Server-side keyword search over the whole news
  table (client-side over the loaded feed is sufficient for the bounded feed).
