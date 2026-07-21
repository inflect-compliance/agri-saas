# 2026-07-21 — Custom roles could grant OWNER-only permissions

**Commit:** `<pending>` fix(rbac): custom roles cannot grant OWNER-only permissions

Started as a cosmetic cleanup — `admin/roles/page.tsx` kept a hand-copied
`PERMISSION_SCHEMA` that had drifted from the canonical one. Checking whether
the "fix" was safe found that the drift was the only thing hiding a live
privilege-escalation path.

## The escalation

Every link verified in the code, not inferred:

1. **`parsePermissionsJson` had no ceiling.** It seeded from the base role's
   defaults, then `domainResult[action] = obj[domain][action]` — any stored
   `true` won. The docblock framed the base role as a fallback for *missing*
   fields, never as a cap.
2. **`validatePermissionsJson` checked shape only** — presence, boolean type,
   no unexpected keys. It never inspected values.
3. **Custom-role CRUD is gated on `admin.manage`**, which every ADMIN holds
   (`roles/route.ts`, `[roleId]/route.ts`). `assignCustomRole` has no
   self-assignment guard and no "cannot grant what you don't hold" check.
4. **`requirePermission` reads `ctx.appPermissions`** →
   `checkPermissions(ctx.appPermissions, …)` — the exact set step 1 produced.

So an ADMIN could POST a custom role with
`{ admin: { tenant_lifecycle: true, owner_management: true } }` and `baseRole:
"ADMIN"`, assign it to themselves, and clear the guards on:

- `POST /admin/rotate-dek` and `/admin/tenant-dek-rotation`
  (`requirePermission('admin.tenant_lifecycle')`)
- OWNER invitation and OWNER removal
  (`ctx.appPermissions.admin.owner_management` in `tenant-admin.ts`,
  `tenant-invites.ts`)

That is the whole OWNER/ADMIN boundary Epic 1 exists to draw — tenant deletion,
DEK rotation, ownership transfer.

`VALID_BASE_ROLES` excluding OWNER did **not** contain it: that guard protects
role-enum checks, while every OWNER-only gate reads the uncapped
`appPermissions`.

## Why nobody noticed

The UI never rendered the checkboxes. `roles/page.tsx` built its grid from a
local `PERMISSION_SCHEMA` copy whose `admin` row was
`['view','manage','members','sso','scim']`.

The timeline shows drift, not intent: the page's copy landed `7017577d`
(2026-04-18); `tenant_lifecycle` / `owner_management` were added to
`permissions.ts` six days later in `f9da88ea`. The page was never updated, and
carries a `// must match src/lib/permissions.ts PERMISSION_SCHEMA` comment that
has been false since.

The payload never came from that copy — form state is seeded from
`getPermissionsForRole(...)` and submitted whole, so the hidden keys rode along
pinned at their preset value (always `false`, since presets exclude OWNER).
**The UI could not produce `true`, and that was load-bearing and entirely
accidental.**

Which is why exporting the constant — the original task — would have converted a
curl-only escalation into a one-click one.

## The fix

Both directions, because either alone leaves a gap:

- **Write-time.** `validatePermissionsJson` rejects the OWNER-only keys set
  `true`, so the database never stores an escalating blob.
- **Read-time.** `parsePermissionsJson` forces them `false` regardless. Without
  this, rows written *before* the guard keep their escalation across a deploy —
  the guard would protect only future writes.

`OWNER_ONLY_PERMISSIONS` names them in one place, consumed by both.

**Deliberately not a blanket cap.** Intersecting custom roles with their base
role was the obvious bigger hammer, and it is wrong here: custom roles exist to
tailor, and granting an EDITOR an extra right is legitimate. Since
`VALID_BASE_ROLES` excludes OWNER, no custom role can *legitimately* need these
two — so denying exactly them is precise rather than blunt. A test asserts
ordinary tailoring still validates.

## Then the original task, safely

`PERMISSION_SCHEMA` is now exported and imported by the roles editor; the
duplicate is gone. The OWNER-only cells **render, but locked**, with a tooltip
explaining why. Hiding them is what let this sit for three months — the grid
should say the keys exist and are not yours to grant. The lock is signage; the
server refuses them either way.

## The other producer of `appPermissions` — audited, safe

`parsePermissionsJson` is not the only path. An API-key request builds its set
from `scopesToPermissions(scopes)` in `api-key-auth.ts`. Audited: **not
vulnerable.**

- `SCOPE_ACTION_MAP.admin` is `{ read: ['view'], write: ['manage','members',
  'sso','scim'] }` — neither OWNER-only key appears, and the loop only sets
  actions it finds in the map.
- The `'*'` shortcut returns `getPermissionsForRole('ADMIN')`, where both are
  `false`.

But it is safe the same *way* the UI was: by omission from a hand-maintained
list. Adding `tenant_lifecycle` to the admin write scope, or pointing the
wildcard at OWNER, would grant it with nothing to stop it. So it is now pinned
by tests that sweep every entry in `VALID_SCOPES` individually, all of them at
once (for combination effects), and the wildcard specifically — with a positive
control asserting the wildcard really is broad, so the negative assertions
cannot pass vacuously.

## Not covered

- **`assignCustomRole` still has no "cannot grant what you don't hold" check.**
  This PR closes the specific OWNER-only hole, not the general class. An ADMIN
  can still mint a role granting anything inside the ADMIN envelope and assign
  it to anyone — defensible, since it is all within their own authority, but it
  is not a *checked* property.
- There were **no** pre-existing tests asserting a custom role cannot exceed its
  base role. `admin-permissions.test.ts` pins `ADMIN → tenant_lifecycle: false`
  for the static `getPermissionsForRole` path only, so it passed happily while
  an ADMIN held the key via a custom role.
