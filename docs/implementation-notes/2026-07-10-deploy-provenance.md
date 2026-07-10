# 2026-07-10 — Deploy provenance + drift detection

**Commit:** `<sha> chore(deploy): make the repo canonical for the prod compose + drift detection`

## Design

CLAUDE.md previously documented that the live prod compose *drifts* from the
repo — drift as policy. This change ends that: the repo is the source of truth
for the prod Compose STRUCTURE, and drift is now DETECTABLE via a sha256 check.

**Reality vs the roadmap prompt.** The prompt assumed the live VM was
`inflect-compliance:/opt/inflect/docker-compose.prod.yml` (per the stale
CLAUDE.md). Investigation with `gcloud` found the live product actually runs on
a **different** VM — `agrent:/opt/agrent/docker-compose.vm.yml` (project
`hazel-design-419410`, `europe-west1-b`), a 7-service single-VM stack (app,
worker, watchtower, caddy, pgbouncer, redis, db) serving
`https://35-187-80-26.sslip.io`. The `inflect-compliance` VM is legacy. So the
canonical repo file is the **agrent** manifest, and correcting CLAUDE.md is part
of the deliverable.

```
repo  deploy/docker-compose.vm.yml   ── apply.sh ──▶  agrent:/opt/agrent/docker-compose.vm.yml
        (byte-identical: sha256 ae9065ad…)   ◀── check-drift.sh (sha256 compare, weekly)
```

The vendored file is byte-identical to the live one (verified: same sha256), so
`check-drift.sh` reports **zero drift at landing**. The live file is already
well-commented (Caddy TLS, Watchtower boundary, no-ClamAV rationale, build
escape hatch), so vendoring it verbatim both documents the intentional
deviations and keeps the hash match.

## Files

| File | Role |
|------|------|
| `deploy/docker-compose.vm.yml` | NEW — canonical agrent compose, verbatim copy of the live VM file |
| `deploy/apply.sh` | NEW — backup → scp → validate → up -d → health-verify (readyz + PWA lifelines) → rollback hint |
| `deploy/check-drift.sh` | NEW — sha256 repo vs VM, non-zero + readable hint on mismatch |
| `deploy/env.prod.example` | NEW — keys-only prod env template |
| `tests/guardrails/deploy-env-parity.test.ts` | NEW — every prod-required `src/env.ts` var must appear in the example |
| `CLAUDE.md` | §Production VM rewritten: agrent, apply/drift workflow, drift no longer policy |

## Decisions

- **Canonical file is `docker-compose.vm.yml`, not `prod.yml`.** The live VM
  uses `vm.yml`; `prod.yml` is the legacy inflect manifest, KEPT because the
  GAP-03 `encryption-key-enforcement` guardrail asserts its `:?`-fail-fast
  syntax. Deleting it would break that ratchet.
- **Vendor verbatim, don't re-comment.** Adding repo-only comments would change
  the bytes and make `check-drift.sh` report false drift at landing. The live
  file's own comments carry the deviation rationale; extra context lives here
  and in CLAUDE.md.
- **No Actions job wired.** The prompt gates the scheduled drift job on an
  existing GCP service-account secret; the repo has none (no
  `google-github-actions` / WIF in `.github/workflows`). So `check-drift.sh` is
  documented as a weekly *manual/cron* cadence rather than inventing creds.
- **apply.sh health-checks the PWA lifelines.** A deploy that 404s
  `/manifest.webmanifest` or `/sw.js` strands offline-installed mobile clients
  until their caches expire, so both must return 200 alongside `/api/readyz`.
- **env-parity derives the required set from the schema** (non-`.optional()`
  non-`.default()` vars + a small reviewed list of prod-conditional
  superRefine vars), so a newly-required var can't ship without the deploy doc
  learning it.
- **apply.sh was NOT run against prod** in this change — landing the tooling +
  the reconciled (already-matching) file is the deliverable.
