# 2026-06-18 — Mobile data-entry PR-4: glove-and-sun-friendly field capture

**Commit:** `<sha> feat(mobile-data-entry): number pads + camera + StepWizard`

Fourth of the 6-PR mobile initiative. Fast field capture: number pads,
direct camera capture, and a guided multi-step wizard that completes offline.

## Design

### Numeric ergonomics (one line, everywhere)
`<Input type="number">` now defaults `inputMode="decimal"` — so every
number field opens the phone's decimal number pad (dose 2.5, qty, yield,
cost, GDD). A caller can override (`inputMode="numeric"` for integers); the
prop spread wins. `<NumberStepper>` already carried `inputMode="numeric"`.
The field ag forms (inventory / yield / bins / contracts / journal
quantities) all use `<Input>`, so they're covered automatically — the audit
found no raw `<input type="number">` left in field forms.

### Camera capture
`<FileUpload>` gains `capture?: 'environment' | 'user' | boolean` →
forwarded to the file input, so a phone opens the REAR camera on tap. Wired
into the journal photos tab via a dedicated **"Take photo"** input
(`accept="image/*" capture="environment"`) next to the existing document
"Upload" input. An **instant local thumbnail** renders immediately on
capture (`URL.createObjectURL`, revoked on replace/unmount) — offline-safe,
no upload needed. `resizeImage()` (FileUpload `targetResolution`) is intact.
Evidence (a 13-type FileDropzone) is deliberately NOT camera-only.

### StepWizard
New `<StepWizard>` (`src/components/ui/step-wizard.tsx`) wraps the
responsive `<Modal>` (Vaul bottom-drawer on phones): one decision per
screen, progress dots, large Back/Next buttons, `canAdvance` per-step gate.
`onFinish` returns `{ queued: true }` to surface a "saved offline, will
sync" state — wire it to `useOfflineSync().submit(...)`.

Applied as the **"New spray job" wizard** on the location detail
(`SprayJobWizard.tsx`): parcels (checkboxes) → product (Combobox) → rate
(number `<Input>` + unit Combobox) → confirm. `onFinish` calls
`useOfflineSync().submit({ url: …/operations, method: POST, body })` and
returns `{ queued }` — so a spray job created with no signal is queued in
the outbox and syncs on reconnect, reusing the OfflineFieldPanel posture.
Launched from a `data-testid="new-spray-job"` header button (disabled when
the location has no parcels). Current-user id comes from `/api/auth/me`
(no client `SessionProvider` in this app).

### Voice-to-text (stretch) — skipped, justified
The journal note is a TipTap `<RichTextEditor>` (controlled HTML), not a
`<textarea>`. Appending a Web Speech transcript cleanly needs an imperative
insert on the editor primitive (not modifiable here); string-concatenating
onto serialized HTML risks corrupting ProseMirror state. Deferred.

## Files

| File | Role |
| --- | --- |
| `src/components/ui/step-wizard.tsx` | New — multi-step field wizard primitive. |
| `src/components/ui/input.tsx` | `type=number` defaults `inputMode="decimal"`. |
| `src/components/ui/file-upload.tsx` | New `capture` prop (camera). |
| `locations/[locationId]/SprayJobWizard.tsx` | New — offline spray-job wizard. |
| `locations/[locationId]/page.tsx` | Launch button + wizard mount. |
| `journal/[id]/JournalPhotosTab.tsx` | "Take photo" camera input + instant thumbnail. |
| `tests/rendered/mobile-data-entry.test.tsx` | Input inputMode, FileUpload capture, StepWizard (nav/dots/offline). |
| `tests/e2e/mobile/data-entry.spec.ts` | `@mobile`: wizard launch + parcel-step navigation. |

## Decisions

- **inputMode on the Input primitive, not per-field.** One change covers
  every `<Input type="number">` call site; overridable.
- **SprayJobWizard honours the app-page structural ratchets.** The parcel
  multi-select is a `<div role="group" aria-label>` (a checkbox set), NOT
  `<fieldset>/<legend>` — the form-drift ratchet reserves that shape for
  `<RadioGroup>`, and a multi-select isn't a radio group anyway (same
  sr-only announcement, correct ARIA grouping). The dose field uses
  `<Input inputMode="decimal">` rather than `<Input type="number">`: it
  still raises the mobile number pad, keeps the epic-60 raw-number ratchet
  at its floor (4), and sidesteps `type=number`'s wheel-scroll /
  locale-separator footguns for a free-decimal rate (JS validates).
- **StepWizard offline via `onFinish` → `{ queued }`**, not coupled to
  `useOfflineSync` — the consumer wires it (SprayJobWizard does). The
  primitive's queued/nav behaviour is unit-tested; the full product/rate
  chain isn't E2E'd (needs seeded Items + RATE units + fragile Combobox
  steps) — the E2E proves launch + step nav.
- **The @mobile E2E seeds its OWN tenant (isolated/mutating), not the
  shared seed.** The launcher is `disabled={parcels.length === 0}`, fed by
  a client SWR fetch. A first cut logged into the shared "Home Farm — Demo"
  tenant and relied on its three seeded parcels — but those come from a seed
  spatial-import side effect (`importLocationSpatialFile`) wrapped in a
  try/catch; when it is skipped in CI the location has zero parcels, the
  button never enables, and the click auto-waits the full 3-min test timeout
  (×2 retries ×2 mobile projects ≈ 18 min) until the whole E2E job times
  out. The spec now seeds location + parcel via the authenticated API
  (mirroring `offline-field-sync.spec.ts`) so the button enables
  deterministically, and runs with `retries:0` + a 90 s cap + explicit
  per-action timeouts so any future regression fails fast and can never
  again exhaust the 40-min E2E budget.
- **Budgets bumped:** `step-wizard.tsx` (Next/Finish are mutually exclusive
  primaries) and the location detail (+1 for the Spray job launcher).
