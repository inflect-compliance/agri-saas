# 2026-07-11 — Offline photo bytes (log work offline, P2)

**Commit:** `<pending> feat(offline): queue photo bytes, not just text`

## Design

The offline outbox serialised every queued item's body as JSON
(`sync.ts` / `outbox.ts`), so it physically could not carry a `File`.
Offline, a journal photo showed a `blob:` preview and then FAILED to
upload. This adds a binary-capable path.

One outbox, two item kinds (a discriminated union on `kind`):

- **`mutation`** (default / `kind` absent — back-compat): a tiny JSON
  `body`, the original path.
- **`photo`**: the ALREADY-downscaled photo bytes ride as a `Blob`
  stored NATIVELY in IndexedDB (structured clone — no base64 bloat),
  plus `fileName` / `fileType`. No `body`.

Keeping ONE object store (not a second store) means both kinds drain in
a single FIFO pass and the service worker reads a single store — the
client sender and SW flush stay trivially in lockstep. No IDB schema
version bump: a keyPath-`id` store holds a Blob value with no migration.

Replay reconstructs multipart `FormData` from the stored Blob and POSTs
to `/journal/:id/files`, in BOTH senders:

- in-page `fetchSender` (`src/lib/offline/sync.ts`)
- service-worker `flushOutbox` (`public/sw.js`)

Both branch on `item.kind === 'photo'`, both carry `Idempotency-Key:
item.id`. The retry policy is UNCHANGED (429-retain / terminal-4xx-drop
/ transient-retry-with-bump / MAX_ATTEMPTS) — the photo kind just
changes how the request body is built, not the drain policy.

Size is capped at ENQUEUE (`MAX_QUEUED_PHOTO_BYTES = 8 MB`, on the
compressed blob) so a pathological blob can't wedge the queue or blow
the IDB quota — `enqueuePhoto` throws `PhotoTooLargeError` before the
item enters the store.

Exactly-once is CONTENT-ADDRESSED end-to-end: a replayed upload (first
response lost) hashes to the same SHA-256 → resolves to the same
`FileRecord` → the `@@unique([logEntryId, fileRecordId])` link already
exists. `uploadLogEntryPhoto` detects the existing link and returns the
ORIGINAL (no second `LogEntryFile` row, no re-classification), with a
P2002 backstop for the concurrent-replay race. `Idempotency-Key` is
forwarded and recorded in the audit `detailsJson`.

## Files

| File | Role |
| --- | --- |
| `src/lib/offline/outbox.ts` | Union item type, `PhotoOutboxItem`, `isPhotoItem`, `enqueuePhoto`, `MAX_QUEUED_PHOTO_BYTES`, `PhotoTooLargeError` |
| `src/lib/offline/sync.ts` | `fetchSender` branches on photo kind → multipart FormData |
| `src/lib/offline/use-offline-sync.ts` | `submitPhoto`, `pendingPhotos` count, IDB-required guard |
| `public/sw.js` | `flushOutbox` photo branch (multipart, lockstep with sync.ts) |
| `src/components/offline/OfflineSyncBar.tsx` | Distinct "N photos queued" line |
| `src/components/offline/OfflineFieldPanel.tsx` | Threads `pendingPhotos` |
| `src/app/.../journal/[id]/JournalPhotosTab.tsx` | Offline-first upload via `submitPhoto`; sync bar; live-refresh on drain; direct-upload fallback when no IDB |
| `src/app/api/.../journal/[id]/files/route.ts` | Forwards `Idempotency-Key` header |
| `src/app-layer/usecases/journal.ts` | Idempotent `uploadLogEntryPhoto` (existing-link + P2002 backstop) |
| `src/app-layer/repositories/JournalRepository.ts` | `findFileLink` (full link w/ FileRecord) |
| `messages/{en,bg}.json` | `offline.photosQueued`, `journal.photos.photoQueuedLabel` / `photoTooLarge` |

## Decisions

- **One store, discriminated union — not a second object store.** FIFO
  ordering across text + photo is preserved and the SW reads one store,
  so no schema-drift risk between kinds. `kind` optional (absent =
  `mutation`) keeps pre-existing records + the localStorage / in-memory
  stores working unchanged.
- **Blob field, not base64.** IndexedDB stores Blobs natively; base64
  would inflate ~33% and burn CPU on every read.
- **Size cap at enqueue, not at flush.** A blob rejected at enqueue
  never enters the queue, so it can't wedge the drain loop. The cap is
  on the COMPRESSED size (post-downscale).
- **Content-addressed exactly-once.** The SHA-256 dedup + unique link
  already guarantee one attachment for identical bytes; the fix was to
  return the existing link instead of throwing P2002. `Idempotency-Key`
  is belt-and-suspenders (and satisfies the offline-pwa guardrail that
  BOTH senders set it).
- **Photos tab hosts its own `useOfflineSync`.** The journal detail page
  mounts one instance (in the tab), so no competing flush loops. Live
  refresh on `pendingPhotos` draining to zero means a background flush
  updates the list without a manual reload.
- **Direct-upload fallback when IndexedDB is absent** (jsdom / private
  mode) — the photo still uploads online rather than being dropped.
