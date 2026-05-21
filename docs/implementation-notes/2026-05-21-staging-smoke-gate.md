# 2026-05-21 — Staging smoke gate before production deploy

**Commit:** `<pending> ci(deploy): gate production deploy behind staging smoke`

## Design

`deploy.yml` previously deployed to ONE environment per run, chosen
by the `environment` dispatch input. A dispatcher could pick
`production` directly: the workflow built the image, deployed it to
the production cluster, and smoke-tested it — with **no requirement
that the same image had ever been validated on staging**. The
`smoke-staging` / `smoke-prod` scripts existed, but nothing in the
job graph forced staging-before-production.

The fix restructures the workflow so a `production` target promotes
through staging in ONE run:

```
gate → build-image → deploy-staging → smoke-staging → deploy-production → smoke-production
```

`deploy-production` declares `needs: [smoke-staging]`. GitHub Actions
will not start a job whose `needs` dependency failed — so production
**cannot** deploy unless the exact same image first passed staging
deploy + staging smoke. The gate is an explicit edge in the job
graph, not implicit run-ordering.

Two layers protect production, evaluated in order:

1. **Staging smoke must pass** — the `needs:` edge. A failed staging
   smoke turns the run red and `deploy-production` is skipped.
2. **A human approves the production stage** — the `production`
   GitHub Environment's required-reviewers rule on
   `deploy-production`. The approval prompt fires *after* staging
   smoke has passed, so reviewers approve a release already proven
   on staging.

A `staging` target run stops after `smoke-staging`
(`deploy-production` / `smoke-production` are `if`-skipped).

The image is built ONCE (`build-image`) and promoted staging →
production — staging validates the byte-identical artefact prod
receives.

### Why a composite action

Splitting one deploy job into `deploy-staging` + `deploy-production`
would have duplicated ~70 lines of helm/AWS/kubectl logic, free to
drift between the two environments. The shared steps were extracted
into `.github/actions/helm-deploy` (a composite action,
parameterised by environment / release / namespace) — one
implementation, called twice. Each deploy stays a separate *job*
(the `environment:` key, which drives GitHub Environment protection,
is job-level, not step-level).

### Smoke script

Both smoke jobs run `scripts/smoke-prod.mjs` — the generic
post-deploy validator (livez / readyz / health / login /
auth-session, with retries). Despite the name it is not
prod-specific; it tests whatever `SMOKE_URL` the GitHub Environment
provides. This matches the pre-existing behaviour (the old single
smoke job already used `smoke-prod.mjs` for staging deploys).
`scripts/smoke-staging.mjs` is a separate, lighter local-dev
convenience script and is left untouched.

## Files

| File | Role |
|------|------|
| `.github/workflows/deploy.yml` | Restructured: one deploy job → `deploy-staging` / `smoke-staging` / `deploy-production` / `smoke-production`; production gated via `needs: smoke-staging`. |
| `.github/actions/helm-deploy/action.yml` | NEW — composite action holding the shared helm/AWS/kubectl deploy logic. |
| `tests/guards/deploy-staging-gate.test.ts` | NEW — structural ratchet: fails CI if the `needs: smoke-staging` edge, the gate jobs, or `environment: production` are removed. |
| `docs/deployment.md` | "### Deploying" section rewritten for the staging-gate model. |

## Decisions

- **The gate is a `needs:` edge, not a conditional or a separate
  approval.** `needs: [smoke-staging]` is the simplest, most
  auditable expression of "production depends on staging smoke" —
  it is visible in the Actions UI job graph and impossible to
  satisfy without staging smoke succeeding.

- **One workflow run promotes both environments.** The alternative
  — a separate run per environment with a stateful "was staging
  smoked for this ref?" check — is exactly the implicit, brittle
  sequencing the remediation set out to remove.

- **`concurrency.group` is global (`deploy`), not per-environment.**
  A `production` run now touches the staging environment too, so two
  runs must never race over the staging release.

- **Composite action, not a reusable workflow.** A composite action
  keeps the deploy.yml job graph readable (`uses: ./.github/actions/helm-deploy`)
  without the extra indirection of a `workflow_call` file. It is the
  first composite action in the repo; the pattern is standard.
