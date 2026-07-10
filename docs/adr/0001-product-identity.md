# ADR 0001 — Product identity: compliance core vs agriculture surface

**Status:** Proposed
**Date:** 2026-07-10
**Deciders:** Product + Engineering

## Context

This codebase began as a GRC/compliance SaaS ("Inflect") and is being rebranded
and repurposed as **Agrent**, an agriculture-operations product. The audit's
remaining strategic finding:

- **~53% of the ~180 Prisma models are inherited compliance machinery**
  (controls, risks, vendors, audit cycles, frameworks, policies, evidence),
  **~19% are agriculture** (parcels, journals, planning, grain, exchange,
  inventory), and the rest are platform (auth, automation, processes,
  observability). Roughly a **96 / 49 / 35** model split
  (core / platform / agri).
- The seam between compliance and agriculture was, until now, enforced by
  **nothing**. Roadmap-5 PR5 adds `tests/guardrails/module-import-boundaries.test.ts`,
  which classifies `src/app-layer` into agri / core / platform and forbids
  agri⇄core imports. **The current cross-import count is 0** — the domains are
  already cleanly separated at the code layer (agri code never imports the
  compliance core; both depend only on platform).
- Pruning has already started **organically and de facto**: #203 / #206 removed
  the GRC Risk, Inspection, and Vendor destinations from the navigation, and the
  Agrent rebrand (Roadmap-5 PR3) landed. The compliance modules still exist in
  the schema and API, but they are increasingly unreachable from the product UI.

**Measured inputs to this decision:**

| Input | Value |
|-------|-------|
| Model split (core / platform / agri) | ~96 / 49 / 35 |
| agri⇄core code cross-imports (PR5 guardrail) | 0 |
| Module × device usage (`module.access.count`) | *collect ≥1 month via PR5 telemetry before deciding* |

## Mobile-first framing (the deciding lens)

Agrent is a **mobile-first** product for farmers and traders in the field. The
primary navigation surface is the **BottomTabBar**, which can only carry a
handful of destinations. **Every compliance module kept alive competes with an
agriculture module for scarce phone navigation real estate.** The platform can
afford to carry 53% dormant schema indefinitely — dead tables cost storage, not
attention. The **phone UI cannot**: a tab spent on "Controls" is a tab not spent
on "Journal" or "Exchange". So the cost of the compliance core is not primarily
the schema — it is the navigation budget and the cognitive load on a farmer.

The PR5 device telemetry makes this concrete: if the (still-reachable)
compliance modules are consumed only from desktop and the agri modules only from
phones, the split is not hypothetical — it is already how the two user
populations behave, and the product is really two products sharing a database.

## Options

### (a) Extract the compliance core as an internal package along the module seam

Move the ~96 compliance models + their usecases/repositories/policies behind a
workspace package (e.g. `@agrent/compliance`), depended on optionally.

- **Cost:** High up-front. Requires a clean cut at the seam (the PR5 guardrail
  shows the seam is already clean at the app layer, but the Prisma schema is a
  single client — splitting it means a second schema/client or a package that
  re-exports a subset). Weeks of work; risk of destabilising a working system.
- **Benefit:** Compliance becomes a genuinely optional capability; a
  pure-agriculture deployment ships without it. Preserves the ability to sell
  compliance to a different market later.
- **When it wins:** if there is a real, funded intent to keep BOTH products.

### (b) Status quo, hardened by the boundary ratchet

Keep everything; rely on the PR5 guardrail to stop agri and core from
re-entangling, and on the device telemetry to inform a later call.

- **Cost:** Low now. Ongoing carrying cost of 53% dormant schema (migrations,
  test surface, mental load) and the risk that the two domains slowly re-couple
  despite the ratchet (the ratchet stops imports, not shared platform drift).
- **Benefit:** Zero disruption; buys time to gather a month of usage data before
  committing. The seam is enforced, so the option value of (a) or (c) is
  preserved cheaply.
- **When it wins:** as an explicit *time-boxed* holding pattern while the
  telemetry accrues — NOT as a permanent answer.

### (c) Continue the prune, toward removal

Finish what #203 / #206 started: remove the compliance modules from the product
(UI → API → schema), in that order, behind the module-gate so no tenant loses
data mid-flight.

- **Cost:** Medium, spread over several PRs. Each removal is a focused,
  reversible step (gate off → drop routes → drop tables once no tenant enables
  the module). Irreversible only at the final schema drop.
- **Benefit:** The product becomes what it is actually used as. The phone
  navigation budget is freed for agriculture. Schema, tests, and cognitive load
  all shrink. The rebrand becomes real, not skin-deep.
- **When it wins:** if the telemetry confirms the compliance core is unused (or
  desktop-only for a population that is churning), which the organic prune
  already suggests.

## Recommendation

**Adopt (b) as an explicit, time-boxed holding pattern (≈1 month) to collect the
module × device telemetry, with the stated intent to proceed to (c).** Option
(c) is already underway de facto — this memo's job is to make it *deliberate*
rather than accidental. Reach for (a) only if a funded decision to keep the
compliance product materialises before the holding period ends.

The PR5 boundary ratchet (0 violations today) makes (b) safe and keeps the door
to both (a) and (c) open at low cost. Re-evaluate once
`module.access.count{module,device}` has a month of data.
