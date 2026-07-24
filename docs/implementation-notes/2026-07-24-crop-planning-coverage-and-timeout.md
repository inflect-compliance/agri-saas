# 2026-07-24 — Crop-planning unit coverage + coverage-job timeout

**Commit:** `<sha>` test(planning): cover crop-planning usecases; raise coverage-job timeout

Follow-up to the plan-vs-actual PR (#375, merged as `d1251fc`). Two
independent fixes for the main-only `Coverage (≥60%)` gate.

## Background — what the CI history showed

The `Coverage (≥60%)` job is **main-push only** and **not a required
merge check**, so PRs merge without ever running it and coverage debt
accumulates silently on `main`. Two distinct problems had stacked up:

1. **The job was already failing the threshold before this PR.** On the
   commit immediately before the #375 merge (the climate feature,
   `23139a56`), the coverage job *completed* in ~30 min and its
   `Gate: test coverage thresholds` step ended in **`failure`** — i.e.
   coverage was already under a floor, independent of the crop-planning
   work.

2. **#375 pushed the job over its 35-min timeout.** The plan-vs-actual PR
   added two DB-backed integration specs (`crop-plan-actuals-loop`,
   `crop-plan-lifecycle`) to the sequential, coverage-instrumented run.
   The suite has grown past 24,000 tests, and the extra DB specs tipped
   the run past the 35-min ceiling, so the gate started ending in
   **`cancelled`** (timeout) *before it could compute a number* — two
   consecutive attempts both died at ~35m. A cancelled step is a timeout,
   not a threshold breach.

## 1. Unit coverage for the crop-planning usecases

`crop-planning.ts` was the largest under-covered file this PR touched —
unit coverage was **50% lines / 28% branch / 49% funcs** because the
season/catalog CRUD, `advancePlantingStatusForLinks`, `createCropVariety`
(soil/GDD write), `updateCropPlan`, and the read/list helpers had no
direct unit tests (several are exercised only by the DB integration specs,
which don't run in unit mode).

Added focused unit tests (mocked `db` + `runInTenantContext`, matching the
file's existing pattern) covering every remaining exported function and
its gate / validation branches. Result: **100% lines / 93.7% stmts /
100% funcs / 74.5% branch** — well above the `usecases/` directory floor
(lines 77 / stmts 75 / funcs 70 / branch 67). `advancePlantingStatusForLinks`
gets a pure-logic test (monotonic-forward: advances a PLANNED row, never
moves backward, collapses multiple stages to the highest status).

## 2. Coverage-job timeout 35 → 60 min

`.github/workflows/ci.yml` — the coverage job's `timeout-minutes` was 35
(raised 25→35 under #716 when the suite was ~7,800 tests). The suite is
now 24k+ tests plus DB integration specs, so the instrumented
`--runInBand` run no longer fits. Raised to 60 to restore headroom and
let the gate actually report a number.

The durable fix is to **shard the coverage job** like `test` (run
`--shard=i/N`, istanbul-merge the per-shard reports, then check
thresholds once) — noted inline as a follow-up. The single-job ceiling
bump is the interim unblock.

## Files

| File | Role |
| --- | --- |
| `tests/unit/crop-planning.test.ts` | +30 unit tests over the previously-untested usecase surface (season/catalog CRUD, status-advance, plan read/update, validation branches). |
| `.github/workflows/ci.yml` | coverage-job `timeout-minutes` 35 → 60 + rationale/`shard` follow-up note. |

## Decisions

- **Scope = claw back this PR's contribution + unblock the gate.** The
  pre-existing threshold failure predates #375 and is likely codebase-wide
  (the climate feature's untested surface), not in the crop-planning code.
  Restoring the coverage this PR cost and fixing the timeout it introduced
  is the on-scope fix; the remaining pre-existing deficit needs its own
  pass once the timeout fix lets CI report the real per-directory numbers.
- **Timeout bump, not gate relaxation.** The floors in `jest.thresholds.json`
  are untouched — the fix makes the job *able to run*, it does not lower
  the bar.
