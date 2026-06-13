# 2026-06-13 — Offline operator PWA (queue-and-sync)

**Commit:** `<sha> feat(agriculture): offline operator PWA`

## Design

The fourth and final deferred Feature-1 candidate. Makes the app an
installable PWA and lets a field operator mark spray lines done/skip with
NO signal — the mutation is optimistically applied + queued, then flushed
on reconnect.

```
OfflineFieldPanel (big touch targets)
        │  mark(line, DONE)
        ▼  optimistic SWR mutate  →  useOfflineSync.submit(...)
                                         │
                online?  ── fetch ──┬── ok            → 'sent' (revalidate)
                                    ├── 4xx terminal  → throw (surface error)
                                    └── 5xx/408/429   ┐
                offline ────────────────────────────→ enqueue(outbox) → 'queued'
                                                        │
        window 'online' event / mount  →  flushOutbox(store, fetchSender)
                                            FIFO; success→remove, 4xx→drop,
                                            transient→keep+bump, poison→drop
```

Two independent layers:

- **Client outbox** (`src/lib/offline`) — the queue-and-sync engine. A
  `localStorage`-backed `OutboxStore` behind an interface (in-memory twin
  for tests). `flushOutbox` is the retry brain. This is where offline
  *writes* live — pure, fully unit-tested.
- **Service worker** (`public/sw.js`) — installability + a static-asset /
  app-shell cache only. It NEVER caches `/api` and NEVER touches non-GET,
  so it can't serve stale tenant data or swallow a mutation. The SW and
  the outbox are deliberately decoupled.

## Files

| File | Role |
| --- | --- |
| `src/lib/offline/outbox.ts` | `OutboxStore` (localStorage + in-memory) + `enqueue`. |
| `src/lib/offline/sync.ts` | `flushOutbox` (retry policy) + `fetchSender`. |
| `src/lib/offline/use-offline-sync.ts` | Hook: online tracking, flush-on-reconnect, fetch-first-then-queue `submit`. |
| `src/components/offline/OfflineFieldPanel.tsx` | Phones-with-gloves execution UI (big targets, sync bar). |
| `src/app/t/[tenantSlug]/(app)/field/[taskId]/page.tsx` | Operator field route. |
| `public/manifest.webmanifest` + `public/icon.svg` | Installable PWA manifest + app icon. |
| `public/sw.js` | Conservative service worker. |
| `src/components/pwa/ServiceWorkerRegistrar.tsx` | Prod-only SW registration. |
| `src/app/layout.tsx` | Links manifest + mounts the registrar. |
| `tests/guardrails/offline-pwa-coverage.test.ts` | Manifest/SW-safety/single-seam ratchet. |

## Decisions

- **Outbox, not the SW, owns offline writes.** A Background-Sync SW could
  replay POSTs, but that couples write-correctness to SW lifecycle quirks
  and makes the retry policy invisible to tests. A plain client outbox is
  transparent, unit-testable, and the SW stays a dumb shell cache. The
  ratchet enforces the SW never caches `/api` / never handles non-GET.

- **The retry policy is the crux.** Terminal 4xx are *dropped* (they'll
  never succeed; keeping them wedges the FIFO queue); transient
  (5xx/408/429/network) are kept + bumped; a poison item is dropped past
  `MAX_ATTEMPTS`. The same item id rides every retry so a deduping server
  sees at-least-once as exactly-once.

- **`localStorage`, not IndexedDB.** Marks are tiny JSON; localStorage is
  simpler, synchronous, and trivially testable. The `OutboxStore`
  interface leaves an IndexedDB swap-in for the deferred photo-first
  capture (blobs) without touching callers.

- **Single seam.** UI goes through `useOfflineSync`; only
  `src/lib/offline` touches `getOutboxStore()`. Mirrors the terra-draw /
  react-window single-seam discipline; ratchet-locked.

- **Prod-only SW registration.** A fetch-intercepting SW fights Next HMR,
  so registration gates on `NODE_ENV === 'production'` (the sanctioned
  client prod-gate pattern, allowlisted in `no-fallbacks`).

- **No schema / no backend change.** It reuses the existing
  `PATCH …/field-operations/:task/parcels/:line` mark route — the same
  endpoint `FieldOperationPanel` already calls online.
