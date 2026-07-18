# 2026-07-18 — Delete dead compliance-era asset code

**Commit:** `<pending>` chore(assets): delete dead compliance-era asset surface

## Design

Roadmap prompt C of 3. The asset feature carried a tail of provably-dead
compliance-era code: read-only link API handlers the UI never calls, a
duplicate link route, a legacy non-tenant `/api/assets` tree, orphaned usecase
exports, dead i18n keys, and an unreachable onboarding step. This PR deletes
what is **provably dead** (caller-verified) and, for a few items that turned
out to be **live or repo-preserved**, documents why they were left in place
rather than half-changed.

The guiding rule was *no behaviour change for live surfaces* — every deletion
was gated on a whole-repo caller search proving zero live reach.

## Deleted (provably dead)

| Item | Evidence of death |
|------|-------------------|
| `GET /assets/[id]/controls` + `GET /assets/[id]/risks` handlers | The panel reads `/assets/[id]/traceability`; no fetch hit these GETs. POST (link) + the `[controlId]`/`[riskId]` DELETE (unlink) are LIVE and kept. |
| `controls/[controlId]/assets/route.ts` (whole file) | Duplicate link route — the panel links control↔asset via `/assets/[id]/controls`. Zero fetchers of `/controls/*/assets`. |
| `src/app/api/assets/route.ts` + `src/app/api/assets/[id]/route.ts` | Legacy non-tenant tree; the app uses the `/api/t/[slug]/assets` routes. Only ref was a path-string in a router unit test (unaffected). |
| `traceability.ts`: `listAssetControls`, `listControlAssets`, `listAssetRisks`, `listRiskAssets` | Two were imported only by the dead GET routes; two were fully orphaned. |
| `MapControlAssetSchema` / `ControlAssetMapRequest` | Only the deleted duplicate route used it; removed from the OpenAPI spec. |
| 8 `assets.*` i18n keys (`linkedRisks`, `searchRisks`, `noRisksAvailable`, `relatedControls`, `searchControls`, `noControlsAvailable`, `controlsNote`, `alreadyLinked`) | Zero `t()`/`tm()` callers in `src/`. `risksCol` is now live (kept). |
| Onboarding `AssetSetupStep` component + its `renderStepContent` case | `STEPS` is `[COMPANY_PROFILE, TEAM_SETUP]`; the asset step is unreachable. Orphaned the `Server` icon import (removed). |

`linkAssetToControl` / `unlinkAssetFromControl` (control usecase) are kept —
their only route caller died, but they remain exercised by
`control-tasks-evidence-usecase.test.ts`.

## Deliberately NOT changed (documented forks)

- **AI knowledge-base `ASSET_TYPE_PROFILES`** — LIVE, not dead. It executes on
  every AI risk-suggestion (`/ai/risk-suggestions/generate` →
  prompt-builder/stub-provider). Because no agri `AssetType` matches its
  infosec keys, every asset resolves to the `APPLICATION` fallback — inert, but
  running. Re-keying it to agriculture means rewriting the whole tested infosec
  knowledge base (`ENRICHED_RISK_CATALOG` + `FRAMEWORK_GUIDANCE` + profiles +
  `ai-risk-assessment.test.ts`) and changes live AI output — a feature project,
  not a dead-code deletion. Left intact; flagged for a dedicated agri-AI PR.
- **`GraphExplorer`** — unmounted, but the repo's own
  `traceability-page-structural.test.ts` deliberately preserves it "for future
  callers", and it's entangled with the LIVE `traceability-graph` lib (shared
  with Sankey) plus ~9 test/guard files. Deleting it fights an explicit in-repo
  decision; left intact.
- **`EntityListPage` migration of `AssetsClient`** — a no-behaviour-change UI
  refactor, orthogonal to the dead-code theme. Bundling a 550-line shell swap
  into a deletion PR adds regression risk without user benefit; deferred to a
  focused follow-up (mirroring how ControlsClient's shell adoption was its own
  change). The shell-adoption ratchet lands with that PR.
- **Onboarding backend executors** (`executeAssetCreation` + the framework /
  control / risk executors) — a coherent 5-executor block, all dead-via-UI but
  wired through the live `runStepAction`. Removing one leaves the block
  inconsistent and risks the live COMPANY_PROFILE/TEAM_SETUP completion flow.
  Deferred as a single onboarding-automation cleanup.

## Decisions

- Caller-verified every deletion — the whole PR is "delete what's provably
  dead", so each removal carries a zero-caller proof, not a guess.
- Kept the POST/DELETE link handlers; only the never-called GET readers went.
- `route-permissions.ts` + `api-permission-coverage.test.ts` needed no edits —
  neither referenced the deleted asset/control link routes.
