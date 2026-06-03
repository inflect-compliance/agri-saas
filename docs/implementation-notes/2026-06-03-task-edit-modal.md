# 2026-06-03 — Task edit-in-modal (Tasks-tab Phase 2)

**Commit:** `<sha> feat(tasks): edit tasks in a modal from the list + control Tasks tab`

## Design

Phase 1 turned the control/asset/risk **Tasks tab** into a `<DataTable>`
matching the global Tasks page. Phase 2 adds a row-level **edit
affordance** — a pencil (mirroring the controls-table quick-edit) that
opens the task in `<EditTaskModal>` instead of routing to the detail
page. The same modal is wired into BOTH surfaces:

- Tasks list (`TasksClient`) — `quick-edit` column, gated on
  `appPermissions.tasks.edit`.
- `LinkedTasksPanel` (control/asset/risk Tasks tab) — `quick-edit`
  column, gated on the panel's `canWrite` prop.

`EditTaskModal` seeds from a fresh `GET /tasks/{id}` on open (not the
list row) so description / priority — fields the list projection omits
— are always current.

## Field surface — why it's narrower than create

The modal edits exactly what the task **PATCH** endpoint
(`UpdateTaskSchema`) accepts: title, description, severity, priority,
dueAt. Two deliberate exclusions:

- **`type` is immutable post-create** — rendered read-only (a badge),
  never a writable control. The PATCH schema doesn't accept it.
- **Assignee has its own focused endpoint** (`POST /tasks/{id}/assign`,
  `AssignTaskSchema`). The modal PATCHes the descriptive fields, then —
  only if the assignee actually changed — fires one extra POST. A no-op
  edit never re-assigns. Status likewise stays on its own
  lifecycle endpoint and is not edited here.

`severity` carries `INFO` (the PATCH schema accepts it and existing
tasks may already be INFO) — the create form omits INFO, so the edit
modal can't reuse the create schema/severity list verbatim. That, plus
the create form's create-only machinery (pending-links staging,
per-type validation, POST + secondary link POSTs), is why
`EditTaskModal` is a self-contained surface rather than a mode flag on
`useNewTaskForm`.

## Files

| File | Role |
|------|------|
| `tasks/EditTaskModal.tsx` | New. Fetch-seed + PATCH (+ conditional assign) edit surface. |
| `tasks/TasksClient.tsx` | `quick-edit` column + modal mount + `invalidateAllTasks` on save. |
| `components/LinkedTasksPanel.tsx` | `quick-edit` column + modal mount + `loadTasks` on save. |
| `tests/rendered/linked-tasks-panel-response-shape.test.tsx` | tenant-ctx mock + edit-pencil presence/absence cases. |
| `tests/guards/ux-foundation-ratchets.test.ts` | confirm ceiling 17 → 18 (the discard guard). |

## Decisions

- **Discard guard reused from `NewTaskModal`.** Synchronous
  `window.confirm` on close when the form is dirty — bumped the
  native-confirm ceiling 17 → 18. Consistent with the other modal-form
  surfaces; not a destructive-action flow, so Epic 67 undo-toast
  doesn't apply.
- **Edit button is icon-only** (`AppIcon name="edit"`) with an
  `aria-label`, `stopPropagation` so it doesn't also trigger the row's
  navigate-to-detail click — identical to the controls-table pencil.
