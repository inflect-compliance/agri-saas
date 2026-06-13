# 2026-06-13 — RQ3-OB-B — Polish (skeletons + explainer retry + ALE sort)

**Commit:** `pending` (branch `claude/rq3-ob-b-polish`)

## Design

Three small, independent improvements on the risk surfaces.

### 1. Skeletons on the two main detail pages

The risk + control detail pages used to return empty children inside
`<EntityDetailLayout loading title="">` while the page-data SWR call
resolved:

```tsx
return (
    <EntityDetailLayout loading title="" breadcrumbs={breadcrumbs}>
        <></>           // ← bare layout chrome flashed before content
    </EntityDetailLayout>
);
```

Both now render `<SkeletonDetailPage />` (already exists in
`@/components/ui/skeleton`). The placeholder paints the breadcrumb,
title, meta pills, and a card stub so the page reads as intentional
content rather than a render miss during the cold-load 150–400ms window.

### 2. Score-explainer Retry on error

The popover's error state used to be a one-line dead end:

```tsx
{state === 'error' && (
    <p>Couldn't load the explanation.</p>     // ← stranded
)}
```

The fetch was inlined inside `onOpenChange`, so to re-try the user had
to close + re-open. That's a hidden mode. The fetch is now hoisted into
`loadExplanation()` and the error state carries an explicit Retry
button that calls the same path:

```tsx
{state === 'error' && (
    <div data-testid="score-explainer-error">
        <p>Couldn't load the explanation.</p>
        <button onClick={loadExplanation} data-testid="score-explainer-retry">
            Retry
        </button>
    </div>
)}
```

The lazy-fetch ratchet was updated to assert the new shape (open-change
calls `loadExplanation()`; the function holds the only `fetch(` site).

### 3. ALE sortability on the risks register

The register surfaced ALE as a compact chip next to the score column,
but the column wasn't sortable — an analyst with a 200-row register
couldn't pivot to "the ones the money points at" without exporting.

Three small additions:

- `'ale'` added to `sortableRiskColumns`.
- A new `case 'ale': { return v ?? -Infinity; }` arm in the sort
  accessor — honest-null: un-quantified rows sort to the bottom on
  desc (where you want them) and to the top on asc.
- A new column with `id: 'ale'`, `header: 'ALE'`, and a compact-currency
  cell — the header click is what triggers the sort. The inline chip
  next to the score stays (RQ2-5 / RQ3-4 side-by-side); the new
  column is the sort handle.

## Files

| File | Role |
| --- | --- |
| `src/components/RiskScoreExplainer.tsx` | Hoisted `loadExplanation`; error branch carries Retry |
| `src/app/t/[tenantSlug]/(app)/risks/[riskId]/page.tsx` | `<SkeletonDetailPage />` in the loading shell |
| `src/app/t/[tenantSlug]/(app)/controls/[controlId]/page.tsx` | `<SkeletonDetailPage />` in the loading shell |
| `src/app/t/[tenantSlug]/(app)/risks/RisksClient.tsx` | `'ale'` sortable + accessor arm + new column |
| `tests/guards/rq3-ob-b-polish.test.ts` | 7 structural ratchets |
| `tests/guardrails/risk-score-explainer.test.ts` | Existing ratchet updated for the hoisted fetch shape |
| `tests/rendered/score-explainer-retry.test.tsx` | 1 rendered test on the Retry behaviour |

## Decisions

- **`SkeletonDetailPage`, not page-bespoke skeletons.** The shared
  primitive already exists and renders the exact layout the
  `EntityDetailLayout` skeleton fills; reusing it keeps both detail
  pages on the same shell.
- **Retry button outside the existing `<p>`.** The text "Couldn't load
  the explanation." stays as the headline; the button sits below as
  an explicit affordance. A "click anywhere to retry" pattern was
  considered and rejected — the button is a clearer signal that the
  user controls the recovery.
- **ALE column AND inline chip.** Two displays of the same value is
  intentional. The inline chip preserves the RQ2-5 / RQ3-4
  side-by-side qual↔quant visual; the column gives the sort handle.
  A "remove the inline chip" PR would regress the prior pattern.
- **`-Infinity` sentinel for un-quantified rows.** Honest-null in
  sort: clusters them at the right end of the order for both
  directions without showing a fabricated zero in the column cell
  (which renders an em-dash instead). The sort and the cell agree.
