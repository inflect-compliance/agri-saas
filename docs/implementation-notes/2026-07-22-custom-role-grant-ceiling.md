# 2026-07-22 — Custom roles: you cannot grant what you do not hold

**Commit:** `<pending>` fix(rbac): custom roles cannot grant permissions the grantor lacks

Closes the two gaps `2026-07-21-custom-role-owner-escalation.md` recorded as
**not covered**. That PR fixed a specific hole; this fixes the class it belonged
to.

## The class

`admin.manage` gates custom-role CRUD. Without a ceiling, that single permission
is effectively a grant of **every** permission in the system: an ADMIN mints a
role carrying whatever they like and assigns it to themselves. #353 stopped the
two OWNER-only keys; nothing stopped the pattern.

The ceiling is now the **grantor's own effective permissions** — checked at all
three write points:

| where | why it needs its own check |
|---|---|
| `createCustomRole` | the blob is first defined here |
| `updateCustomRole` | otherwise an ADMIN creates a within-bounds role and immediately edits it upward |
| `assignCustomRole` | a role can outlive the permissions of whoever hands it out — an OWNER may legitimately create a role an ADMIN must not distribute, and a grantor's own permissions can shrink after the role was written |

Compared against `ctx.appPermissions`, the caller's EFFECTIVE set, so the
property holds transitively: a role obtained *through* a custom role cannot be
used to mint a stronger one.

## Why the grantor, not the base role

The obvious alternative — cap at the role's `baseRole`, making custom roles
subtract-only — was rejected for the same reason as in #353, and it is worth
restating because it is the crux:

**Granting an EDITOR-based role a report export that the ADMIN genuinely holds
is the entire point of custom roles.** A base-role cap forbids that. A grantor
cap forbids only escalation, which is the actual threat. A test pins the
distinction in both directions: tailoring up to the grantor passes, and every
key the grantor holds stays grantable.

Revocations are always allowed — setting something false that the grantor holds
is not escalation, so only `=== true` is inspected.

## The property test (#53)

Before this, `admin-permissions.test.ts` pinned only the STATIC
`getPermissionsForRole` path, so it passed happily while an ADMIN held an
escalated key through a custom role. The two keys found in #353 were found by
hand.

The sweep is the fix for that: for ADMIN, EDITOR and READER, every key across
every domain in `PERMISSION_SCHEMA` that the role does *not* hold must be
reported as exceeding. Any future permission key is covered on the day it is
added, with no test edit.

A companion assertion runs the other direction — every key ADMIN *does* hold
stays grantable — so the ceiling cannot be "fixed" into a blanket ban without
failing.

## Files

| File | Role |
|------|------|
| `src/lib/permissions.ts` | `permissionsExceeding(requested, grantor)` — the pure comparison. |
| `src/app-layer/usecases/custom-roles.ts` | `assertWithinGrantorPermissions` wired into create / update / assign. |
| `tests/unit/custom-role-grant-ceiling.test.ts` | The ceiling's behaviour + the swept property. |

## Still not covered

- The ceiling is enforced in the usecase layer. A future code path that writes
  `TenantCustomRole.permissionsJson` directly — a script, a seed, a migration —
  bypasses it. The read-time forcing from #353 still neutralises the OWNER-only
  keys in that case, but nothing neutralises a general over-grant written
  straight to the row.
- `scopesToPermissions` (the API-key path) has no equivalent ceiling, but it
  does not need one: scopes map through a fixed `SCOPE_ACTION_MAP` rather than
  an arbitrary blob, and #353 pinned that it cannot reach the OWNER-only keys.
