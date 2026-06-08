# 2026-06-08 — Visual Rule Editor VR-3: Bidirectional Schema Bridge

**Commit:** `<sha>` feat(processes): VR-3 — canvas ↔ AutomationRule sync bridge

The architectural keystone — the highest-risk epic. Keeps `ProcessNode`
geometry and `AutomationRule` logic in sync as two sibling projections of one
source of truth, **without ever mixing the two** (the invariant a desync would
require a migration to untangle).

## The invariant (locked day one)

```
ProcessNode owns GEOMETRY (posX/posY/parentNodeKey/label) + the link (dataJson.ruleId)
AutomationRule owns LOGIC (triggerEvent / filter / action / chain)
The ONLY thing the bridge writes to a node is dataJson.ruleId (an opaque id).
Geometry NEVER appears in a rule write.
```

`tests/guards/vr3-sync-invariant.test.ts` enforces this structurally from day
one (the roadmap's explicit requirement): it strips comments and asserts the
sync service never references `posX`/`posY`/`parentNodeKey` and never writes
`triggerFilterJson`/`actionConfigJson` to a node.

## Design

```
canvas-rule-sync.ts
  syncCanvasToRules (Canvas → Rules, on save):
    • each NEW action node → create a DRAFT stub rule, write ruleId back
    • chain-delay edges (action → action) → set source rule nextRuleId/Delay
    • NEVER copies node logic to the rule
  hydrateCanvasFromRules (Rules → Canvas, on load):
    • merge live rule status + executionCount + subtitle into the node for
      DISPLAY only (not persisted)

process-map usecase: gates both on canvasMode === 'AUTOMATION'
  saveProcessMap → syncCanvasToRules; getProcessMap → hydrateCanvasFromRules
```

## Decisions

- **An `action` node owns the rule.** A single `AutomationRule` is
  trigger+filter+action in ONE row, but the canvas models those as separate
  nodes. Making the action node own the rule keeps exactly one rule per action
  node; trigger/condition nodes feed that rule via the inspector (VR-4), which
  edits the rule directly — NOT through this sync. Documented deviation from
  the roadmap's "process every trigger/condition/action node" wording, chosen
  for correctness (no 3-rules-per-flow explosion) + invariant safety.
- **Sync mutates rules only by creation + chain topology.** Name/logic edits
  happen on the rule via the inspector; the node↔rule name is intentionally
  decoupled (node label = canvas display; rule name = internal/Rules-tab) to
  avoid the tenant-unique-name collision/idempotency trap on every save.
- **Stub rule name = `Canvas rule · <nodeKey>`** — guaranteed unique, never
  re-synced; the user renames via the inspector.
- **`ProcessNode`/`ProcessEdge` added to `LIST_MODELS_TENANT_INDEX_SUFFICIENT`**
  — the sync findMany's one map's bounded graph, covered by
  `@@index([tenantId, processMapId])`.
- **`CanvasSyncStatus` context** (`synced`/`pending`/`error`) ships for the
  doc-bar indicator (surfaced in a later canvas-UI epic).
