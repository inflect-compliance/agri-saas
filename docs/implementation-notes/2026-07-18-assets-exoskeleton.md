# 2026-07-18 — Assets compliance-exoskeleton (module-gated GRC chrome)

**Commit:** `<pending>` feat(assets): module-gate the compliance exoskeleton + asset↔risk read-back

## Design

The assets feature was built as an information-asset register for the old
compliance platform. After the agri pivot the *entity* is right (a farm's
machines, vehicles, buildings, equipment) but the GRC scaffolding around it —
control/risk traceability, inherited evidence, framework mappings, control-test
plans, the coverage shield — is meaningless to a plain farm that never enables
a compliance module.

This PR makes that scaffolding **conditional on the tenant's modules** rather
than deleting it. A tenant running `CERTIFICATION` or `RISK` keeps the full
asset → control → risk → coverage loop; a simple-mode farm gets a clean
register (Overview / Tasks / Activity, no compliance columns, no shield).

The gate is one pure helper, `hasComplianceModules(availableModules)` in
`src/lib/modules.ts`:

```
undefined availableModules → true   (older provider payload → behave as before)
includes CERTIFICATION|RISK → true
otherwise                   → false
```

`availableModules` already rides the tenant context (populated server-side in
`t/[tenantSlug]/layout.tsx`, consumed by `SidebarNav`), so both the list client
and the detail page read it from `useTenantContext()` — no new server round-trip,
no prop threading. Older sessions with no module list degrade to "show it",
matching how `SidebarNav` treats the same field.

Alongside the gate, this closes a **write-only read-back gap**: an asset↔risk
link stored an `exposureLevel` (LOW/MEDIUM/HIGH) at link time that was never
surfaced on read. The TraceabilityPanel now shows it as a badge column (asset
arm only — control-arm risk links have no exposure), and the list gains a
"Risks" link-count column beside "Controls", mirroring the existing `_count`
pattern.

## Files

| File | Role |
|------|------|
| `src/lib/modules.ts` | New `hasComplianceModules()` gate helper. |
| `src/app/t/[tenantSlug]/(app)/assets/[id]/page.tsx` | Reads `availableModules`; filters evidence/mappings/traceability/tests tabs out for a plain farm (keeps Overview/Tasks/Activity). |
| `src/app/t/[tenantSlug]/(app)/assets/AssetsClient.tsx` | Gates the Controls + new Risks columns and the coverage shield on `showCompliance`. |
| `src/app-layer/repositories/AssetRepository.ts` | `_count` now selects `risks` too (list + paginated). |
| `src/components/TraceabilityPanel.tsx` | Adds an Exposure column to an asset's linked-risk table (reads the `exposureLevel` scalar already returned by the traceability query). |
| `messages/{en,bg}.json` | New `traceability.colExposure`; farm-true rewrite of `assets.newAssetDescription`, `listDescription`, `emptyRecordsDescription` (dropped "information asset" / "risk + control coverage" framing). |

## Decisions

- **Gate on `CERTIFICATION` OR `RISK`, not a single key.** The asset
  exoskeleton spans both domains (evidence/mappings/tests are certification;
  traceability is risk+control). The prompt framed the gate as "RISK/
  CERTIFICATION enabled", so the helper is an OR. Note the `risks` route group
  itself gates on `CERTIFICATION` — a tenant with `RISK` but not
  `CERTIFICATION` would see the asset risk column but a gated `/risks` page;
  that combination isn't a shipping persona (simple mode has neither; the
  enterprise default has both), so the OR is the honest, forward-compatible
  choice.
- **Filter tabs, don't disable them.** A hidden tab is cleaner than a greyed
  one — the tab *bodies* are already `activeTab === …` guards, and `activeTab`
  defaults to `overview`, so a gated tab can never be the active one. No stale-
  state path.
- **Exposure column is asset-arm-only.** `exposureLevel` is a scalar on
  `AssetRiskLink`; the control arm's risks come from `RiskControl` rows which
  have no exposure. Rendering it only when `entityType === 'asset'` keeps the
  control detail page unchanged.
- **`exposureLevel` needed no serializer change.** Prisma `findMany` with an
  `include` returns all parent scalars by default, so the traceability query
  already carried `exposureLevel` on every link row — the gap was purely in the
  UI not reading it.
- **Copy: no tab renames.** The prompt asked to flag tab renames rather than do
  them silently; none were needed — the tab labels (Evidence/Mappings/…) are
  now simply invisible to farms, so they read fine for the compliance persona
  who still sees them. Only the modal/list prose was de-compliance-ified.
