# 2026-07-13 — MECHANISATOR operator role (sprayer persona)

**Commits:** foundation (`feat(rbac): add MECHANISATOR role`) + experience
(`feat(operator): mechanisator "My work" screen + lockdown`).

## Design

A new built-in `Role.MECHANISATOR` — a restricted machine-operator / sprayer
persona that sees ONLY its "My work" screen (open assigned jobs) and completes
them, offline-capable. Built-in (not `TenantCustomRole`) because the defining
behavior is *route/navigation lockdown*, which needs a stable named identity
(`ctx.role === 'MECHANISATOR'`) uniform across tenants.

The lockdown is three layers, of which the middleware is load-bearing
(permissions are too coarse — a single `canRead` — to allow-list one entity's
reads):

1. **Middleware route-guard** (`src/middleware.ts` → pure `isOperatorAllowedPath`
   in `src/lib/auth/guard.ts`). Resolves the membership matching the URL slug
   (NOT the primary `token.role`) and, if MECHANISATOR, redirects any other
   page to `/t/{slug}/my-work` and 403s any non-task API. Allowlist: the
   `my-work` + `field/*` pages; the `farm-tasks` / `field-operations` / `tasks`
   APIs.
2. **Stripped app shell** — `AppShell operator` mode renders no sidebar, drawer,
   or bottom-tab bar; `TopChrome operator` renders brand + account menu only
   (no switcher, bell, breadcrumbs, or mobile-menu button). Selected by role in
   the tenant `(app)/layout`.
3. **Minimal permissions** — `getPermissionsForRole('MECHANISATOR')` returns
   tasks-only (`tasks.view+edit`, everything else false); coarse tier is
   read-only. API backstop.

## The "My work" screen

`/t/{slug}/my-work` — the operator's OPEN assigned jobs (`?open=1` filters to
`OPEN/TRIAGED/IN_PROGRESS/BLOCKED`, excluding done + `PENDING_REVIEW`) as big
tap targets. A **field operation** deep-links to the existing offline
parcel-marking panel (`/field/{taskId}`) — which already does offline,
optimistic, conflict-aware, big-touch completion; this feature gives that
orphaned surface its in-app entry point. A **farm task** is completed inline
via a "Mark done" that routes through `useOfflineSync().submit()` (network-first,
outbox fallback) → `RESOLVED` (reopenable, safer than terminal `CLOSED` for
field fat-fingers).

## Task completion authorization

`setTaskStatus` gained an assignee self-serve rule: the operator ASSIGNED to a
task may change its status without general write permission — mirroring the
`markOperationParcel` rule that already governs FIELD_OPERATION parcel marking.
So a canWrite-less MECHANISATOR completes its own jobs; the coarse `canWrite`
gate still applies to everyone else.

## Files

| File | Role |
| --- | --- |
| `prisma/schema/enums.prisma` + migration | `Role.MECHANISATOR` |
| `src/lib/permissions.ts` | explicit minimal tasks-only arm |
| `src/lib/{auth,tenant-context}.ts`, `auth/entra-role-mapping.ts` | numeric role maps + `canRead` |
| admin members/invites routes + `tenant-admin.ts` + pickers | grantable |
| `src/lib/auth/guard.ts` | `isOperatorAllowedPath` (pure allowlist) |
| `src/middleware.ts` | operator route-guard |
| `src/components/layout/{AppShell,TopChrome}.tsx` | `operator` stripped mode |
| `src/app/t/[tenantSlug]/(app)/layout.tsx` | derives `operator` from the tenant membership |
| `src/app/t/[tenantSlug]/(app)/my-work/*` | the screen |
| `src/app-layer/usecases/farm-task.ts` + farm-tasks route | `openOnly` filter |
| `src/app-layer/usecases/task.ts` | assignee self-serve completion |

## Decisions

- **Built-in role, not custom** — see Design.
- **Middleware resolves the per-slug membership**, not `token.role` (which is
  the primary membership only and may not match the tenant being visited).
- **RESOLVED, not CLOSED**, for the inline farm-task done — reopenable, gentler
  on field mistakes; `completedAt` is set either way (feeds the tasks trend).
- **`isOperatorAllowedPath` extracted pure** — the allowlist is unit-tested
  without the Edge runtime, mirroring `checkTenantAccess`; the E2E suite covers
  the NextResponse wiring.
- **Two PRs** — a self-contained RBAC foundation (role exists + is grantable +
  minimal permissions, inert until assigned) then the behavioral experience +
  lockdown.
