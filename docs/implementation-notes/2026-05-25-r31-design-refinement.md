# 2026-05-25 — R31 — Design refinement of the Processes canvas

**Commits:** R31 Bundles 1-9 (PRs #717 · #718 · #719 · #720 · #721 · #722 · #723 · #724 · TBD).

R31 closes the first round of canvas design refinement against the
brutal-verdict review (the "Steve Jobs" review). The verdict
identified 10 PRs against the Processes canvas; this round shipped
the visible, structural, and chrome-language items as 8 focused
bundles, with two items deferred to the next round.

## Design philosophy enforced

Seven non-negotiables the verdict laid out, all observable in the
post-R31 canvas:

1. **One bar above the canvas.** Pre-R31 the page carried five
   horizontal bands. Post-R31 the document bar is the single
   strip; the page-level `<Heading>` + breadcrumbs + description
   are retired (Bundle 3). The CanvasHelpStrip was retired
   entirely (Bundle 1).
2. **Tools live on the side.** The ProcessPalette moved from a
   horizontal top strip to a vertical 56px left rail with
   category dividers (Bundle 4). Eye-flow is Western-reading L→R.
3. **The background is a whisper.** Two-layer dot grid + radial
   vignette (Bundle 1). The fine grid only surfaces when snap is
   engaged — gives the R28 snap toggle a *visible* meaning.
4. **One node vocabulary.** Diamond shape retired; decision uses
   the rect chassis with a corner sticker. Dashed border on the
   `subtle` accent retired (Bundle 2).
5. **Connections are first-class.** Chip-styled edge labels via
   EdgeLabelRenderer (Bundle 7). Edge hover-state thickening
   shipped in R27-PR-B (pre-existing — discovered during R31
   discovery, no new code required).
6. **The inspector is a panel, not an exception.** Both inspector
   modes (node + edge) wrap inside `<AsidePanel>` for Risks +
   Controls parity. Same surfaceKey for both modes (Bundle 5).
7. **Power-user gestures are canonical.** Canvas command palette
   on `/` exposes every R28-R31 verb across Document / Selection /
   Modes groups (Bundle 8). xyflow's MiniMap + Controls overlays
   at the canvas bottom corners (Bundle 6).

## Bundles → roadmap items

| Bundle | PR # | Roadmap items closed | Highlight |
| --- | --- | --- | --- |
| **1** | #717 | PR 3 + PR 8 | Two-layer Background + vignette · CanvasHelpStrip retired · empty-state cleanup |
| **2** | #718 | PR 4 | Diamond retired · corner-sticker affordance |
| **3** | #719 | PR 1 | Page header retired; inline document bar |
| **4** | #720 | PR 2 | Vertical 56px left palette |
| **5** | #721 | PR 6 | Inspector → AsidePanel parity |
| **6** | #722 | PR 7 | MiniMap + zoom controls overlays |
| **7** | #723 | PR 5 (chip-label slice) | Chip-styled edge labels |
| **8** | #724 | PR 9 | `/` canvas command palette |
| **9** | TBD | Round close-out | This document + capstone ratchet |

## Deferred to R32 (next round)

Two items from the original 10 explicitly deferred:

- **PR 5 (remaining slices)** — selection-aware emphasis (dim
  unconnected nodes when a node is selected) + endpoint dots on
  hover. The chip-label slice shipped in Bundle 7; the other
  two slices need a context-or-zustand layer to plumb the
  emphasis state through the node + edge renderers.
- **PR 10** — `<PersistedProcessCanvas>` file decomposition.
  The file sits at ~1,950 lines post-R31 (up from 1,695 pre-R31).
  Most of the components the verdict called for already exist
  as separate files (`<ProcessPalette>`, `<ProcessInspector>`,
  `<CanvasCommandPalette>`, the xyflow MiniMap + Controls
  primitives). The remaining decomposition is extracting the
  document bar JSX into `<CanvasDocumentBar>` + consolidating
  the three save serialisers into `useProcessMapDocument`. Both
  are pure refactors with non-trivial prop-threading; held for
  a dedicated bundle so they can be tested against the existing
  R26-R31 ratchets without bundle pressure.

## Files

(Per-bundle file lists live in the bundle PR descriptions —
#717 through #724 + the capstone PR.)

## Decisions

- **Bundling.** The verdict named 10 PRs; the bundling memory
  (`feedback_bundle_prs`) calls for 3-5 items per PR to compress
  CI cycles. R31 split the difference: 8 bundles, each tight
  enough to reason about as one diff, large enough to ship
  visible product change. Per-item ratchet files preserved.
- **Test-id preservation across structural moves.** Bundle 3
  (document bar) and Bundle 5 (inspector AsidePanel) both moved
  JSX around heavily without changing public-facing data-testid
  markers. Every R26-PR-E + R28 ratchet stayed green by keeping
  the inner markers stable.
- **Pre-existing flake call-out.** A jest parallel-runner flake
  on `tests/rendered/org-drilldown-load-more.test.tsx` was
  verified to exist on main (with all R31 changes stashed) and
  documented in Bundle 7's PR description rather than worked
  around. CI's `test:ci` runs `--runInBand` so the flake doesn't
  appear in the pipeline.

## Round outcome

Eight bundles. Nine of the ten verdict items shipped in some
form. Two slices explicitly deferred to R32 with written
rationale. Every change carries a structural ratchet (the eight
`r31-*.test.ts` files + edits to nine pre-existing ratchets).
The canvas now obeys the seven design principles the verdict
laid down.
