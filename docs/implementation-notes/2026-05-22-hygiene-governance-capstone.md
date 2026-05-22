# 2026-05-22 — Codebase-hygiene governance capstone

**Commit:** `<pending> test(guards): codebase-hygiene meta-ratchet + governance doc`

## Design

Roadmap-6's first three prompts each closed a codebase-hygiene gap
and shipped a guardrail with it:

- **P1** — `as any` debt driven 174 → 4; two ratchets
  (`guardrails/no-explicit-any-ratchet` binding baseline + drift
  sentinel, `guards/no-explicit-any-ratchet` per-pattern caps).
- **P2** — `console.*` logging discipline; the `lib/dub-utils/`
  blanket exemption removed from `logging-import-hygiene` + a lock
  test.
- **P3** — all 322 route handlers migrated to the Next 15
  `params: Promise<…>` contract; `async-params-route-typing` ratchet
  added; the transparent-await shim retired.

P4 is the governance layer — the same shape as the four prior domain
capstones (`ci-pipeline-integrity`, `observability-reliability-
integrity`, `verification-integrity`, `dependency-governance-
integrity`): a unifying document and a meta-ratchet, no structural
re-fix.

`docs/codebase-hygiene.md` is the single entry point — the three
pillars, the guardrail enforcing each, and how to fix a failure. It
also writes down two policy decisions that were previously only
tribal: the `as any` *drift sentinel* IS the "continued reduction"
mechanism (slack cannot accumulate), and
`@typescript-eslint/no-explicit-any` is deliberately `warn` not
`error` because the residual `: any` annotation debt makes a
wholesale `error` infeasible — the ratchet is the enforcement.

`tests/guards/codebase-hygiene-integrity.test.ts` is the
meta-ratchet — the fifth "guard the guards" test. It registers the
four hygiene guardrails, asserts each exists, still carries its
subject anchors, and has a real assertion surface; and asserts the
governance doc survives with its three pillar statements.

## Files

| File | Role |
|------|------|
| `docs/codebase-hygiene.md` | NEW — the unified hygiene governance model. |
| `tests/guards/codebase-hygiene-integrity.test.ts` | NEW — meta-ratchet over the 4 hygiene guardrails + the doc. |
| `CLAUDE.md` | Added a "Codebase-hygiene ratchets" subsection pointing at the doc. |

## Decisions

- **A capstone, not a re-fix.** Every enforcement mechanism P4's
  prompt asked for already exists — the `as any` ratchets were
  lowered and the drift sentinel already drives continued reduction
  (P1), the logging guard already covers `dub-utils` (P2), the
  async-params ratchet already exists (P3). P4's honest deliverable
  is the model that makes the four guardrails legible as one system
  and the meta-ratchet that stops any of them being silently gutted.

- **Meta-ratchet over the guardrails, not over the source.** The
  four pillar guardrails already assert the source-level facts. The
  meta-ratchet guards a different regression class — deletion or
  no-op'ing of a guardrail — exactly as the four prior domain
  capstones do.

- **Document the lint-severity decision.** "Why is `no-explicit-any`
  only a `warn`?" is a question every contributor eventually asks.
  Writing the answer down (the `: any` debt makes `error`
  infeasible; the ratchet is the enforcement) converts tribal
  knowledge into policy.
