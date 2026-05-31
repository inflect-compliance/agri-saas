# Design System Guide

## Token Foundation

All UI styling targets semantic CSS custom properties defined in `src/styles/tokens.css`, mapped to Tailwind utilities in `tailwind.config.js`.

### Token Categories

| Category | CSS Variable | Tailwind Class | Usage |
|---|---|---|---|
| **Surfaces** | `--bg-default` | `bg-bg-default` | Cards, panels, modals |
| | `--bg-muted` | `bg-bg-muted` | Hover states, active surfaces |
| | `--bg-subtle` | `bg-bg-subtle` | Selection backgrounds, disabled |
| | `--bg-elevated` | `bg-bg-elevated` | Tooltips, dropdowns |
| | `--bg-page` | `bg-bg-page` | Page background |
| **Text** | `--content-emphasis` | `text-content-emphasis` | Headings, bold labels |
| | `--content-default` | `text-content-default` | Body text, table cells |
| | `--content-muted` | `text-content-muted` | Secondary text, placeholders |
| | `--content-subtle` | `text-content-subtle` | Disabled text, hints |
| **Borders** | `--border-default` | `border-border-default` | Standard borders |
| | `--border-subtle` | `border-border-subtle` | Soft dividers, card edges |
| | `--border-emphasis` | `border-border-emphasis` | Focused inputs |
| **Status** | `--bg-success` / `--content-success` / `--border-success` | `bg-bg-success` etc. | Success states |
| | `--bg-warning` / `--content-warning` / `--border-warning` | `bg-bg-warning` etc. | Warning states |
| | `--bg-error` / `--content-error` / `--border-error` | `bg-bg-error` etc. | Error/danger states |
| | `--bg-info` / `--content-info` / `--border-info` | `bg-bg-info` etc. | Informational states |
| | `--bg-attention` / `--content-attention` / `--border-attention` | `bg-bg-attention` etc. | Pending/needs-action |
| **Brand** | `--brand-default` | Direct or `brand-500` | Brand accent |

### Forbidden Patterns

Never use raw Tailwind color scales in migrated pages:

```tsx
// BAD — hardcoded colors break theming
<p className="text-slate-400">Muted text</p>
<div className="bg-slate-800 border-slate-700">Card</div>

// GOOD — semantic tokens
<p className="text-content-muted">Muted text</p>
<div className="bg-bg-default border-border-default">Card</div>
```

## Button Component

`src/components/ui/button.tsx` — the primary button primitive.

### Variants

| Variant | Usage | Key Tokens |
|---|---|---|
| `primary` | Main action (Save, Create) | `bg-brand-600`, `text-white` |
| `secondary` | Secondary action (Cancel, Back) | `bg-bg-default`, `border-border-subtle` |
| `outline` | Tertiary action | `border-border-subtle`, `bg-transparent` |
| `ghost` | Borderless (toolbar toggles) | `hover:bg-bg-muted` |
| `danger` | Destructive (Delete, Revoke) | `bg-red-600` |
| `danger-outline` | Soft destructive | `border-red-500/50`, `text-content-error` |
| `success` | Positive confirmation | `bg-emerald-600` |

### Sizes

| Size | Class | Height |
|---|---|---|
| `xs` | `h-7 text-xs` | 28px |
| `sm` | `h-8 text-xs` | 32px |
| `md` | `h-9 text-sm` | 36px |
| `lg` | `h-10 text-sm` | 40px |

### Usage

```tsx
import { Button, buttonVariants } from '@/components/ui/button';

// Interactive button
<Button variant="primary" onClick={save} loading={saving}>Save</Button>

// Button with icon
<Button variant="secondary" icon={<Filter className="size-4" />}>Filters</Button>

// Disabled with tooltip
<Button variant="primary" disabledTooltip="You need admin access">Delete</Button>

// Link styled as button (use buttonVariants)
import { cn } from '@dub/utils';
<Link href="/new" className={cn(buttonVariants({ variant: 'primary', size: 'md' }))}>
    + New Item
</Link>
```

### When to Use `Button` vs `buttonVariants`

| Scenario | Use |
|---|---|
| Clickable `<button>` element | `<Button>` component |
| `<Link>` styled as a button | `buttonVariants()` + `cn()` |
| Server component with navigation | `buttonVariants()` (no hooks needed) |
| Button with loading/disabled state | `<Button>` component |

