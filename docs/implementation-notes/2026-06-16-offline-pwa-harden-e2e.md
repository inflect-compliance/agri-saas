# 2026-06-16 — Offline operator PWA: cold-reload harden + end-to-end proof

**Commit:** `<sha>` feat(offline): cold-reload field-op snapshot + offline-sync E2E

## Context

The offline operator PWA (queue-and-sync) was **already shipped in PR #15**
— service worker + manifest + registrar, the `src/lib/offline/` outbox +
sync + `useOfflineSync` hook, and the `OfflineFieldPanel` operator view at
`/t/:slug/field/:taskId`, wired into the real spray-line mutation. (A
fast-follows note had wrongly called it "deferred — greenfield"; that was a
scan miss — the code lives in `public/` + `src/lib/offline/`.) This change
does NOT rebuild it. It closes the two gaps that remained:

1. **Cold offline reload lost the job data.** The SW serves the cached page
   *document* offline, but `/api/*` is deliberately network-only (it never
   caches authenticated tenant data), so SWR's field-op fetch failed offline
   and the panel rendered "not found" on a cold reload.
2. **No end-to-end proof.** The flow was unit-tested (hook), but nothing
   exercised the real "complete a job offline → sync on reconnect" path.

## Design

**Harden — offline field-op snapshot.** `src/lib/offline/field-snapshot.ts`
persists the last-loaded field-op to `localStorage` (keyed by taskId, same
fail-soft posture as the outbox). `OfflineFieldPanel` was refactored to
render from a single `view` state:

```
view = snapshot (cold open, no signal)
     → replaced by SWR data when the network delivers it (+ re-snapshot)
     → optimistically updated on every mark (+ re-snapshot, so a cold
       reload still reflects work already queued in the outbox)
```

The outbox/sync layer is unchanged — the snapshot is purely the *read*
fallback that makes the page open offline; the queue still drives the
actual sync.

**Proof — two levels.** A panel-level integration test drives the real
`OfflineFieldPanel` + real outbox + real sync (only the SWR fetch + map +
`navigator.onLine` stubbed): cold-open-from-snapshot, mark-offline →
queued + optimistic + snapshot, reconnect → the queued PATCH flushes. A
Playwright E2E (`offline-field-sync.spec.ts`) then proves the *real
browser* path with `context.setOffline()`: seed a field op (isolated
tenant; the product Item via Prisma since it has no create-API, the rest
via the authenticated API), mark a line offline, reconnect, and reload to
confirm the line is DONE **from the server**.

## Files

| File | Role |
|---|---|
| `src/lib/offline/field-snapshot.ts` | NEW — localStorage field-op snapshot (save/read/clear), fail-soft |
| `src/components/offline/OfflineFieldPanel.tsx` | render from `view` (snapshot ⊕ SWR ⊕ optimistic); persist snapshot on load + mark |
| `tests/rendered/offline-field-panel.test.tsx` | NEW — panel-level offline flow + cold-open proof |
| `tests/e2e/offline-field-sync.spec.ts` | NEW — real-browser offline→reconnect→sync E2E |

## Decisions

- **Snapshot, not SW `/api` caching.** Keeping `/api` network-only in the
  SW (never caching authenticated tenant data) is the right security
  posture; the offline read fallback belongs in the app's offline layer
  (`src/lib/offline`), keyed + scoped to the one field op the operator
  opened — not a blanket SW response cache.
- **The panel renders from one `view` state.** The pre-existing optimistic
  path mutated the SWR cache, which is a no-op when `data` is undefined
  (offline cold open). Driving the UI from `view` (seeded from the
  snapshot, synced from SWR) makes optimism work identically online and
  off, and is what lets the snapshot reflect queued marks.
- **Two proof levels.** The panel test is the reliable, locally-runnable
  proof of the exact flow; the Playwright E2E is the real-browser/real-SW
  confirmation (validated in CI — Playwright can't run in the dev
  sandbox). The product Item is Prisma-seeded in the spec because there is
  no item create-API; everything else uses the authenticated API.
