# Processes Canvas (Roadmap-25)

A visual-only canvas under **Manage → Processes** for mapping
business and IT processes and placing governance controls on the
connections between process steps. Built on
[`@xyflow/react`](https://github.com/xyflow/xyflow) (already
installed for the traceability `<GraphExplorer>`); IC owns the
visual language via custom node / edge / overlay components.

## Architecture (top → bottom)

| Layer | File | Owns |
|---|---|---|
| Route | `src/app/t/[tenantSlug]/(app)/processes/page.tsx` | Server entry, `force-dynamic`, delegates to client |
| Page client | `.../processes/ProcessesClient.tsx` | `<WorkspaceShell>` mount, dynamic-import boundary (`ssr:false`) for xyflow |
| Shell | `src/components/layout/WorkspaceShell.tsx` | 3-slot canvas-centric shell (Header / Toolbar / Body). Sibling of `<ListPageShell>` / `<EntityDetailLayout>` |
| Canvas | `src/components/processes/PersistedProcessCanvas.tsx` | The live canvas — xyflow `<ReactFlowProvider>` + `<ReactFlow>`, save/load, toolbar, drag-drop. (`ProcessCanvas.tsx` is the R25 standalone wrapper, kept for tests.) |
| Palette | `src/components/processes/ProcessPalette.tsx` | Chrome palette row, HTML5-draggable node-kind stamps. Exports `PALETTE_DRAG_MIME` |
| Custom node | `src/components/processes/ProcessTypedNode.tsx` | Memo-wrapped typed node — seven kinds, three shapes (rect / real diamond / note), three size variants |
| Custom edge | `src/components/processes/ProcessEdge.tsx` | Memo-wrapped bezier edge — three-variant connection language + `<ControlOnEdge>` overlay |
| Inspector | `src/components/processes/ProcessInspector.tsx` | Right-side property panel for the selected node (label / subtitle / size) |
| Sidebar nav | `src/components/layout/SidebarNav.tsx` | "Process" entry in Manage section, `Workflow` lucide icon |

## Interaction model (R25-PR-E)

Constrained by intent — visual-only authoring:

| Gesture | Result |
|---|---|
| Drag from palette → drop on canvas | Creates a `processStep` node at the drop coordinates (`screenToFlowPosition` accounts for pan + zoom) |
| Drag from node handle → drop on another node handle | Creates a `processEdge` connection |
| Click on edge | Selects the edge; shows the midpoint affordance cluster (variant cycle + "Add control") |
| Click the variant affordance | Cycles the connection variant: flow → conditional → reference |
| Click "Add control" | Adds a `<ControlOnEdge>` overlay with default label "Control" |
| Select a node → Inspector | Edit the node's label, subtitle and size (`sm` / `md` / `lg`) |
| Backspace | Deletes the selected node or edge (xyflow default) |
| Trackpad drag / scroll | Pans / zooms (xyflow default) |

## Shipped since R25

- **Persistence** — R26-PR-A. Maps save/load via
  `/api/t/:slug/processes/:id` (`ProcessMap` + `ProcessNode` +
  `ProcessEdge` tables).
- **Node taxonomy** — R26-PR-B. Seven kinds, three shapes.
- **Inspector / properties panel** — R26-PR-E (`ProcessInspector`).
- **Visual system + graph language** — R27 PR-A/B.

## Deliberate non-features

Still considered and **rejected** in scope:

- **Process execution / simulation / engine** — the canvas is a
  visual-architecture surface, not a workflow engine.
- **Templates / process library** — out of scope (see the R27
  world-class review for the case to add it later).
- **Right-click context menus** — locked OUT by the R25-PR-E ratchet
  (`onEdgeContextMenu` may not be wired).
- **Inline label editing for controls** — controls get a default
  label "Control"; renaming is a future expansion.
- **MiniMap + pan/zoom Controls bar** — locked OUT by the R25-PR-F
  ratchet. They read as clutter on a calm surface; trackpad gestures
  carry the interaction.
- **Linking control overlays to actual `Control` rows in the
  database** — future expansion seam: `<ControlOnEdge>` accepts a
  `controlId` prop that fetches the linked control row.
- **Export (PNG / JSON / SVG)** — out of scope.
- **Multi-user / live cursors** — out of scope.

The architecture leaves room for each of these without building
them now.

## xyflow adoption discipline

What's adopted:

