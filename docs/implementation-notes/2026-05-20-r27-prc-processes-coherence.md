# 2026-05-20 — Roadmap-27 PR-C — Processes coherence + vision

**Commit:** `<pending> feat(processes): R27-PR-C — coherence pass + world-class review`

Closes Roadmap-27 (Processes Canvas III) — prompts 6 (final
coherence pass) and 7 (world-class architecture review).

## Design

### Coherence pass (prompt 6)

R27 PR-A and PR-B reshaped the Processes surface in two focused
passes. PR-C is the integration sweep — no new features, just
resolving what the two passes left inconsistent:

- **Help strip copy** refreshed for the R27-PR-B edge affordance
  ("Select an edge to set its style or add a control"); dismissal
  key bumped `v1 → v2` so returning users see the updated tip once.
- **`docs/processes-canvas.md` refreshed.** The doc still described
  the R25 world — persistence and the inspector listed as
  "deliberate non-features" when both shipped in R26; the canvas /
  node files pointed at pre-R26 paths. The architecture table,
  interaction model, and non-features list now reflect R26 + R27
  reality.
- **Capstone meta-ratchet** (`r27-prf-capstone.test.ts`) — locks
  round completeness and two surface-wide coherence invariants no
  per-PR ratchet owns: every Processes component renders on the
  `--canvas-*` ramp (no translucent `bg-bg-*/NN` washes, no raw
  hex) and the full token ramp has theme parity.

The pass is deliberately small. Prompt 6 says "do not add random
features"; the genuine high-value additions are catalogued in the
review document instead, where they can be scoped properly.

### World-class review (prompt 7)

`docs/processes-canvas-world-class-review.md` — a holistic product +
architecture review. Honest maturity assessment (~6/10: a strong,
visually-resolved foundation, but the load-bearing "tool"
capabilities are absent), the gap analysis, **10 concrete upgrades**
each with why / repo areas / scope / acceptance criteria,
architecture + UX recommendations, an explicit "what to avoid"
list, and the final acceptance criteria for "world-class".

The headline finding: the canvas is still a *feature*, not a
*tool* — its control / risk / asset elements are free-text labels,
not links to the real compliance graph
(`ProcessEdgeControl.controlId` exists but is unwired). Semantic
linkage is the #1 upgrade.

## Files

| File | Change |
|---|---|
| `processes/CanvasHelpStrip.tsx` | copy refresh + dismiss-key bump |
| `docs/processes-canvas.md` | refreshed for R26 + R27 reality |
| `docs/processes-canvas-world-class-review.md` | **new** — prompt-7 review |
| `tests/guards/r27-prf-capstone.test.ts` | **new** — round capstone meta-ratchet |

## Decisions

- **Coherence pass, not a feature pass.** The temptation in a
  "final pass" is to add things; prompt 6 explicitly forbids it.
  Genuine additions (semantic linkage, minimap, undo/redo, …) are
  documented as a scoped roadmap in the review, not half-built here.
- **The review is honest.** A 6/10 maturity score and a "still a
  feature, not a tool" verdict are more useful than a victory lap.
  The point of prompt 7 is to chart the path, not to celebrate.
