# 2026-07-19 — Journal: kill the pest-ID twin, lock/retention decisions

**Commit:** `<pending>` refactor(journal): delete the dead pest-ID twin, document lock + retention decisions

## 1. The pest-ID twin (a live foot-gun, not just dead code)

`photo-pest-id` was never enqueued — nothing in the repo ever called
`enqueue('photo-pest-id')`. But it wasn't merely inert: it wrote a
**structurally incompatible** payload to the *same*
`LogEntry.attributesJson.pestId` key that the live `classify-photo` job owns.

| | photo-pest-id (dead) | classify-photo (live) |
|---|---|---|
| pest | `name: string \| null` | `identifiedPest: string` |
| confidence | `'low' \| 'medium' \| 'high'` | **number** (0–1) |
| flags | `identified: boolean` | `lowConfidence: boolean` |
| model | `model` / `generatedAt` | `modelVersion` / `at` / `backend` |

Only `recommendation` and `fileRecordId` overlap. Had the dead job ever been
wired up, `PestSuggestionCard` would have rendered `NaN%`
(`confidence * 100` on a string) and thrown on `undefined.toLowerCase()`.
Two writers on one key with disjoint shapes is a trap that gets sprung by a
one-line change, so the twin is gone rather than left "harmlessly" dormant.

**Ported the one thing it had that the live job didn't:** notifying the
uploader when analysis lands. Three deliberate differences from the original:

- It follows the repo's canonical notification contract
  (`createAgroSignalNotification`): `createMany({ skipDuplicates })` and
  **publish only when `count > 0`**. The twin published unconditionally, so a
  job retry re-notified even when the row deduped — a bug not carried over.
- It respects the existing confidence gate: a `lowConfidence` result announces
  "inconclusive" rather than naming a pest the model isn't sure about.
- It required widening `classify-photo`'s `logEntry` select
  (`createdByUserId`, `tenant.slug`) — the notification needs a recipient.

Deleted: `jobs/photo-pest-id.ts`, `ai/agronomy/photo-id.ts`,
`components/ag/photo-id-card.tsx` (never mounted), the executor-registry
entry, and three `types.ts` sites (`PhotoPestIdPayload`, the `JobPayloadMap`
entry, the `JOB_DEFAULTS` entry). Tests were trimmed surgically — the
`identifyPhoto` and `PhotoIdCard` blocks only; their file-mates cover live code
and stayed. The rendered-coverage floor still passes, so it was **not**
lowered (loosening a satisfied ratchet would be a regression in itself).

`docs/.../2026-06-17-polish-ai.md` claimed the upload path enqueued
`photo-pest-id` and that `<PhotoIdCard>` rendered live. Both false. Corrected
in place, with the shape mismatch recorded so the trap isn't re-laid.

## 2. Optimistic locking — decision: documented last-write-wins

**The premise didn't survive checking.** The concern was that offline-queued
journal edits replay last-write-wins and the outbox's 409 UI never engages.
But journal **edits never enter the outbox**: `JournalEntryModal`'s edit branch
calls `apiPatch` directly, and only CREATE (`POST`, no `ifMatch`) and photo
uploads queue. There is no offline-replay staleness vector for journal edits,
and the conflict flow could not engage for them even with a `version` column.

The one entity that does carry locking, `OperationParcel`, earned it with a
documented two-role workflow (a supervisor/reviewer changing a line under the
operator). Journal has no second actor, no presence feature, and no co-editing
surface. Building a `version` column, `If-Match` plumbing, a guarded
`updateMany`, a `staleData()` 409 and outbox wiring would be constructing a
conflict path for a scenario that cannot currently occur.

So: last-write-wins, **documented at the write seam** with the two conditions
that should reopen it (journal edits moving into the outbox, or a real
concurrent-editor workflow) and a pointer to the `OperationParcel` precedent to
copy end-to-end when they do.

## 3. The flat-branch comment

It credited "the offline outbox" — impossible, since `OutboxMethod` is
`POST | PATCH | DELETE` and the outbox never GETs. The two usecase consumers
people reach for (`ag-dashboard`, `satellite-briefing`) import `listLogEntries`
**directly** and never traverse the route. The only real consumer of the flat
shape is the e2e verification GET in `journal-offline-create.spec.ts`. Rewritten
to say so, so a future cleanup deletes the right branch — or knowingly updates
that spec.

## 4. Retention — decision: drop the column

`LogEntry.retentionUntil` arrived with a bulk rollout migration and has never
been read or written. Registering it would have been **actively wrong**, not
merely unfinished:

- The retention sweep only *soft-deletes*; the hard purge iterates
  `SOFT_DELETE_MODELS`. Registering `LogEntry` in `RETENTION_MODELS` alone
  would soft-delete entries that then never purge — permanent limbo.
- Adding it to `SOFT_DELETE_MODELS` would switch on the Prisma read-filter
  extension across every journal query, colliding with the hand-rolled
  restore/purge journal deliberately implements itself.
- No statutory retention period for the БАБХ diary is documented anywhere in
  the repo, and **auto-expiring regulated agricultural records is the wrong
  default** — keeping them is. "No sweep" was already correct behaviour; the
  column was a dead lever implying otherwise.

Direct precedent: `Asset` dropped this same column in the agricultural-assets
rework. Dropping is migration-only — nothing selects it.

If a legal minimum is later established, the column alone was never sufficient
anyway; it would need a journal-specific policy surface like Evidence's.