- The `<ReactFlow>` canvas + `<ReactFlowProvider>` context
- `<Background variant="dots">` (IC tokens for color)
- `<BaseEdge>` + `getBezierPath` + `<EdgeLabelRenderer>` for custom edges
- `<Handle>` for node connection points
- `useReactFlow().setEdges` / `applyNodeChanges` / `addEdge` helpers
- `screenToFlowPosition` for drop coordinate conversion

What's deliberately rejected:

- `<MiniMap>` — too much chrome on a calm canvas
- `<Controls>` — pan/zoom toolbar adds visual chatter
- `xyflow/system` low-level imports — `@xyflow/react` covers the API
- The xyflow attribution badge — `proOptions={{ hideAttribution: true }}`

## Visual contract (Roadmap-27 PR-A)

The Processes surface uses a dedicated **`--canvas-*`** token family
(`src/styles/tokens.css`, exposed via the Tailwind `canvas` colour
group) — a deliberate depth ramp, not the flat blue-on-blue of the
R25/R26 draft:

| Layer | Token | Role |
|---|---|---|
| Page shell | `--bg-page` | App background behind the frame |
| Workspace frame | `--canvas-frame` | Elevated panel — holds the chrome (toolbar + palette + help) and the inspector |
| Canvas plane | `--canvas-surface` | The **recessed** working surface — deepest tone + a top inner shadow (`--canvas-recess`) so it reads as sunk below the chrome |
| Nodes | `--canvas-node` / `--canvas-node-muted` | Solid **elevated** cards (`--canvas-shadow`) — flow nodes brightest, context nodes quieter |
| Grid | `--canvas-grid` | Quiet dot grid, 24px spacing |
| Hairlines | `--canvas-border` | Dividers between chrome strips + frame/inspector edges |

Container architecture: **page → workspace frame → { chrome zone,
recessed canvas plane, inspector }**. The frame is `rounded-lg`,
`overflow-hidden` (inner strips clip to its corners), `shadow-lg`.
Tonal separation — frame vs recessed plane vs elevated node — does
the structural work; hairlines, not heavy panels, divide the chrome.

- Process step nodes: solid elevated card, brand selected ring (matches `<KpiFilterCard>`)
- Node shapes (R27 PR-B): rect / real diamond (decision) / note; three `sm·md·lg` size variants on `data.size`
- Edges (R27 PR-B): bezier, `var(--canvas-edge)` stroke at rest, `var(--brand-default)` selected. Three variants on `data.variant` — `flow` (solid) · `conditional` (dashed) · `reference` (dotted), cycled from the edge selection affordance, persisted via `edgeKind`
- Control overlays: pill at edge midpoint, `<ShieldCheck>` icon prefix, `border-emphasis` + `bg-bg-elevated`

## Test layout

| Layer | File | Owns |
|---|---|---|
| Route + shell + nav | `tests/guards/r25-pra-route-and-shell.test.ts` | WorkspaceShell API, page mounts shell, Manage entry |
| Canvas + palette | `tests/guards/r25-prb-canvas-integration.test.ts` | xyflow imports, drag-drop wiring, palette mime |
| Custom node | `tests/guards/r25-prc-process-step-node.test.ts` | Node component + handles + canvas registration |
| Custom edge + overlay | `tests/guards/r25-prd-edge-and-control-overlay.test.ts` | Edge component + EdgeLabelRenderer + node-vs-control distinction |
| Interaction | `tests/guards/r25-pre-interaction-model.test.ts` | Add-control affordance + explicit-absence locks |
| Polish + capstone | `tests/guards/r25-prf-polish-and-capstone.test.ts` | Empty state + restraint (no MiniMap) + meta-lock |

## Adding a new node type

1. Create `src/components/processes/<Name>Node.tsx` with the same
   shape as `<ProcessStepNode>` (memo-wrapped, two handles,
   selected-ring contract).
2. Export a `<NAME>_NODE_TYPE` constant.
3. Add it to `NODE_TYPES` in `ProcessCanvas.tsx`.
4. Add a palette entry in `ProcessPalette.tsx` (currently a
   single-item array; extend with the new entry).
5. Update the canvas `onDrop` to use the right type per palette
   payload (today the drop hard-codes `PROCESS_STEP_NODE_TYPE` —
   extending will require a typed `kind` field in the drag
   payload).
6. Add a per-type ratchet under `tests/guards/`.