### Liquid-carbon surface (Roadmap-19)

Buttons are not flat painted rectangles — every variant reads as a
deep, voluminous pool of **liquid carbon**: wet-looking, dark,
restrained (never a hard mirror shine). The system lives entirely in
`src/components/ui/button-variants.ts` + four `--btn-carbon-*` tokens
in `tokens.css`, and is built from three composable recipes.

**Tokens** (`tokens.css`, both themes):

| Token | Role |
|---|---|
| `--btn-carbon-overlay` | the soft elliptical light **pool** — a `radial-gradient`, theme-tuned, that reads as light gathering on a wet curved surface |
| `--btn-carbon-bevel` | the inset-led box-shadow that gives the surface **volume** (a soft top-edge highlight + faint bottom bounce + tight outer drop) |
| `--btn-carbon-border` | the **meniscus edge** — a hair darker than the surface so the silhouette stays crisp |
| `--btn-carbon-grain` | a grayscale fractal-noise data-URI — the micro-**grain** that gives the surface tactility (felt, not seen) |

**Recipes** (module-level `const` arrays, spread into the cva config):

| Recipe | What it does | Used by |
|---|---|---|
| `carbonSurface` | the full carbon field at rest — border + bevel + a `::before` depth-overlay stacking grain over the light pool | the solid-fill variants: `primary`, `secondary`, `destructive` |
| `carbonOnHover` | the same carbon field parked at `opacity-0` and faded in on hover — a transparent button has no rest-state surface to pool light on | the transparent variants: `ghost`, `destructive-outline` (the border is untouched — `ghost` stays borderless, `destructive-outline` keeps its red danger edge) |
| `carbonStates` | the three interaction states, all driven through one channel — the `::before` overlay's opacity — spread into the cva **base** so every variant inherits it | every variant |

**The interaction-state channel** (`carbonStates`): pressed / focus /
disabled all read as the liquid-carbon *material* responding, not as
generic CSS state changes:

- **pressed** (`active:before:opacity-70`) — the light pool dims; the
  surface depresses. Composes with the base `active:scale-[0.97]`
  press geometry.
- **focus** (`focus-visible:before:opacity-100`) — the carbon is
  revealed for keyboard users (parity with the hover lift). The a11y
  focus ring is untouched and stays the primary focus signal — carbon
  is depth, never a replacement for the ring.
- **disabled** (`disabled:before:opacity-0`) — the carbon goes inert:
  the depth-overlay drops out so a disabled button reads as flat,
  dead material.

All three ride `before:transition-opacity` (dropped under
`motion-reduce`). The bevel never rides `hover:shadow-*` — a
hover-driven box-shadow reads as a decorative depth-lift and is
banned by the motion-language ratchet; the carbon field's shadow is
gated on the `::before` instead.

**Invariants** are locked by four ratchets — extend the matching one
when you touch the carbon system:

| Ratchet | Locks |
|---|---|
| `tests/guards/r19-pra-carbon-surface.test.ts` | tokens + the `carbonSurface` recipe shape |
| `tests/guards/r19-prb-carbon-rollout.test.ts` | `carbonSurface` rollout to the solid variants |
| `tests/guards/r19-prc-carbon-hover-grain.test.ts` | the grain layer + `carbonOnHover` for the transparent variants |
| `tests/guards/r19-prd-carbon-states.test.ts` | `carbonStates` interaction channel + the R19 capstone (whole-system coherence) |

### CTA Order — modal/dialog footers (Roadmap-22 PR-E)

Every modal or dialog footer with a paired CANCEL + CONFIRM
follows the Mac/iOS convention: **secondary first in DOM order,
primary second**. With the footer's default `justify-end`
container, the visual result is `[Cancel] [Confirm]` right-
aligned — primary on the RIGHT, where the eye finishes a left-
to-right read.

`Modal.Confirm` ships this default. New modal call sites SHOULD
use `Modal.Confirm` (or the `ConfirmDialog` re-export) rather
than hand-rolling a footer. If you DO hand-roll a footer:

```tsx
<Modal.Actions>
  {/* Cancel FIRST */}
  <Button variant="secondary" onClick={onCancel}>Cancel</Button>
  {/* Confirm SECOND (primary OR destructive, depending on tone) */}
  <Button variant="primary" onClick={onConfirm}>Save</Button>
</Modal.Actions>
```

