# 2026-05-31 — Clean primary-button fill + centred label

**Commit:** `<sha> fix(ui): clean primary button fill (iridescent 1px edge) + center label as a unit`

## Design

Follow-up to the same-day "button label centering" PR (#777). The user
showed screenshots of real primary action buttons ("Mark Test
Completed", "Request exception", "+ Asset", "+ Control") that looked
untidy: an orange→navy gradient washing across the whole button, a
low-contrast label, and the text not reading as centred. The ghost-
based centering from #777 hadn't fixed the *perceived* problem.

Two independent root causes, both reproduced against the compiled CSS
with a Playwright + centre-crosshair harness:

1. **Iridescent edge filled the whole button.** `iridescentEdge` paints
   a brand→secondary gradient on `::after` and clips it to a 1px ring
   with the classic mask-composite recipe. The recipe used the `mask`
   SHORTHAND, which resets every mask sub-property — including
   `mask-composite` — to its initial `add`. Tailwind emitted the
   `after:[mask:…]` utility AFTER `after:[mask-composite:exclude]`, so
   the shorthand's reset won the cascade: both mask layers ADDed → no
   1px exclusion → the gradient filled the entire button and overlaid
   (washed out) the label. This affected **every primary button
   app-wide** and had been shipping silently.

   Fix: drive the mask with LONGHANDS (`mask-image` + `mask-clip`,
   2 layers: content-box then border-box) which never touch
   `mask-composite`, so `exclude` survives regardless of utility order.

2. **Label centering philosophy.** #777 used invisible "balance ghosts"
   to centre the LABEL alone (treating a leading icon as decoration),
   padding the opposite edge. The user wanted the `+ word` UNIT centred
   ("counting the + to the text") and disliked the one-sided blank space
   the ghost created. Reverted both ghosts; the button now centres its
   whole content unit `[icon][gap][label]` via `justify-center` +
   hug-content. `+ Asset` now reads as a tidy, tightly-padded centred
   unit.

Result (faithful render, new DOM + rebuilt CSS): clean solid-orange
fill, crisp white label, subtle 1px iridescent rim, content centred.

## Files

| File | Role |
| --- | --- |
| `src/components/ui/button-variants.ts` | `iridescentEdge` mask: shorthand → `mask-image` + `mask-clip` longhands. |
| `src/components/ui/button.tsx` | Removed both balance ghosts; centre the content unit. |
| `tests/guards/r20-prb-liquid-edges.test.ts` | Mask assertion updated to the longhand form (+ asserts no shorthand). |
| `tests/guardrails/pr-b-tables-buttons.test.ts` | Ghost-existence assertion → asserts no ghost + justify-center. |
| `tests/guards/button-label-centering.test.ts` | Primitive contract: no ghosts + justify-center. |
| `tests/rendered/button-label-centering.test.tsx` | Behavioural: no ghost spans; content unit is the only flow group. |
| `tests/guards/action-button-canonical-entity-label.test.ts` | Comment-only: ghost → "centred unit". |
| `docs/ui-buttons.md` | Iridescent-edge entry notes the longhand-mask fix. |

## Decisions

- **Why longhand, not "reorder the shorthand."** Tailwind utility order
  isn't author-controllable, and the `mask` shorthand will always reset
  `mask-composite`. Longhands sidestep the reset entirely — order-
  independent and robust across browsers (verified: the 1px ring clips
  correctly in headless Chromium).
- **Why remove the ghost rather than keep centring the label.** The user
  is the design authority and was explicit: centre the `+ word` unit,
  no one-sided blank. Centring the whole unit is also the simpler,
  lower-surprise rule and needs no invisible DOM.
- **Verification was empirical throughout.** jsdom can't measure pixels,
  so the guard/rendered tests lock the mechanism (no ghosts,
  justify-center, longhand mask); the actual look was confirmed by
  dumping the real `<Button>` DOM and rendering it against the rebuilt
  Tailwind CSS with a centre crosshair.
