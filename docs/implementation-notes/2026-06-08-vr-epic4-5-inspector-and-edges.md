# 2026-06-08 — Visual Rule Editor VR-4 + VR-5: Inspector & Chain Edges

**Commits:** VR-4 inline automation inspector · VR-5 semantic chain edges

Completes the "minimum viable visual editor" (VR-1…VR-5): a practitioner can
design a complete automation workflow on canvas — typed nodes, inline rule
config, semantically-typed edges — that syncs to live `AutomationRule` rows.

## VR-4 — Automation Inspector Panel

`AutomationInspectorPanel.tsx` renders inline rule config when an automation
node is selected; mounted from `ProcessInspector` gated on
`useIsAutomationMode()` + `isAutomationNodeKind(data.kind)`.

- Per-kind forms: trigger → event combobox; action → action-type combobox;
  slaGate → SLA window stepper; condition → filter summary (full DSL edit in
  the builder). Plus name + enable toggle for all.
- Auto-saves to the linked rule (`dataJson.ruleId`, set by the VR-3 sync) via
  `PUT /automation/rules/[id]` — single-field edits are valid because the
  Update schema's action-config superRefine only fires when actionType AND
  actionConfig are sent together. **Edits the rule only** — never writes logic
  back to the node (VR-3 invariant).
- Unsynced state: a node with no `ruleId` shows a "save the canvas first" hint.

## VR-5 — Visual Chain Edges & Branch Routing

`edge-kind-inference.ts` — pure `(sourceKind, targetKind) → AutomationEdgeKind`
over the 6 kinds (`trigger-flow` / `condition-pass` / `condition-fail` /
`chain-delay` / `sla-breach` / `sla-pass`). `branchAlternatives()` gives the
pass/fail (breach/on-time) toggle for the two branching sources (condition,
slaGate); everything else is inferred.

`ProcessEdge.tsx` — `AUTOMATION_EDGE_STYLE` map drives a per-kind stroke +
label chip (`✓ Pass` green, `✗ Fail` red dashed, `Chain` dotted, etc.) when
`edge.data.edgeKind` is an automation kind. `edgeKind` stays a free `String`
column — no migration; documented in `processes.prisma`.

## Decisions / deferrals

- **The in-canvas edge-kind picker** (drop-to-connect from a condition/slaGate
  node prompting pass-vs-fail) is deferred — the inference default
  (`condition-pass` / `sla-pass`) covers the common path; the explicit branch
  flip lands with the run-overlay UI work (VR-6). The inference +
  `branchAlternatives` primitives are ready for it.
- **Inspector auto-save is PUT-per-field**, not a batched form submit — matches
  the roadmap's "auto-save on blur, no save button" and keeps the canvas the
  single editing surface.
