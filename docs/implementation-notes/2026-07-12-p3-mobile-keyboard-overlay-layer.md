# 2026-07-12 — P3: mobile keyboard / overlay layer

**Commit:** `<pending> feat(ui): mobile keyboard-avoidance + overlay-depth + autofill sweep`

## Design

Four independent mobile-hardening seams that share one theme: make
overlays and inputs behave natively on a phone.

### P3.1 — Keyboard-avoidance for Popover bottom-sheets

The `<Popover>` mobile branch is a Vaul `Drawer` anchored to
`bottom: 0`. When a focused input inside it (a Combobox search field,
a form field) raises the soft keyboard, the *visual* viewport shrinks
from the bottom and the sheet's lower half hides behind the keyboard.
`useKeyboardInset` (already used by `<Modal>` / `<Sheet>`) reports the
keyboard height + visible-viewport height off `window.visualViewport`.
The drawer content now lifts by `bottom: inset` and caps `maxHeight`
to the visible viewport. The 150ms transition is dropped under
`prefers-reduced-motion` (via `useReducedMotion`). Mobile-only — the
desktop portalled Radix branch is untouched.

### P3.2 — OverlayDepthContext (retires the nested-drawer opt-in)

New `src/components/ui/overlay-depth.tsx`: a numeric React context
(default 0). Each overlay root — `<Modal>` (both drawer + dialog
branches), `<Sheet>`, and `<Popover>`'s own content (both branches) —
wraps its children in `<OverlayDepthProvider>`, which reads the
ambient depth and provides `depth + 1`.

`<Popover>` reads `useOverlayDepth()`. When `depth > 0` (already inside
an overlay) it renders the portalled dropdown instead of stacking a
second Vaul bottom-sheet — even on mobile. This is what used to require
a manual `forceDropdown` prop on every Combobox-inside-a-Modal. The two
signals are OR'd (`forceDropdown || overlayDepth > 0`), so nesting is
now automatic and the manual prop is redundant for that use. 37
redundant `forceDropdown` props were removed from modal/sheet call
sites. `forceDropdown` survives as an EXPLICIT always-dropdown override
for on-page pickers where a bottom sheet would cover context (map
prescription picker, bulk-action bar, people-pickers) — those sites
keep it deliberately.

### P3.3 — Autofill + keyboard-hint semantics

Auth forms (login/register, forgot, reset, change-password) got
`autoComplete` (`email` / `current-password` / `new-password` /
`name` / `organization`), `inputMode="email"` on email fields, and
`enterKeyHint` (`next` between fields, `done`/`send` on the last).
The login password field is dual-mode: `mode === 'register' ?
'new-password' : 'current-password'`. Search inputs (the shared
Combobox search field and the FilterToolbar search field) got
`enterKeyHint="search"`. Numeric fields already open the number pad
via the `<Input>` primitive's `inputMode="decimal"` default — no
change needed.

### P3.4 — Guard

`tests/guards/auth-form-autofill.test.ts` — a structural scan over the
curated auth-form files. It extracts every `<input>` / `<Input>`
element, classifies password fields by their stable `name=` attribute
(currentPassword → current-password; new/confirmPassword →
new-password; dual-mode → an expression referencing both), and asserts
email fields carry `autoComplete="email"`. Includes in-memory mutation
self-tests proving the detector catches a removed / wrong attribute.

## Files

| File | Role |
| --- | --- |
| `src/components/ui/overlay-depth.tsx` | New: nesting-depth context + provider (P3.2) |
| `src/components/ui/popover.tsx` | Keyboard inset (P3.1) + depth-aware dropdown + provider wrap (P3.2) |
| `src/components/ui/modal.tsx` | Wrap children in `OverlayDepthProvider` (both branches) |
| `src/components/ui/sheet.tsx` | Wrap children in `OverlayDepthProvider` |
| `src/components/ui/combobox/index.tsx` | `enterKeyHint="search"` on search field (P3.3) |
| `src/components/ui/filter/filter-select.tsx` | `enterKeyHint="search"` on filter/search field |
| `src/app/login/page.tsx` | autoComplete/inputMode/enterKeyHint on all fields |
| `src/app/forgot-password/page.tsx` | email autofill semantics |
| `src/app/reset-password/page.tsx` | new-password autofill semantics |
| `src/app/account/security/ChangePasswordForm.tsx` | current/new-password autofill semantics |
| `…/*Modal.tsx`, `…/*Sheet.tsx`, `_form/*`, `RuleBuilderModal.tsx`, `AccessReviewDetailClient.tsx` | Removed 37 redundant `forceDropdown` props |
| `tests/guards/auth-form-autofill.test.ts` | New guard (P3.4) |

## Decisions

- **`forceDropdown` kept, not deleted.** It has a legitimate second
  meaning beyond nesting — "always dropdown on-page" (map pickers,
  people-pickers, bulk bars) — where a mobile bottom-sheet would cover
  essential context. Deleting it would regress those to bottom-sheets.
  So the prop defers to the context (OR'd) and the redundant
  *nesting-only* call sites were pruned; the intentional always-dropdown
  sites keep it.
- **Removal safety.** Removing `forceDropdown` from a base `<Combobox>`
  inside a Modal/Sheet is behaviour-neutral: on mobile the overlay's
  provider forces the dropdown; on desktop the popover is a dropdown
  regardless. UserCombobox/AsyncCombobox default `forceDropdown` to
  `true`, so pruning their explicit prop is also neutral.
- **Guard keys off `name=`, not field order.** Field position drifts;
  the `name` attribute is the stable semantic anchor for current-vs-new
  correctness.
- **No new user-facing strings.** All P3 changes are input attributes
  and internal plumbing, so no `messages/` churn.
