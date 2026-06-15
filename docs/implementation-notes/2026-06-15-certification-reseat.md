# 2026-06-15 — Certification Reseat (ag Certification over the IC compliance engine)

**Commit:** `<sha>` feat(certification): reseat the compliance domain as ag Certification

## Design

Phase 6 (#31) gated the IC compliance domain behind the `CERTIFICATION`
module. Phase 7 turns it back ON for tenants that enable it, **reseated as
agriculture "Certification"** — with minimal new schema (one enum value)
and mostly vocabulary + a thin facade.

```
Certification Scheme  ─is─a→  Framework (kind = AG_SCHEME)   [GLOBAL catalog, no tenantId]
Scheme requirement    ─is─a→  FrameworkRequirement
Practice/Control      ─is─a→  Control                         [tenant-scoped]
Record                ─is─a→  Evidence
Inspection            ─is─a→  Audit
Nonconformity         ─is─a→  Finding
```

The reseat is **vocabulary, not models**. Prisma model names are unchanged
(`Framework`/`Control`/`Evidence`/`Audit`/`Finding`); only the user-facing
labels move, via `messages/en.json` value edits (keys unchanged) + the
`SidebarNav` literals. Because a scheme is just a `Framework` with
`kind='AG_SCHEME'`, every downstream surface — control↔requirement
mapping, `generateReadinessReport`, coverage — works against scheme rows
verbatim. `certification-scheme.ts` is a thin, kind-filtered facade.

Enforcement is unchanged from #31: the 12 GRC route groups + API routes
gate `CERTIFICATION`; the new `/schemes` route + API gate it the same way.
A tenant with CERTIFICATION on sees Schemes/Records/Inspections; a
simple-mode farm tenant sees none of it.

## Files

| File | Role |
|---|---|
| `prisma/schema/enums.prisma` | `AG_SCHEME` added to `FrameworkKind` |
| `prisma/migrations/20260615084226_add_framework_kind_ag_scheme/` | enum-value migration (drift stripped) |
| `src/app-layer/usecases/certification-scheme.ts` | `listSchemes`/`getScheme`/`createScheme`/`getSchemeReadiness` over `kind=AG_SCHEME` |
| `src/app/api/t/[tenantSlug]/schemes/route.ts` | GET list / POST create; module-gated, admin-gated create, validated body |
| `src/app/t/[tenantSlug]/(app)/schemes/{layout,page,SchemesClient,NewSchemeModal}.tsx` | `requireModule` gate + EntityListPage list + create modal |
| `src/app/t/[tenantSlug]/(app)/dashboard/CertificationSchemeCard.tsx` | ag-dashboard readiness card (CERTIFICATION-gated) |
| `src/app-layer/usecases/ag-dashboard.ts` | payload `certification` field (top-scheme readiness) |
| `src/components/layout/SidebarNav.tsx` | Control→Practice, Audit→Inspection, + Schemes nav item |
| `messages/en.json` | vocabulary value reseat (10 keys; keys unchanged) |
| `scripts/seed-demo.ts` | demo Organic-Certification scheme (concept-only, idempotent) |
| `tests/e2e/{frameworks,reporting}.spec.ts` | `#frameworks-heading` → "Certification Schemes" |

## Decisions

- **Schemes are GLOBAL `Framework` rows** (prompt: "reuse Framework/
  FrameworkRequirement as-is"). Ag certification schemes are industry
  standards (Organic, GLOBALG.A.P., LEAF), legitimately shared like ISO
  frameworks — so `createScheme` is `assertCanAdmin` (a global catalog
  write), not a per-tenant write. Tenant-private custom schemes are a
  deferred follow-up (would need a tenant-scoped Framework layer).
- **Vocabulary reseat is global + values-only.** The i18n-completeness
  guardrail checks key *presence*, so editing values is safe and the keys
  stay stable. Global (not per-tenant-kind) because i18n is global and the
  product is agriculture-first; an ISO framework displayed in the ag
  product reads as a "Scheme" (its `kind` still distinguishes it in data).
  The cost was 2 E2E specs asserting the frameworks heading — updated.
- **`logEvent(prisma, …)` from a non-tenant-context call site is correct.**
  `logEvent`'s db arg is `_db` (unused); it routes through
  `appendAuditEntry({ tenantId: ctx.tenantId, … })`, so the global catalog
  write audits cleanly without a `runInTenantContext` wrapper.
- **Readiness reuses `generateReadinessReport` as-is** — no ag-specific
  weight profile yet; schemes score on the default coverage/evidence/tasks
  dimensions. An `AG_SCHEME_WEIGHTS` profile is a follow-up.
