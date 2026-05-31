# 2026-05-31 — Button label centering (guarded)

> **Superseded same day** by
> `2026-05-31-button-clean-fill-centering.md`. The balance-ghost
> mechanism described below was reverted on user feedback: the buttons
> still read as untidy because the iridescent `::after` was filling the
> whole button (a separate mask-shorthand bug), and the user wanted the
> `+ word` UNIT centred rather than the label alone. The follow-up
> fixes the mask and centres the whole content unit (no ghosts).

**Commit:** `<sha> fix(ui): center button labels + balance ghost for trailing content`

## Design

User report: two button-styled controls rendered their text label
off-centre.

1. **Control-status trigger ("Implemented")** — a `<Combobox>` trigger
   pinned to a fixed `w-40` with `matchTriggerWidth`. The combobox
   trigger is intentionally left-aligned (value left, chevron right —
   the conventional select shape), but a fixed width far wider than the
   content left a large void on the right. Empirically reproduced with
   a static-CSS Playwright harness + a centre crosshair.

2. **"Resolve overdue tasks" dashboard CTA** — a plain text `<Button>`.
   The same harness showed it IS centred (`justify-center` + a single
   label child). No defect; the suspected drift did not reproduce.

The Button primitive already centres labels via `justify-center` and,
since PR-B, balances a LEADING icon with an invisible trailing
"icon-balance ghost" so `[icon][gap][label]` doesn't push the label
right of centre. The gap: trailing content via the `right` prop had no
mirror, so `[label][gap][right]` pushed the label LEFT. (The `right`
prop is currently unused on `<Button>` app-wide — this is defensive.)

Fixes:

- **Primitive** — add a LEADING balance ghost mirroring `right`
  (gated `right && content && !shortcut && !icon`), the mirror of the
  existing trailing icon ghost. `shortcut` buttons stay deliberately
  left-aligned (command-palette pattern); icon-only buttons need no
  balancing.
- **Call site** — drop the status combobox's `w-40` + `matchTriggerWidth`
  so the trigger hugs its content (no void); the dropdown auto-sizes to
  the options.

## Files

| File | Role |
| --- | --- |
| `src/components/ui/button.tsx` | New leading `data-right-balance-ghost`. |
| `src/app/t/[tenantSlug]/(app)/controls/[controlId]/page.tsx` | Status combobox hugs content (removed `w-40` + `matchTriggerWidth`). |
| `tests/rendered/button-label-centering.test.tsx` | Behavioural lock — the right balance ghost renders per prop shape; exceptions (shortcut, icon-only) don't. |
| `tests/guards/button-label-centering.test.ts` | Static lock — primitive keeps `justify-center` + both ghosts; no `<Button>` call site overrides centring; status trigger has no fixed width. |

## Decisions

- **Centring is enforced at the primitive, not per call site.** Every
  product button flows through `<Button>`, so locking the primitive's
  `justify-center` + balance-ghost mechanism "dynamically centres" all
  current and future buttons. The guard reads `button.tsx` source so a
  refactor can't silently drop a ghost.
- **`w-full` carve-out in the call-site scan.** Full-width buttons that
  left-align (`w-full justify-start`) are the conventional menu /
  action-list item shape (e.g. `selection-summary-panel.tsx`) — a
  deliberate, distinct intent. A label-shifting class is a violation
  only on a non-`w-full` (content- or fixed-width) button — which is
  exactly the reported `w-40 justify-start` void class.
- **Select/combobox triggers are out of scope by construction.** Their
  left-alignment lives inside the Combobox primitive's own
  `justify-start`, not a `<Button className>` override, so the scan
  never flags them. The status void was a fixed-width misuse, not a
  primitive defect — fixed by hugging content.
- **Verification was empirical.** jsdom has no layout engine, so the
  rendered test locks the DOM mechanism; the actual centring was
  confirmed by rendering real markup against the compiled Tailwind CSS
  and screenshotting with a centre crosshair (before/after).
