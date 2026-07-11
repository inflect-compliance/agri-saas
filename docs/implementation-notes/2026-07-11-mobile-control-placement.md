# 2026-07-11 — Mobile control placement (Roadmap-6 P4)

**Commit:** `<pending>` fix(mobile): move primary controls into the thumb zone

## Design

On a 390px screen the product's primary controls sat in the hardest
thumb zone (top corners) or were buried several taps deep. Four
independent placement fixes, each mobile-only, desktop untouched:

1. **Toaster** — a new `<ResponsiveToaster>` in `providers.tsx` swaps
   the single hard-coded `position="top-right"` for a viewport-driven
   choice: `bottom-center` below `md`, `top-right` at `md+`. A
   `matchMedia('(min-width: 768px)')` effect drives it; `isMdUp` starts
   `true` so SSR + first paint match the desktop default (no hydration
   mismatch) and reconcile on mount (invisible — no toast at mount). The
   bottom offset (`3.5rem + safe-area + 1rem`) clears the fixed
   BottomTabBar + device safe-area, mirroring the FAB / bottom-tab-spacer
   offset. Both `offset` (sonner's 600–767px band) and `mobileOffset`
   (sonner's <600px band) carry the same clearance so the whole `<md`
   range is consistent.

2. **FAB rollout** — the existing `<Fab>` primitive (already on
   tasks/farm-tasks/journal) now also mounts on locations, exchange,
   inventory, and planning. Each wires `onClick` to the SAME handler its
   header create button calls, `md:hidden` so the header button stays the
   desktop affordance. Inventory's FAB opens the New product flow (the
   foundational record — a lot can't exist without a product, and it's
   the empty-state's primary action too).

3. **Touch targets** — the DEFAULT (`md`) size of both `<Button>` and
   `<Input>` gains a responsive `min-h-[44px] md:min-h-9`: 44px (WCAG
   2.5.5 / Apple HIG) on phones, back to `h-9` (36px) on desktop. Only
   `md` is touched — the compact `xs`/`sm`/`icon` sizes used in dense
   tables + toolbars keep their heights, so no density regression.

4. **Language toggle** — surfaced at the mobile drawer's top level. The
   existing `<UserMenuLanguageToggle>` now also renders inside
   `SidebarContent` in a `md:hidden` labelled row. Because the desktop
   sidebar is `hidden md:flex`, the `md:hidden` row only ever paints in
   the mobile drawer instance — desktop keeps the account-menu path.

## Files

| File | Role |
| --- | --- |
| `src/app/providers.tsx` | `<ResponsiveToaster>` — viewport-driven sonner position + tab-bar-clearing offset |
| `src/components/ui/button-variants.ts` | `md` size gains `min-h-[44px] md:min-h-9` |
| `src/components/ui/input.tsx` | `md` size gains `min-h-[44px] md:min-h-9` (Button parity) |
| `src/components/layout/SidebarNav.tsx` | mobile-only language-toggle row in `SidebarContent` |
| `src/app/t/[tenantSlug]/(app)/locations/LocationsClient.tsx` | `<Fab>` → New location |
| `src/app/t/[tenantSlug]/(app)/exchange/ExchangeClient.tsx` | `<Fab>` → Create offer |
| `src/app/t/[tenantSlug]/(app)/inventory/InventoryClient.tsx` | `<Fab>` → New product |
| `src/app/t/[tenantSlug]/(app)/planning/CropPlansClient.tsx` | `<Fab>` → New crop plan |
| `messages/{en,bg}.json` | `sidebarNav.language` + per-page `fabLabel` (real Bulgarian) |
| `tests/e2e/mobile/forms.spec.ts` | FAB-rollout coverage + 44px touch-target assertions |
| `tests/e2e/mobile/nav.spec.ts` | toast host bottom-placement + tab-bar clearance |

## Decisions

- **Assert the toast HOST, not a live toast.** The e2e checks
  `[data-sonner-toaster][data-y-position="bottom"]` + a ≥56px computed
  bottom offset. Sonner always renders the host `<ol>` for the active
  position (even with zero toasts), so this proves placement
  deterministically without a mutation — a live toast would need a
  reliable, page-specific trigger and would be flakier.
- **Only `md` was floored to 44px.** `md` is the default Button/Input
  size, so it covers "primary" targets. Raising `sm`/`xs`/`icon` too
  would balloon dense toolbars + table rows and modal confirm buttons
  (deliberately `sm`) — the density guards (r20/r24/page-actions) would
  also fail. The responsive `md:min-h-9` reset keeps desktop identical.
- **Language row gated by viewport, not by an explicit "isMobileDrawer"
  prop.** `SidebarContent` is shared between the desktop sidebar
  (`hidden md:flex`) and the mobile drawer, so `md:hidden` alone scopes
  the row to the drawer instance — no new prop threading.
- **Inventory FAB → product, not lot.** The list shows lots, but a lot
  requires a product; the product create is the empty-state primary
  action, so the one-tap FAB opens it.
