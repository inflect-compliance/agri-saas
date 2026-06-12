# 2026-06-12 — RQ3-2: range-first estimation — calibrated intervals replace point floats

**Commit:** _(see PR — `feat(rq3-2): range-first estimation — calibrated intervals replace point floats`)_

## Design

The FAIR panel took single point floats — the false-precision ritual
Martin-Vegue's calibration chapters demolish — while the PERT-triple
machinery (RQ-1 `fairInputsJson` + the RQ-3 simulator) sat unused by
the form. RQ3-2 turns the panel range-first:

**Five calibrated ranges, one renderer.** The panel asks for the five
`FairDistributions` factors (TEF, vulnerability, PLM, SLEF, SLM) as
min/likely/max triples under the calibrated-interval legend ("give
the range you're 90% sure contains the true value"). The point-era
sub-factor decompositions (CF×P(action) → TEF, capability vs control
→ vulnerability, cost components → PLM) are gone as INPUTS — their
information folds into the seeds (below). The derived point estimate
(Beta-PERT mean, `pertMean = (min + 4·mode + max)/6`, new in
`fair-calculator.ts`) is SHOWN per factor (`fair-derived-{k}`), never
asked.

**Backward-compatible round-trip.** `seedTriples` (exported for unit
coverage) prefers stored `fairInputsJson` triples; otherwise legacy
point values — including the sub-factor derivations — migrate as
degenerate triples (min = likely = max). Degenerate triples PERT-mean
back to the original point, so a load→save round-trip of legacy data
is value-identical.

**Write path.** The PUT body gains `distributions` (five nullable
triples). When present, the usecase persists the provided triples to
`fairInputsJson` (the simulator's preferred input — point risks keep
their auto ±20% spread because point-era rows leave the JSON null),
derives the point columns from the PERT means, clears the legacy
sub-factor columns (single-source semantics), and lets the existing
`recomputeFairDerived` produce LEF/fairAle from the derived means.
The legacy point path is untouched for API consumers — except a
numeric point write now clears stale stored triples so the simulator
never prefers ranges the points have moved past (confidence-only
writes leave triples alone).

**Engine-safety canonicalisation.** Wire triples are sorted before
persisting (`normalizeTriple`): a mode outside [min, max] would NaN
the simulator's triangular inverse-CDF. The UI's warn-only validator
already surfaced the inversion; the write path just refuses to store
a poisoned triple. Zod deliberately does NOT hard-reject ordering —
the warn-only contract stays intact end-to-end.

**Calibration aids extended to ranges (RQ2-7 carry-over).**
`reflectTriple` mirrors the likely value in each factor's register
and appends a spread call-out once the range is complete and spans an
order of magnitude ("that's a ~40× spread; anchor it with a reference
event"). `validateFairTriples` runs `validatePertTriple` per complete
factor plus the factor-specific bounds checks (probabilities on 0–1,
no negative losses/frequencies) on every entered bound. Warn-only by
contract — the save button couples to `saving` only.

## Files

| File | Role |
| --- | --- |
| `src/app/t/[tenantSlug]/(app)/risks/[riskId]/FairAnalysisPanel.tsx` | range-first panel rewrite + `seedTriples` |
| `src/lib/fair-calibration.ts` | `FairFactorKey`, `reflectTriple`, `validateFairTriples` |
| `src/app-layer/usecases/fair-calculator.ts` | `pertMean` |
| `src/app-layer/usecases/risk.ts` | distributions write path, `normalizeTriple`, stale-triple guard |
| `src/app/api/t/[tenantSlug]/risks/[id]/fair/route.ts` | `distributions` zod schema |
| `src/app/t/[tenantSlug]/(app)/risks/[riskId]/page.tsx` | threads `fairInputsJson` into the panel |
| `tests/guards/rq3-2-range-first.test.ts` | the new ratchet |
| `tests/guards/rq2-7-calibration.test.ts` | re-grounded for the triple shape (same contracts) |

## Decisions

- **The five canonical factors, not twelve triple inputs.** Making
  every sub-factor a triple would force interval arithmetic through
  non-monotonic derivation formulas and triple the form. Calibrating
  the factor itself IS the methodology the issue cites; the
  decomposition was a point-estimate crutch, preserved only as seed
  information.
- **Sub-factor columns cleared on the distributions path.** Once a
  range save lands, the panel is the single source; leaving stale
  CF/PoA/component costs behind would silently resurrect them if a
  user later cleared a triple (recomputeFairDerived falls back to
  components). Their information lives on in the seeded ranges.
- **Sort-on-write over hard zod rejection.** Rejecting inverted
  triples at the route would convert the warn-only contract into a
  blocking one at the worst moment (after the click). Sorting is a
  deterministic canonicalisation of a three-value calibration set,
  it is unit + integration tested, and the live warning has already
  told the user what will happen.
- **Ratchet shape** (`rq3-2-range-first.test.ts`): bans the point-era
  `field(...)` inputs (exactly one `<Input` render site — the bound()
  helper); pins the 90%-sure legend, the derived-mean chip, the
  degenerate-seed migration, the spread call-out, the live
  `validateFairTriples` wiring, the route schema, the PERT-mean
  derivation, the sort canonicalisation, and the stale-triple guard.
