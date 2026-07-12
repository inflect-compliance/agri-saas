# 2026-07-12 — Dropdown unification on the canonical Popover + Epic 55 primitives

**Commit:** `<sha> feat(mobile): unify dropdowns on Popover + kill native selects`

## Design

Two mobile-hardening threads land together:

1. **Row-action menus → `<Popover>`.** The `admin/members` page hand-rolled
   a row-action menu from an `openMenuId` `useState`, an `absolute top-full`
   panel, and a `fixed inset-0` click-away layer. That shape clips inside the
   DataTable's `overflow` container and sits UNDER the z-30 `BottomTabBar` on
   phones. It is now a `<Popover>` + `<Popover.Menu>` + `<Popover.Item>`
   (`MemberRowActions`): Radix portalled on desktop (escapes the clip), Vaul
   bottom-sheet on mobile. All five actions keep their stable element ids;
   deactivate + remove use the `destructive` variant. `Popover.Item` gained a
   `min-h-[44px] sm:min-h-0` tap target so bottom-sheet menu items are
   thumb-sized on mobile without changing desktop density.

   The 8-column members table also gets `mobileFallback="card"` with
   `mobileCard` slot metas (name→title, email→subtitle, role→meta,
   status→status, menu→**actions**). A new `actions` slot was added to
   `MobileCardList` — a right-aligned footer that stops click propagation so a
   kebab tap never triggers the card's row navigation.

2. **Raw `<select>` → Epic 55 primitives.** PrescriptionPanel (product + rate
   unit), VersionDiff (from/to), WidgetPicker (chart-type → Combobox,
   tenant-sort → RadioGroup), and access-reviews (per-row decision →
   ToggleGroup, modal target-role → Combobox) all migrated. Controls inside a
   Sheet/Modal use `forceDropdown` so they render a dropdown, not a nested
   drawer.

## Files

| File | Role |
| --- | --- |
| `admin/members/page.tsx` | `MemberRowActions` Popover; mobileFallback card; Skeleton; membersRef |
| `components/ui/popover.tsx` | `Popover.Item` ≥44px mobile tap target |
| `components/ui/table/mobile-card-list.tsx` | new `actions` card slot |
| `access-reviews/[reviewId]/AccessReviewDetailClient.tsx` | ToggleGroup + Combobox |
| `components/ui/map/PrescriptionPanel.tsx`, `VersionDiff.tsx`, `dashboard-widgets/WidgetPicker.tsx` | select → Combobox/RadioGroup |
| `tests/guards/no-hand-rolled-menus.test.ts` | new guard — Popover is the only menu primitive |
| `tests/guards/epic55-native-select-ratchet.test.ts` | scope widened to `src/components`; comment-stripped; baseline 6→2 |
| `tests/e2e/mobile/members-menu.spec.ts` | `@mobile` — cards + bottom-sheet kebab |

## Decisions

- **Select ratchet baseline is 2, not 0 or "ControlsClient 4".** The old
  ratchet comment claimed ControlsClient held 4 native selects; it no longer
  does — those inline pickers are now button-based StatusBadge triggers (0
  native selects). After this pass the only native `<select>`s left anywhere in
  the widened scan scope are the two form selects in `TestPlansPanel.tsx`
  (frequency + method). They were left as a bounded follow-up because migrating
  them also means porting the `page.selectOption('#test-plan-frequency-select',
  …)` interaction in `tests/e2e/control-tests.spec.ts`, which was outside this
  pass. Baseline = 2, with a "not stale" test that asserts the remaining budget
  lives exactly in TestPlansPanel.
- **The widened scan strips comments.** Doc comments in `status-badge.tsx` /
  `combobox/index.tsx` mention `<select>`; without stripping they would be
  false positives once `src/components` came into scope.
- **`membersRef` is updated in an effect, not during render.** A render-phase
  `ref.current = members` made React Compiler bail out of optimizing the whole
  component, escalating pre-existing `preserve-manual-memoization` warnings to
  errors. Moving it to `useEffect` restores optimizability.
- **E2E testids preserved via wrappers.** `ButtonProps` has no `data-testid`
  slot, so migrated Comboboxes keep their `decision-modal-modified-to-role` /
  `version-diff-*` selectors via a wrapping element rather than the trigger.
