# 2026-06-18 — Mobile forms PR-3: create/edit on a phone without hunting for Save

**Commit:** `<sha> feat(mobile-forms): keyboard-aware modals + dirty-guard + FAB`

Third of the 6-PR mobile initiative. Goal: a phone user can fill a create
form and reach Save without it being buried under the keyboard or behind a
swipe that throws their input away.

## Design

### Keyboard-aware footer (the headline)
`<Modal>` and `<Sheet>` already pin Header (shrink-0) / Body (flex-1
overflow-y-auto) / Footer (shrink-0) via the slot flex layout — so a long
form scrolls in the body while Save stays pinned. The gap was the **soft
keyboard**: a `position: fixed; bottom: 0` drawer stays anchored to the
*layout* viewport bottom (behind the keyboard), hiding the footer.

New `useKeyboardInset()` (`src/components/ui/hooks/use-keyboard-inset.ts`)
reads the VisualViewport API → `{ inset, height }`. When a keyboard opens,
the Modal/Sheet bottom drawer is lifted onto the keyboard's top edge
(`bottom: inset`) and its height capped to the visible viewport
(`maxHeight: height`) — so the header stays on-screen at top and the footer
(Save/Cancel) sits just above the keyboard. A 120px threshold filters
browser-chrome jitter. Zero effect on desktop / side panels.

### Dirty-guard (drag/backdrop/Escape)
`<Modal isDirty>`: any dismiss (mobile drag-down, backdrop, Escape, the X)
on an edited form shows a styled "Discard changes?" confirm instead of
discarding. The explicit **Cancel** button still calls `setShowModal(false)`
directly, bypassing the guard. Implemented by intercepting the Modal's
single `closeModal` path and rendering a sibling `<Modal.Confirm>`.

This **supersedes** the legacy `window.confirm` + `guardedSetOpen` P3
pattern for the migrated `tasks` flow (same intent — no unsaved loss — but
a styled prompt that also covers mobile drag). The two structural ratchets
(`modal-form-p3-hardening`, `r32-modal-form-completeness`) gained a
per-flow `guard: 'native' | 'confirm'` so `tasks` is verified against the
native `isDirty` pattern; policies/vendors/assets keep `window.confirm`
until they migrate.

### FAB
`<Fab>` (`src/components/ui/fab.tsx`) — a mobile-only (`md:hidden`) floating
create button anchored bottom-right ABOVE the bottom-tab bar + safe area,
fired by the SAME handler the header "+" calls. Mounted on Tasks (New
Task), Farm Tasks (Start Field Operation), Journal (New Journal entry).

## Files

| File | Role |
| --- | --- |
| `src/components/ui/hooks/use-keyboard-inset.ts` | New — VisualViewport → keyboard inset/height. |
| `src/components/ui/modal.tsx` | Keyboard-aware drawer + `isDirty` dirty-guard. |
| `src/components/ui/sheet.tsx` | Keyboard-aware bottom drawer (parity). |
| `src/components/ui/fab.tsx` | New — mobile floating create button. |
| `tasks/`, `farm-tasks/`, `journal/` clients | Mount `<Fab>`. |
| `NewTaskModal`, `FarmTasksClient`, `JournalEntryModal`, `UploadEvidenceModal`, `InventoryClient` | Wire `isDirty` on the create `<Modal>`. |
| `tests/e2e/mobile/forms.spec.ts` | `@mobile`: FAB → create drawer with reachable "Create Task". |

## Decisions

- **VisualViewport, not vaul's repositionInputs.** Explicit `bottom` +
  `maxHeight` keeps BOTH the footer and header on-screen; relying on vaul's
  input-reposition alone could push the header off the top.
- **Single render branch already done in PR-2's spirit.** The dirty-guard
  intercepts the one `closeModal` path so X / Escape / backdrop / drag all
  route through it uniformly.
- **`tasks` migrated off `window.confirm`; others deferred.** Avoids a
  double-prompt and modernises one flow without a 6-form refactor; the
  ratchets now encode both mechanisms.
- **Keyboard + drag aren't E2E'd** (can't drive a soft keyboard / native
  drag reliably in Playwright) — covered by the hook unit test + the Modal
  dirty-guard rendered test; the E2E covers FAB-launch + reachable-Save.
