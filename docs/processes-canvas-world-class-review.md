# Processes Canvas — World-Class Architecture Review

*Roadmap-27 PR-C (prompt 7). A holistic product + architecture
review of the Processes page: where it stands after R25 → R27, and
what still separates it from a best-in-class process-architecture
design tool. Repo-grounded and implementation-shaped.*

---

## Current maturity assessment

The Processes page is, after Roadmaps 25–27, a **competent process
canvas** — and, as of R27, a **visually resolved** one. It has:

- A persisted graph model (`ProcessMap` / `ProcessNode` /
  `ProcessEdge` / `ProcessEdgeControl`) with tenant-scoped RLS.
- A curated seven-kind node taxonomy, three shapes, three size
  variants.
- A three-variant edge language (flow / conditional / reference)
  and edge-mounted controls.
- Proximity auto-bind, an inspector, save / rename / duplicate.
- A deliberate visual system: recessed canvas plane, elevated
  frame, tonal depth ramp, calm dot grid.

What it is **not yet**: a *tool*. It is still a **feature** — a
place to draw boxes and lines that happen to be themed for
compliance. The boxes are not yet wired to the compliance graph;
the map cannot be trusted as a system of record; an author has no
help keeping a large map tidy, correct, or navigable. A world-class
process-architecture tool is judged on three axes — **trust**
(does the map mean something?), **scale** (does it stay legible at
40+ nodes?), and **flow** (does authoring feel effortless?). Today
the page scores well on none of them.

**Maturity: ~6/10.** A strong, well-architected foundation with a
resolved visual language — but the load-bearing "architecture tool"
capabilities are absent.

---

## What is still missing for world-class quality

1. **Semantic truth.** Control / risk / asset nodes and
   edge-controls are free-text labels. `ProcessEdgeControl.controlId`
   (an FK to the real `Control` row) exists in the schema but is
   never populated by the UI. A map cannot answer "which processes
   touch this control?" — the single most valuable question a
   compliance process map should answer.
2. **Scale legibility.** No minimap, no auto-layout, no semantic
   visibility layers. Past ~30 nodes the canvas becomes a maze.
3. **Authoring flow.** No undo/redo, no multi-select, no
   alignment / distribution, no snapping, no keyboard shortcuts
   beyond xyflow defaults. Every authoring mistake is permanent or
   manual to fix.
4. **Correctness.** Nothing validates the graph — dangling steps,
   unreachable branches, decision nodes with a single exit all ship
   silently.
5. **Trust over time.** `ProcessMap.version` is bumped on every
   save but there is no history / restore UI. An accidental
   destructive save is unrecoverable.
6. **Portability.** No export. A process map cannot leave the app
   into an audit pack, a board deck, or a PDF.
7. **Comprehension aids.** Seven node kinds + three edge variants
   and no legend. A first-time reader must reverse-engineer the
   vocabulary.
8. **Metadata.** `ProcessMap.description` and `status`
   (DRAFT/ACTIVE/ARCHIVED) exist in the schema; only `name` is
   surfaced. A map has no owner, no lifecycle, no review date.

---

## Additional high-value improvements

Beyond the explicitly-requested R27 work, the highest-leverage
additions — in priority order — are **semantic linkage** (#1
below), **scale tooling** (minimap + auto-layout), and **authoring
safety** (undo/redo). These three move all three axes — trust,
scale, flow — at once.

---

## 10 concrete upgrades

### 1. Link nodes + edge-controls to real compliance entities
- **Why:** Turns the map from a drawing into a queryable governance
  artefact. The `controlId` FK already exists — this is the
  difference between "a feature" and "a tool".
- **Repo areas:** `prisma/schema/processes.prisma` (add
  `linkedEntityType` / `linkedEntityId` to `ProcessNode`, or use
  `dataJson`); `ProcessMapRepository`; `ProcessInspector` (an
  entity picker — reuse `<Combobox>` / `<UserCombobox>` pattern);
  a `processesUsingEntity(entityId)` query.
- **Scope:** Control / risk / asset nodes + `ProcessEdgeControl`
  gain an optional link to a real row. Inspector shows a picker.
  Linked nodes render a subtle "linked" affordance + deep-link.
- **Acceptance:** A control node can be bound to a `Control`; the
  control's detail page can list "appears in N processes"; the link
  survives save/load.

### 2. Minimap (node-count gated)
- **Why:** R25 rejected the minimap as clutter — correct at 5
  nodes, wrong at 50. Gate it: show only past a threshold.
