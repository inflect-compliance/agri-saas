# Codebase hygiene

Three codebase-hygiene invariants, each remediated by Roadmap-6 and
each held in place by a structural guardrail so the gain cannot
quietly erode. This document is the single entry point: what the
invariant is, which guardrail enforces it, and how to fix a failure.

The guardrails are themselves guarded by the meta-ratchet
`tests/guards/codebase-hygiene-integrity.test.ts` — delete or gut
any one of them and a "guard the guards" test goes red.

## Pillar 1 — `as any` stays on a downward ratchet

`as any` is a hole in the type system: it disables checking in every
direction and silently survives refactors. Roadmap-6 P1 drove the
`src/` count from **174 to 4**; the four that remain are documented
staged debt (each carries an inline `eslint-disable` + reason).

**Enforced by two guardrails:**

- `tests/guardrails/no-explicit-any-ratchet.test.ts` — the binding
  ratchet. `CURRENT_BASELINE` is the ceiling for code-level `as any`
  in `src/`. It only moves **down**. A companion *drift sentinel*
  fails CI if the baseline sits more than a few above the real count
  — so after a cast-removal PR you **must** lower `CURRENT_BASELINE`
  in the same diff. That is the "continued reduction" mechanism:
  slack cannot accumulate for a future regression to silently
  consume.
- `tests/guards/no-explicit-any-ratchet.test.ts` — per-pattern caps
  for `: any`, `<any>`, `useState<any>`, `as any`, `// @ts-ignore`.
  Caps only ratchet down.

**Why `@typescript-eslint/no-explicit-any` is `warn`, not `error`:**
the codebase still carries a large `: any` annotation debt (~350).
Flipping the rule to `error` would redden CI wholesale and cannot be
rolled out gradually. The **ratchet is the enforcement** instead —
it permits the existing debt while making new `any` impossible to
add silently. When the `: any` count is itself driven low enough,
revisit the rule severity.

**Fix a failure:** replace the cast with a real type — a Prisma
generated type/enum, `Prisma.InputJsonValue`, `z.infer<typeof
Schema>`, an explicit interface, `unknown` + a type guard, or a
narrow bounded adapter. If a cast is genuinely unavoidable, keep
**one**, as narrow as possible, with an `eslint-disable` + reason.
Then lower the baseline / caps to the new count in the same PR.

## Pillar 2 — logging discipline, adapted code included

Server-side code logs through the structured logger
(`@/lib/observability`), never `console.*`. Roadmap-6 P2 closed a
blind spot: the dub-ported utility tree `src/lib/dub-utils/` had a
blanket exemption from the console guardrail. Adapted / vendored
code is **not** a lower hygiene bar — it runs in the same process
and pollutes the same logs.

**Enforced by** `tests/guardrails/logging-import-hygiene.test.ts` —
scans `src/` for `console.*` in server code. `lib/dub-utils/` is
deliberately *not* on the allowlist, and a dedicated lock test fails
CI if a blanket `lib/dub-utils/` exemption is ever re-added. The
remaining allowlist entries are client-component directories (their
browser-side `console.*` is legitimate).

**Fix a failure:** route the message through `logger` / `log` from
`@/lib/observability`, or — if the log is unnecessary — remove it.
Do not reach for the allowlist.

## Pillar 3 — route handlers type `params` as a Promise

Next 15+ delivers a route handler's dynamic `params` as a `Promise`.
Roadmap-6 P3 migrated all 322 handlers under `src/app/api` to
`params: Promise<{ … }>` + an explicit `await`, and removed the
transparent-await shim `withApiErrorHandling` once carried.

**Enforced by** `tests/guards/async-params-route-typing.test.ts` —
fails CI if any handler types `params` synchronously. With the shim
gone there is no runtime safety net: a sync annotation compiles, but
`params.x` reads `undefined` at runtime.

**Fix a failure:** type the parameter `params: Promise<{ … }>` and
`await` it (the established pattern renames the destructured binding
to `paramsPromise` and binds `const params = await paramsPromise;`
as the first body statement).

## The meta-ratchet

`tests/guards/codebase-hygiene-integrity.test.ts` registers the four
guardrails above. For each it asserts the file exists, still
contains its subject anchors (proof it was not gutted to a no-op),
and carries a real assertion surface. It also asserts this document
survives with its three load-bearing pillar statements. A
contributor removing a hygiene guardrail meets a red meta-ratchet —
the gap cannot silently reopen.

Sibling of `ci-pipeline-integrity`, `observability-reliability-
integrity`, `verification-integrity`, and
`dependency-governance-integrity` — the same "guard the guards"
pattern, the codebase-hygiene domain.