What this rule INVERTS: the Windows convention (primary LEFT) and
the "alphabetised by danger" pattern (destructive on the left,
neutral right). Both read as "OK Cancel" to a screen reader; the
visual placement is the affordance, and Mac/iOS users (the bulk
of the design vocabulary IC inherits from) expect primary-right.

The rule is locked by `tests/guards/r22-pre-variant-and-cta-order.test.ts`:
the `Modal.Confirm` source must render the Cancel button BEFORE
the Confirm button in JSX.

### Variant inventory (Roadmap-22 PR-E)

Five variants today:

| Variant | When to use |
|---|---|
| `primary` | The page's primary action. One per surface. |
| `secondary` | The page's secondary action(s). Multiple allowed. |
| `ghost` | Low-chrome action (toolbar, inline edit). |
| `destructive` | Destructive action with full confidence (Delete, Archive). |
| `destructive-outline` | Destructive action with LOWER confidence — the consequence is reversible OR the action is "remove this association", not "destroy this entity". Examples: Revoke API key, Disconnect integration, Remove MFA. |

The `destructive-outline` variant exists in 7 places. PR-E
reviewed but kept it — the visual distinction between
`destructive` (full red fill) and `destructive-outline` (red text
+ red border) IS the affordance difference between
"delete-and-it's-gone" vs "remove-this-link". A future PR may
fold them if the distinction stops earning its keep.

### Liquid Elegance (Roadmap-20)

R19 made buttons look like liquid carbon. R20 is the polish round
on top — four characteristics that take the carbon language from
"distinct" to "felt." Form controls (`<Input>`, combobox trigger,
date-picker trigger) get parity treatment so a focused input reads
like a cousin of a focused button.

**The four R20 characteristics:**

| | What lands | Where it lives |
|---|---|---|
| Iridescent edge | A 1px brand→secondary gradient stroke on `primary`'s `::after`, clipped via the mask-composite recipe. Always visible — iridescence is a material property, not a state. **2026-05-31:** the recipe was rewritten from the `mask` SHORTHAND to LONGHANDS (`mask-image` + `mask-clip`) — the shorthand silently reset `mask-composite` to `add`, so the gradient was filling the whole button (orange→navy wash + washed-out label) instead of a 1px ring. | `iridescentEdge` recipe in `button-variants.ts` |
| Aura wash | A brand-tinted (primary) / cool-neutral (secondary) halo on hover, painted via `::after`'s box-shadow. Routed through `hover:after:shadow-*` so the motion-language ratchet's `\bhover:shadow-` regex stays satisfied by design. | `auraPrimary` + `auraNeutral` recipes |
| Carbon glass | Ghost variant's hover fill drops to 75% + `backdrop-blur-sm` softens what shows through. Frosted-glass on hover. | `ghostGlass` recipe |
| Airy density | md/lg gain horizontal padding + (lg) gap; per-size letter-spacing replaces R19's flat `tracking-[-0.01em]` baseline (xs/sm open up positive, md/lg tighten — classical small→large typography rule). | `size: { … }` block in the cva config |
| Tactile press | `active:translate-y-px` composes with R11-PR4's `active:scale-[0.97]`: press = shrink + descend, reads as physical depression. Press-state ambient shadow collapses to one tight stop; focus-state ambient expands with a brand ring. | cva base + state-conditional overrides in `carbonSurface` |
| Form-control parity | `<Input>`, the date-picker trigger, and (transitively, via `<Button variant="secondary">`) the combobox trigger all wear `--ctrl-edge-{rest,hover,focus}`. The focus halo is a 3-stop shadow: brand ring + ambient drop, so focused controls read "warm AND raised" the way focused buttons do. | `control-variants.ts` + tokens.css `--ctrl-edge-*` |

**Tokens** added in PR-A (`tokens.css`, both themes):

| Token | Role |
|---|---|
| `--btn-ambient-{rest,hover,press,focus}` | 4-stop elevation scale: rest = two-stop drop, hover = same shape lifted, press = one tight stop, focus = brand-tinted ring stacked outside the rest drop |
| `--btn-iridescent-gradient` | 135° linear sweep brand → secondary, low-alpha — consumed via `border-image`-equivalent mask-composite recipe on `::after` |
| `--btn-aura-{primary,neutral}` | Pre-composed 3-stop box-shadow halos — painted via `hover:after:shadow-[...]` |
| `--ctrl-edge-{rest,hover,focus}` | Form-control parity edge tokens — controls don't carbon-fill, they carbon-edge |