- **Repo areas:** `PersistedProcessCanvas` (xyflow `<MiniMap>`).
- **Scope:** `<MiniMap>` mounts when `nodes.length > 25`, styled to
  the `--canvas-*` ramp, bottom-right, low opacity at rest.
- **Acceptance:** ≤25 nodes → no minimap; >25 → minimap present and
  token-themed; ratchet locks the threshold.

### 3. Undo / redo
- **Why:** The single biggest authoring-confidence gap. R26
  explicitly deferred it.
- **Repo areas:** `PersistedProcessCanvas` (a bounded
  nodes+edges history stack); a `useGraphHistory` hook.
- **Scope:** ⌘Z / ⌘⇧Z via `useKeyboardShortcut`; ~50-step ring
  buffer; toolbar buttons.
- **Acceptance:** Add/move/delete/edit are all reversible;
  redo invalidates on a new mutation.

### 4. Multi-select + alignment / distribution
- **Why:** Tidy maps read as authoritative; ragged maps read as
  drafts. Hand-aligning nodes one by one is hostile.
- **Repo areas:** `PersistedProcessCanvas` (xyflow box-select is
  built in); an alignment toolbar that appears on multi-select.
- **Scope:** Align left/center/right/top/middle/bottom; distribute
  horizontally / vertically. Operates on the selected node set.
