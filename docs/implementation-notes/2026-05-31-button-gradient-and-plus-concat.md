# 2026-05-31 — Action-button gradient fill + `+Noun` concatenation

**Commit:** `<sha> feat(ui): gradient fill on action buttons + concatenate Plus to label`

## Design

Two user-directed changes to the primary "action" buttons, on top of
the same-day clean-fill/centering fix:

1. **Return the orange→navy gradient.** Earlier the gradient was an
   *accident* — the iridescent `::after` flooded the button when its
   mask clip failed (fixed in the prior PR, leaving a clean solid
   fill). The user liked the gradient and asked for it back. It is now
   an **intentional, opaque gradient FILL** via a new token
   `--btn-gradient-primary` (brand the dominant first ~45%, secondary
   blue/navy tail). Because it's the button *background* (behind the
   label) rather than an `::after` overlay, the white label stays
   crisp — the washed-out text of the old accidental version does not
   return.

2. **Concatenate the Plus: `+Asset`, not `+ Asset`.** CLAUDE.md
   mandates the `+` ride the `icon` slot (never as label text), so the
   concatenation is done visually: each create button's `<Plus />`
   carries `-mr-2.5` (−10px), which absorbs the 8px icon↔label gap plus
   the lucide glyph's internal padding so the `+` sits flush to the
   noun. The label stays the i18n noun; the canonical icon-slot
   pattern is preserved.

## Files

| File | Role |
| --- | --- |
| `src/styles/tokens.css` | New `--btn-gradient-primary` (dark + light themes), derived from `--brand-default` + a per-theme secondary blue/navy. |
| `src/components/ui/button-variants.ts` | Primary fill → `bg-[image:var(--btn-gradient-primary)]`; hover → `brightness-110` (preserve gradient). `glassSurface`/`iridescentEdge`/`auraPrimary` spreads kept. |
| 12 entity create-button sites (`AssetsClient`, `ControlsClient`, `RisksClient`, …) | `icon={<Plus />}` → `icon={<Plus className="-mr-2.5" />}` so `+` concatenates. |
| `tests/guardrails/cva-primitives.test.ts` | Primary-token assertion → `--btn-gradient-primary`. |
| `tests/guards/action-button-canonical-entity-label.test.ts` | Plus-icon regex allows the `-mr-…` className. |

## Decisions

- **Gradient as background, not `::after` overlay.** The whole point of
  the previous bug was that an `::after` gradient sits *above* the
  label and washes it out. Painting the gradient as the button's own
  `background-image` keeps the label crisp. The 1px iridescent
  `::after` rim is retained (now correctly clipped) — harmless and
  same-hue against the gradient body.
- **Hover brightens, doesn't flatten.** `hover:brightness-110` keeps
  the gradient on hover; the old `hover:bg-[var(--brand-default)]`
  would have collapsed it to a flat brand fill.
- **`-mr-2.5` on the icon, not gap-0 on the button.** Every create
  button uses the exact token `icon={<Plus />}`, so a per-icon negative
  margin is a uniform, sed-safe change that survives the varied button
  tag shapes (inline vs multi-line, with/without className) — and keeps
  the `+`-in-icon-slot convention CLAUDE.md requires (never `+` as
  label text). −10px was chosen empirically (screenshot harness) to
  read as a flush `+Noun` without overlapping.
- **Verified empirically** (real `<Button>` DOM rendered against the
  rebuilt Tailwind CSS, light theme, centre crosshair): gradient fill,
  crisp centred label, `+Asset`/`+Control`/`+Risk` concatenated.