**Why two pseudo-elements** (`::before` and `::after`):

R19's `::before` carries the depth overlay (grain + light pool +
bevel insets). R20's `::after` carries the outermost finish — the
iridescent edge (background + mask-composite) and the aura
(box-shadow). Two pseudos, two layers, no property conflict (edge
rides background + mask; aura rides box-shadow). CSS layers
`::after` above `::before` by default.

**Why aura uses `hover:after:shadow-*` not `hover:shadow-*`:**

The v2-PR-4 motion-language ratchet bans `hover:shadow-*` because
generic "drop shadow on hover" reads cheap on layout surfaces. The
R20 aura is NOT generic — it's a specific carbon-language halo
with restrained alpha + a specific 3-stop shape. Riding it through
`::after`'s box-shadow keeps the element's own shadow alone (so
R19's `--btn-carbon-bevel` survives) and skirts the regex BY
DESIGN (`\bhover:shadow-` requires `hover:` directly followed by
`shadow-`; `hover:after:shadow-` has `after:` between, so doesn't
match).

**R20 invariants** are locked by four ratchets:

| Ratchet | Locks |
|---|---|
| `tests/guards/r20-pra-foundation.test.ts` | Every token in both themes, the gradient shape, the aura stop count, `controlEdge` wiring, button↔control size lockstep, R19 carbon recipes still present |
| `tests/guards/r20-prb-liquid-edges.test.ts` | `iridescentEdge` / `auraPrimary` / `auraNeutral` / `ghostGlass` recipe shapes, per-variant wiring, the no-`hover:shadow-*`-on-element guarantee, Input + date-picker trigger control-edge wiring |
| `tests/guards/r20-prc-airy-density.test.ts` | Per-size padding scale, per-size tracking values, gap rhythm, disabled-fallback mirror in `button.tsx`, Label parity |
| `tests/guards/r20-prd-tactile-and-capstone.test.ts` | Tactile press translate, state-conditional ambient shadows, disabled iridescent dust-out, enriched `--ctrl-edge-focus`, the R20 capstone (all four PRs land coherent) |

## StatusBadge Component

`src/components/ui/status-badge.tsx` — semantic status indicator.

### Variants

| Variant | Usage | Tokens |
|---|---|---|
| `neutral` | Default, inactive | `bg-bg-subtle`, `text-content-muted` |
| `info` | Informational | `bg-bg-info`, `text-content-info` |
| `success` | Active, complete | `bg-bg-success`, `text-content-success` |
| `pending` | Needs action | `bg-bg-attention`, `text-content-attention` |
| `warning` | Caution | `bg-bg-warning`, `text-content-warning` |
| `error` | Error, critical | `bg-bg-error`, `text-content-error` |

### Usage

```tsx
import { StatusBadge, statusBadgeVariants } from '@/components/ui/status-badge';

// Standard badge
<StatusBadge variant="success">Active</StatusBadge>

// Without icon
<StatusBadge variant="warning" icon={null}>Pending</StatusBadge>

// With tooltip
<StatusBadge variant="error" tooltip="3 critical findings">Critical</StatusBadge>

// Clickable badge (use statusBadgeVariants on a <button>)
<button className={cn(statusBadgeVariants({ variant: 'info' }), 'cursor-pointer')}>
    Admin
</button>
```

### Variant Mapping Pattern

```tsx
const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
    ACTIVE: 'success',
    PENDING: 'warning',
    FAILED: 'error',
    INACTIVE: 'neutral',
};

<StatusBadge variant={STATUS_VARIANT[item.status] || 'neutral'} icon={null}>
    {item.status}
</StatusBadge>
```

## EmptyState Component

`src/components/ui/empty-state.tsx` — empty/missing content layout.

```tsx
import { EmptyState } from '@/components/ui/empty-state';
import { Search, Building2 } from 'lucide-react';

// Basic
<EmptyState icon={Building2} title="No vendors found" description="Add your first vendor to get started." />

// With CTA
<EmptyState icon={Building2} title="No vendors found" description="Get started by adding a vendor.">
    <Button variant="primary">+ Add Vendor</Button>
</EmptyState>

// Filtered empty state
<EmptyState icon={Search} title="No results" description="Try adjusting your filters." />
```

## Legacy System (Deprecating)

The old `.btn .btn-primary` and `.badge .badge-success` CSS classes in `globals.css` are **deprecated**. They remain for ~40 unmigrated pages. New pages must use the component primitives above.

### Migration Checklist

When migrating a page to the design system:

1. Replace `className="btn btn-*"` with `<Button>` or `buttonVariants()`
2. Replace `className="badge badge-*"` with `<StatusBadge>` or `statusBadgeVariants()`
3. Replace raw Tailwind colors (`text-slate-*`, `bg-slate-*`, `border-slate-*`) with semantic tokens
4. Replace empty-table markup with `<EmptyState>`
5. Add the page to `MIGRATED_PAGES` in `tests/guardrails/design-system-drift.test.ts`
6. Add assertions in `tests/guardrails/token-migration.test.ts`

## Guardrails

| Test File | What It Catches |
|---|---|
| `token-css-integrity.test.ts` | Missing CSS variables referenced by tailwind.config.js |
| `cva-primitives.test.ts` | Primitive API surface, semantic token usage, no raw colors |
| `token-migration.test.ts` | Migrated pages import and use the correct primitives |
| `design-system-drift.test.ts` | Raw colors reappearing in migrated pages, duplicate components |
| `button-consistency.test.ts` | Ad-hoc inline button styling in page files |
| `legacy-ui-ratchet.test.ts` | Prevents net-new `className="btn …"` / `className="badge …"` usage — ratchet only goes down |
| `theme-provider.test.ts` | ThemeProvider + ThemeToggle contract, legacy→semantic token alias bridge in globals.css |

## Theme Switching

Epic 51 also shipped runtime theme switching. `ThemeProvider` (mounted in
`src/app/providers.tsx`) reads the user's stored preference, falls back to
`prefers-color-scheme`, and writes `data-theme="dark"` or `"light"` on
`<html>`. Every semantic token in `tokens.css` carries both palettes so
every token-driven component (CSS classes **and** CVA variants) flips in
sync.

Consumers:

```tsx
import { useTheme } from '@/components/theme/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

const { theme, setTheme, toggle } = useTheme();
// or drop the ready-made icon button:
<ThemeToggle />
```

The toggle is already mounted in the sidebar footer (desktop) and the
mobile top bar. Don't mount a second instance — `useTheme()` is available
from any client component inside the providers tree.

### What the token bridge unlocked

- `globals.css`'s `.btn`, `.badge`, `.glass-card`, `.input`, `.nav-link`,
  `.icon-btn` all now resolve to `var(--bg-*)` / `var(--content-*)` /
  `var(--border-*)` / `var(--brand-*)`. Swapping the active theme via
  `[data-theme="light"]` changes those classes with zero code touch.
- Legacy alias variables (`--bg-primary`, `--brand`, `--text-secondary`,
  etc.) are preserved as thin delegations in `globals.css` so any remaining
  `var(--bg-primary)` callers keep rendering.
- The CVA primitives (`buttonVariants`, `statusBadgeVariants`) already
  consumed the semantic tokens before Epic 51 remediation; the bridge just
  brings the *CSS class* layer into the same palette.

### Carved Carbon (Roadmap-22)

R19 gave buttons the liquid-carbon LANGUAGE; R20 made them ELEGANT.
R22 is the precision-refinement layer — five micro-detail moves
that take the silhouette from "premium" to "carved/precision-
machined". The R22 prompts converged on "carved, not inflated" as
the target aesthetic.

| PR | Lock |
|---|---|
| **A** Radius | `rounded-lg` (12px) → `rounded-[10px]` across button + control family. xs keeps `rounded-md` (pill avoidance at h-7). |
| **B** Border + Focus | `--btn-carbon-border` softened (dark α 0.30→0.18; light α 0.24→0.16). Tailwind `ring-2 ring-offset-2` dropped from cva base; focus rides the brand-tinted box-shadow halo via `focus-visible:shadow-[var(--ctrl-edge-focus)]`. Focused button + focused Input wear the same halo. `--btn-ambient-focus` ring tightened 4px → 3px. |
| **C** Icon discipline | Per-size icon scale via `[&_svg]:size-N` — xs/sm 14px · md 16px · lg 18px. Plus defensive `[&_svg]:shrink-0`. |
| **D** Disabled + Loading | Graded disabled mute via `disabled:saturate-50` on top of `disabled:opacity-50` (colour channel drops too). LoadingSpinner switched from hardcoded grey to `currentColor` (variant-aware). |
| **E** Variant + CTA order | Mac/iOS CTA order locked in `Modal.Confirm` (Cancel-then-Confirm DOM → `[Cancel] [Confirm]` right-aligned). Variant inventory documented; 5-variant count locked. |

The five R22 ratchets at
`tests/guards/r22-pr{a..e}-*.test.ts` form a contract surface;
the PR-F capstone ratchet at `r22-prf-capstone.test.ts` asserts
file-existence on all five so a future PR can't silently strip
one. Each PR's own assertions remain the substantive guard.

## Liquid Glass (Roadmap-24)

R24 swaps the button MATERIAL — from R19–R22's solid/machined
carbon to liquid glass — while reusing the existing composition
seams (R19's `::before` depth + R20's `::after` finish). What
changes is the recipe content inside; the API surface stays put.

External reference: [callstack/liquid-glass](https://github.com/callstack/liquid-glass).
Portable techniques (alpha-tinted backdrop + `backdrop-filter`,
1px gradient edge-sheen, layered inner-glow + outer-rim) were
adapted; the React Native / iOS-native runtime wrapper was
deliberately rejected — wrong stack.

| PR | Lock |
|---|---|
| **A** Glass token foundation | 5 `--btn-glass-*` tokens per theme (`-tint`, `-blur`, `-edge`, `-inner`, `-shadow`). Light + dark parity from day one. Namespace sealed — no `--ctrl-glass-`, no `--btn-frost-`, no `--btn-glass2-`. |
| **B** Primitive redesign | `glassSurface` / `glassOnHover` replace `carbonSurface` / `carbonOnHover` in every variant. R19-PR-D `carbonStates` (material-agnostic state opacity) + R20-PR-B iridescent/aura layers survive the swap. Zero `--btn-carbon-*` references left in cva variants. |
| **C** Slim radius | `rounded-[10px]` (R22-PR-A) → `rounded-[8px]` across button + control family. Completes the glass story — translucent surfaces want slimmer corners; big-radius reads plastic. Heights stay h-9 (form-control parity locked by R20-PR-A). |
| **D** State + a11y | `prefers-reduced-transparency: reduce` fallback strips `backdrop-blur` + forces `::before` to opacity-100 (WCAG 1.4.11; matches native control behaviour when users enable "Reduce Transparency"). R22-PR-D's two-channel disabled mute (opacity-50 + saturate-50) preserved. R20-PR-D ambient-elevation contract (active = collapsed; focus = brand-tinted halo) preserved. |
| **E** Icon-button rollout | Gear button (two implementations) moved from legacy `rounded-lg` (12px) to the slim `rounded-[8px]`. The toolbar now reads as one chassis instead of two systems. |
| **F** Hardening + capstone | Meta-ratchet locks all 6 R24 ratchets; defense-in-depth re-asserts the reduced-transparency fallback + slim radius + glass token namespace seal. |

The six R24 ratchets at `tests/guards/r24-pr{a..f}-*.test.ts`
form a contract surface; the PR-F capstone asserts file-existence
on all six so a future PR can't silently strip one. Each PR's own
assertions remain the substantive guard.

### When NOT to use glass material

- Page-level hero / dashboard surfaces — R17 already owns that
  language (ambient brand glow + 600ms rise-in). Don't paint glass
  on top of an already-rich surface.
- Sidebar / topbar chrome — R13/R14/R15 own those aesthetics.
- Form inputs (Input, Combobox trigger, DatePicker trigger) — they
  share the slim 8px radius + the focus halo, but the surface fill
  is opaque (transparency on a form field obscures content).

### Accessibility contract

- WCAG 1.4.11 (reduced transparency): the cva base ships the
  `prefers-reduced-transparency: reduce` media query fallback.
- WCAG 2.1.1 (keyboard accessible): focus-visible halo is distinct
  from hover; both are visible without colour-only cues.
- WCAG 2.5.5 (target size): default md height is h-9 (36px), above
  the AAA 44×44 recommendation when combined with padding (md ≥
  px-2.5 brings the click target above the bar in all sizes ≥ sm).
