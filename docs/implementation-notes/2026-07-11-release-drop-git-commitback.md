# 2026-07-11 — Release: drop @semantic-release/git commit-back

**Commit:** `<sha> fix(release): drop @semantic-release/git — publish via tags + GitHub Releases (fix GH006)`

## Problem
The `Release` workflow had been red on ~19 of the last 20 commits to `main`
(since v1.24.0). It is not a required check, so it blocked no merges — but it
meant **no releases were being published at all**. Root cause:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - 11 of 11 required status checks are expected.
 ! [remote rejected]   HEAD -> main (protected branch hook declined)
   command: git push --tags ... HEAD:main   pluginName: @semantic-release/git
```

`@semantic-release/git` pushes the version-bump commit (CHANGELOG / package.json /
Chart.yaml) directly to `main` during the `prepare` phase. `main`'s branch
protection requires 11 status checks that a freshly-created release commit can't
have, and the workflow's `GITHUB_TOKEN` (github-actions[bot]) cannot bypass them.
Because `prepare` failed, semantic-release aborted before `@semantic-release/github`
ran — so no tag and no GitHub Release were created either. It "worked" through
v1.24.0 because required-status-checks were tightened afterward (repo went private;
E2E / CodeQL / Docker became required).

## Decision — self-activating commit-back
`.releaserc.json` was converted to `release.config.js` so the commit-back plugin
can be included conditionally. `@semantic-release/git` is added **iff**
`process.env.SEMANTIC_RELEASE_COMMIT_BACK === 'true'`, which `release.yml` derives
from the presence of a `RELEASE_TOKEN` secret:

- **No `RELEASE_TOKEN` (default today):** commit-back plugin omitted. Publishing
  (tag → `refs/tags/*` (unguarded), GitHub Release, SBOM) runs on `GITHUB_TOKEN`.
  `package.json` / `CHANGELOG.md` / `Chart.yaml` stay frozen in-repo — in-sync, so
  the helm-chart guard passes; version history lives in git tags + GitHub Releases.
  **No push to `main` is even attempted, so GH006 cannot recur.**
- **Add `RELEASE_TOKEN`** (admin fine-grained PAT, `contents:write`, or a GitHub
  App): `release.yml` sets `SEMANTIC_RELEASE_COMMIT_BACK=true` and passes the token
  as `GITHUB_TOKEN`. The plugin is included and the push runs as an admin
  (`enforce_admins:false` → bypasses required checks). Versions advance in-repo in
  lock-step, as before **v1.24.0 — with no workflow/config edit needed to switch on.**

This restores the pre-breakage behavior on demand while defaulting to the safe,
credential-free path — fixing the standing red without a settings change.

## Why the helm-chart guard stays green (commit-back OFF)
`tests/guards/helm-chart-foundation.test.ts` asserts `Chart.yaml.appVersion ===
package.json.version`. With commit-back off, **neither** advances, so both stay
frozen at `1.24.0` and remain equal. The `@semantic-release/exec` chart-sync +
`@semantic-release/changelog` + `@semantic-release/npm` prepare steps still run but
their writes are discarded (uncommitted) — retained so that turning commit-back ON
restores full lock-step sync with no other change.

## Files
| File | Role |
|---|---|
| `release.config.js` | **New** — replaces `.releaserc.json`. Includes `@semantic-release/git` only when `SEMANTIC_RELEASE_COMMIT_BACK === 'true'` |
| `.releaserc.json` | **Deleted** (superseded by the JS config) |
| `.github/workflows/release.yml` | Token = `RELEASE_TOKEN \|\| GITHUB_TOKEN`; `SEMANTIC_RELEASE_COMMIT_BACK` = token presence; header comment documents the opt-in |

## To turn commit-back ON later
One step, no code change: an admin creates a fine-grained PAT (`contents:write`) or
a GitHub App and adds it as the `RELEASE_TOKEN` repo secret. `release.yml` then sets
`SEMANTIC_RELEASE_COMMIT_BACK=true` automatically and passes the token;
`enforce_admins:false` means it bypasses the required checks without a ruleset change.
Remove the secret to switch back off.
