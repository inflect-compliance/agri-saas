# 2026-06-08 — Visual Rule Editor VR-8 + VR-10: Export & Governance Graph

**Commits:** VR-8 automation canvas export · VR-10 cross-map governance graph

These close the Visual Rule Editor roadmap (VR-1…VR-10).

## VR-8 — Automation Canvas Export & Audit Documentation

`automation-export.ts`:
- `summarizeRuleExecutions` — **pure** aggregator (unit-tested): folds 30-day
  execution rows into per-rule evidence (success rate over terminal runs,
  chained-rule id) + a tenant-wide 30-day rollup.
- `buildAutomationEvidencePack(ctx, mapId, now)` — assembles the map's rules
  (its action nodes' linked rules, VR-3) + 30-day aggregates into a structured
  **Compliance Evidence Pack** suitable for an ISO 27001 audit pack / SOC 2
  evidence request. `POST /processes/[id]/export-automation`.
- The PDF "Workflow Diagram" export backs off the same assembled data through
  the existing process-export pipeline.

## VR-10 — Multi-Canvas Governance Graph

`governance-graph-builder.ts`:
- `buildGovernanceGraph(maps, links)` — **pure** assembler (unit-tested):
  one node per map (size by rule volume, ring by execution health via
  `healthFor` thresholds — green ≥ 0.9, amber ≥ 0.7, red), edges for cross-map
  `subflow-call` relationships. Drops self-loops, links to unknown maps, and
  duplicates so the graph is always renderable.
- `getGovernanceGraph(ctx, now)` — fetches every map + its action/group nodes +
  rules + 30-day executions, derives the map↔group↔rule linkage (an action
  node owns a rule; a `group` node owns a sub-flow group; a rule's
  `subFlowGroupId` → the group's map), and assembles the meta-graph.
  `GET /processes/governance-graph`.
- `/processes/governance` page — focused v1 renders the meta-graph as a
  health-ringed card grid + a sub-flow-calls list.

## Decisions / deferrals

- **Both cores are pure functions over already-fetched data** — the audit math
  (success rates, health thresholds) and the graph assembly (node/edge
  derivation, self-loop/duplicate pruning) are unit-tested without a DB.
- **The full xyflow meta-canvas** (draggable map nodes, thumbnail previews,
  framework-coverage overlay) is the remaining UI enhancement — the builder +
  API already return xyflow-ready `{ nodes, edges }`, so it's a rendering swap.
  The card-grid v1 is fully functional + reachable at `/processes/governance`.
- **The ProcessesClient "Governance Graph" nav entry** is a one-line link
  follow-up; the route is reachable directly today.
