# 2026-05-22 — Frontend verification model: lean extension

**Commit:** `<pending> test(verification): SankeyChart rendered gap + staged coverage-growth ratchet`

## Design

Roadmap-7 arrived as a 4-prompt roadmap to "redesign the frontend
verification model" on the premise of "~3-5 rendered tests, no
verification model, ratchet-green-feature-broken unaddressed."

**That premise was stale.** Roadmap-4 (completed earlier the same
day) had already built the model: `docs/verification-policy.md` (the
three verification states), `docs/frontend-assurance-model.md` (a
*four*-tier model — structural / rendered-behavioural / integration /
browser), `tests/guards/behavioural-coverage-registry.test.ts`, and
the `verification-integrity` meta-ratchet. And the repo holds **126
rendered behavioural tests** and **36 E2E specs** — every high-risk
UI primitive bar one already has rendered coverage.

With the user's agreement, roadmap-7 was executed as a **lean genuine
pass** — only the work that was genuinely missing, not a rebuild of
roadmap-4:

1. **`SankeyChart`** was the one high-risk chart primitive with zero
   rendered coverage. Added `tests/rendered/sankey-chart.test.tsx` —
   a Tier-2 test asserting the graph projects into rendered
   nodes/links, both empty branches, and the click-to-pin
   interaction. Registered it in the behavioural-coverage registry.

2. **The verification *population* could silently shrink.**
   Roadmap-4's registry froze a *named* set of high-risk primitives,
   but nothing stopped a PR from deleting a dozen `tests/rendered/`
   files — every structural ratchet would stay green.
   `tests/guards/rendered-coverage-floor.test.ts` closes that: a
   **staged upward ratchet** (the inverse of the `as any` downward
   ratchet). The count of rendered tests, E2E specs, and registered
   primitives must each stay at or above a floor that only ever
   rises; a slack sentinel forces the floor up as coverage grows, so
   a later PR cannot spend the surplus.

P1 (redesign the model) and P3 (feature/E2E gap-fill) had no genuine
remaining work — the model is already four-tier and the feature/E2E
layer is already substantial. Padding them with marginal tests would
be the "test-count vanity" the prompt itself warns against; the
honest outcome is a verified-clean finding, not fabricated work.

## Files

| File | Role |
|------|------|
| `tests/rendered/sankey-chart.test.tsx` | NEW — Tier-2 rendered test for the one uncovered chart primitive. |
| `tests/guards/rendered-coverage-floor.test.ts` | NEW — staged upward ratchet: rendered/E2E/registry counts must only grow. |
| `tests/guards/behavioural-coverage-registry.test.ts` | `SankeyChart` registry entry added (4 → 5). |
| `tests/guards/verification-integrity.test.ts` | the new floor ratchet registered in the meta-ratchet (2 → 3). |
| `docs/verification-policy.md` | "preventing silent accumulation" — the population-shrink bullet added. |

## Decisions

- **Honest scope over roadmap-shaped scope.** The roadmap asked for
  4 PRs; the genuine non-redundant work was ~1. Shipping one honest
  PR — and saying so — is more truthful than four PRs that re-do
  roadmap-4. The user was shown the finding and chose the lean pass.

- **An upward ratchet, deliberately mirroring the `as any` one.**
  The `as any` ratchet proves debt only shrinks; this proves
  verification only grows. Same mechanism (a floor + a slack
  sentinel), inverted direction — a contributor already understands
  one from the other.

- **The registry froze names; the floor freezes the population.**
  The two are complementary: the registry guarantees *specific*
  high-risk primitives keep a rendered test; the floor guarantees
  the *aggregate* rendered/E2E body never erodes.