- **Acceptance:** Selecting ≥2 nodes reveals the alignment cluster;
  each action is undoable (depends on #3).

### 5. Auto-layout ("Tidy")
- **Why:** One click from chaos to a legible layered graph — the
  highest-wow, highest-scale-value feature.
- **Repo areas:** `PersistedProcessCanvas`; a layout module
  wrapping `dagre` or `elkjs` (layered, L→R).
- **Scope:** A "Tidy layout" toolbar button re-positions all nodes
  via a layered algorithm; animated transition; undoable.
- **Acceptance:** A hand-drawn tangle becomes a clean L→R layered
  graph; positions persist on save.

### 6. Edge label editing
- **Why:** `ProcessEdge.labelOverride` exists in the schema and
  round-trips, but nothing writes it. Decision branches especially
  need labels ("Yes" / "No").
- **Repo areas:** `ProcessEdge` (inline edit on selection or an
  edge inspector); `PersistedProcessCanvas`.
- **Scope:** A selected edge can take a short text label rendered
  near the midpoint.
- **Acceptance:** Edge labels persist; conditional edges out of a
  decision can be labelled.

### 7. Legend + semantic-layer visibility toggles
- **Why:** Seven kinds + three edge variants need a key; a
  "flow-only" focus mode strips context nodes to reveal the spine.
- **Repo areas:** `PersistedProcessCanvas` (a collapsible legend
  panel; visibility state per category).
- **Scope:** A legend mapping shape/accent → meaning; toggles to
  hide `context` / `note` categories.
- **Acceptance:** Legend reflects the live taxonomy; toggling a
  layer hides/shows those nodes without deleting them.

### 8. Graph validation
- **Why:** A process map that ships with unreachable steps is worse
  than no map. Quiet, non-blocking validation builds trust.
- **Repo areas:** A `validateProcessGraph` pure function; a quiet
  validation badge in the toolbar.
- **Scope:** Detect dangling nodes (no edges), unreachable nodes,
  decision nodes with <2 outgoing edges. Surfaced as a calm
  count, click to highlight — never a blocking modal.
- **Acceptance:** Each rule is a pure, unit-tested predicate; the
  badge reflects the live graph.

### 9. Version history + restore
- **Why:** `ProcessMap.version` increments already; make it
  recoverable. Removes the fear of a destructive save.
- **Repo areas:** `prisma/schema/processes.prisma` (a
  `ProcessMapSnapshot` table or graph-JSON archive per save);
  `ProcessMapRepository`; a history drawer.
- **Scope:** Each save archives the prior graph; a drawer lists
  versions with restore.
- **Acceptance:** Restoring version N − 1 reproduces that graph
  exactly; history is tenant-scoped.

### 10. Export to PNG / PDF
- **Why:** Process maps belong in audit packs and board decks. A
  map trapped in the app is half a deliverable.
- **Repo areas:** `PersistedProcessCanvas` (xyflow
  `getNodesBounds` + `toPng` from `html-to-image`); wire into the
  existing audit-pack export.
- **Scope:** Export the current map to PNG (and PDF via the
  existing PDF pipeline), token-themed, attribution-free.
- **Acceptance:** Export reproduces the visible graph at print
  resolution; lands as an audit-pack artefact.

---

## Product architecture recommendations

- **Lean on `dataJson`.** `ProcessNode.dataJson` and
  `ProcessEdge.dataJson` are the correct forward-compat seam (R27
  already persists node size there). Per-type payloads — entity
  links, layout hints, validation overrides — ride here without a
  migration per feature.
- **One linkage model.** When wiring upgrade #1, pick ONE shape —
  an optional `(linkedEntityType, linkedEntityId)` pair — and use
  it for control / risk / asset uniformly. `ProcessEdgeControl`
  already has `controlId`; generalise rather than add three
  bespoke FKs.
- **Keep the usecase/repository boundary.** All graph mutation
  already flows through `ProcessMapRepository.replaceGraph` inside
  a transaction — keep new writes there; never let the canvas
  component reach Prisma.
- **Honour the reserved optimistic lock.** `ProcessMap.version` is
  documented as a reserved optimistic-concurrency hint. Before any
  multi-user work, enforce it at `replaceGraph` (reject a save
  whose base version is stale) — it is the seam collaboration will
  need.
- **xyflow discipline holds.** Continue treating `@xyflow/react`
  as the only graph dependency; add `dagre`/`elkjs` for layout as a
  pure peer, not a second canvas framework.
- **Validation as a pure module.** `validateProcessGraph` must be a
  pure function over `(nodes, edges)` — testable without a DOM, and
  reusable server-side for an audit-time check.

---

## UX / visual recommendations

- The R27 visual system (recessed plane, elevated frame, tonal
  ramp, solid elevated nodes) is the right foundation — **do not
  re-skin it**. Future work layers ON it.
- **Comprehension before features.** Ship the legend (#7) early —
  it makes every other node/edge feature self-explanatory.
- **Progressive disclosure.** Minimap, alignment cluster, and
  validation badge should appear only when earned (node count,
  multi-select, a real issue). The calm empty canvas is a feature.
- **One affordance language.** Edge affordances, the inspector, and
  any new toolbar controls must share the chrome vocabulary R27
  established — hairline borders, frame surface, brand only for
  state.
- **Authoring feedback.** Undo/redo and auto-layout should animate
  — a silent jump erodes the sense of a tool that is "alive".
- **Keep the brand quiet.** Brand colour stays reserved for
  selection / focus / preview. Never tint a node fill or an edge by
  brand for decoration.

---

## What to avoid

- **A BPM execution engine.** No tokens, no swimlane simulation, no
  runtime. This is an *architecture design* surface, not a workflow
  engine — the moment it executes processes it inherits a decade of
  BPMN complexity.
- **Shape proliferation.** Three shapes is the ceiling. BPMN-style
  event/gateway/timer primitives would turn the canvas into a
  sticker sheet.
- **Always-on chrome.** A permanent minimap, a permanent toolbar
  ribbon, permanent property panels — each is clutter at the small
  graph size that is the common case.
- **Real-time multi-user collaboration now.** It is a large,
  separate epic; do the optimistic-lock groundwork first, ship it
  on its own.
- **Free-form node resize.** Discrete sizes keep maps aligned; a
  drag-resize handle invites ragged, unprofessional maps.
- **Gamification / decoration.** No confetti, no neon, no
  gratuitous motion. Restraint is the brand.
- **A second source of truth.** The map must reference the
  compliance graph, never fork it — no map-local "controls" that
  drift from the real `Control` table.

---

## Final acceptance criteria for "world-class"

The Processes page is a world-class process-architecture design
tool when **all** of the following are true:

1. **It tells the truth.** Control / risk / asset elements on a map
   link to real compliance rows, and those rows can list the
   processes that reference them.
2. **It scales.** A 60-node map stays legible — minimap to
   navigate, auto-layout to tidy, visibility layers to focus.
3. **Authoring is forgiving.** Every action is undoable; multi-
   select + alignment make a tidy map cheap; keyboard shortcuts
   carry the power user.
4. **It is trustworthy over time.** Saves are versioned and
   restorable; the graph is validated; nothing is silently lost.
5. **It travels.** A map exports cleanly into an audit pack or a
   PDF at print quality.
6. **It is self-explanatory.** A legend + consistent visual
   language let a first-time reader understand a map without a
   tutorial.
7. **It stays calm.** Every capability above is progressively
   disclosed; the empty canvas and the small map are still quiet,
   premium, and uncluttered.

R27 delivered criterion 7's foundation and the visual language
criterion 6 depends on. Criteria 1–5 are the roadmap beyond.
