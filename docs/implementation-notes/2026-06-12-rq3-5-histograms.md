# 2026-06-12 — RQ3-5: from heatmaps to histograms — literally

**Commit:** _(see PR — `feat(rq3-5): ALE histogram as a peer view; cell-collision flags on both views`)_

## Design

Cox's range-compression critique made literal: two risks in the same
matrix cell can differ 40× in ALE, and the matrix structurally cannot
say so. Two moves:

**The histogram is a peer view.** The risks page's view toggle grows
from a two-state icon flip to a three-option `ToggleGroup`
(Register / Matrix / Histogram), persisted per tenant via
`useLocalStorage('inflect:risks-view:<slug>')` — the polish-#13
pattern. The new `<AleHistogram>` chart primitive
(`src/components/ui/charts/ale-histogram.tsx`, barrel-exported)
buckets quantified risks into log-x decade buckets (equal width per
decade — log scale via exponents on a linear scale, so the appetite
line lands at its exact log position), stacks each bar by the risk's
tenant matrix band (the same colours the heatmap paints), and draws
`singleRiskAleMax` as a dashed reference line — honest here, because
the histogram's x-axis IS per-risk ALE (the same cap RQ3-1
deliberately kept OFF the portfolio LEC). Empty between-buckets stay
visible: a gap in the loss distribution is information.

**Cell collisions flag on both views.** The pure detector
(`src/lib/risk-collisions.ts::detectCellCollisions`) finds cells
where ≥2 positively-quantified risks differ more than 10×
(`COLLISION_RATIO_THRESHOLD`), worst first. The heatmap path:
RisksClient computes → `RiskMatrixDataCell.collisionRatio` →
`RiskMatrixCell` renders a decorative `≠` marker with the words in
the aria-label and tooltip ("ALEs in this cell differ ~41× … check
the histogram view"). The histogram path: a callout list under the
chart names both risks with both figures and the ratio; clicking
drills into the cell's risks via the same score-filter contract as
the heatmap's `onCellClick`.

**A11y.** The svg carries a generated plain-language summary
("12 quantified risks across 4 buckets …; tallest bucket …"), and
every non-empty bucket is a keyboard-focusable group whose
aria-label reads its range + per-band counts.

## Files

| File | Role |
| --- | --- |
| `src/lib/risk-collisions.ts` | pure collision detector |
| `src/components/ui/charts/ale-histogram.tsx` (+ barrel) | the histogram primitive (`bucketByDecade` exported pure) |
| `src/app/t/[tenantSlug]/(app)/risks/RisksClient.tsx` | persisted 3-view toggle, appetite fetch, histogram body + callouts, collision merge into matrix cells |
| `src/components/ui/RiskMatrix.tsx` / `RiskMatrixCell.tsx` | `collisionRatio` pass-through + `≠` marker + tooltip/aria words |
| `messages/{en,bg}.json` + risks page | `histogram` label key |
| `tests/guards/rq3-5-histograms.test.ts` | the ratchet |

## Decisions

- **Zero-ALE risks carry no magnitude information.** A €0 "estimate"
  would make every cell an infinite collision; the detector requires
  strictly positive ALEs and ≥2 of them per cell.
- **Threshold exclusive at 10×.** "More than 10×" per the issue;
  exactly 10× is loud-but-fair range use.
- **Decade buckets, not fancier binning.** Half-decade or
  Freedman–Diaconis bins would look smarter and read worse; decades
  match how people say money (€10K–€100K) and how the priors
  (RQ2-7) anchor.
- **Ratchet shape** (`rq3-5-histograms.test.ts`): pins the persisted
  three-view union + storage key + ToggleGroup, the barrel export +
  band stacking + appetite wiring, the a11y summary + focusable
  buckets, the detector's purity + threshold, and the full collision
  path on both views (client → matrix → cell marker; callout list +
  drill-down).
