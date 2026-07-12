# 2026-07-12 — Service-worker "Update ready — refresh" button reliability

**Commit:** `<sha> fix(pwa): make the SW update Refresh button reliably reload`

## Context

The consent-gated SW update flow (Roadmap prompt P2, PR #257) surfaces an
"Update ready — refresh" banner (`UpdateAvailableBanner`) when a new service
worker parks in the `waiting` state. On the live app (`app.agrent.bg`) an
operator reported the **Refresh button "does nothing on click"**.

The deployed `sw.js` was verified correct: it has the `SKIP_WAITING` message
handler AND `clients.claim()` in `activate`. So the failure was on the client
reload path, not the worker.

## Root cause

The original `applyUpdate` did the naive thing:

```ts
const applyUpdate = () => waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
// reload happened solely in a `controllerchange` listener.
```

Two independent production failure modes each turn the tap into a dead end:

1. **Stale worker ref.** `waitingWorker` is captured at `updatefound` /
   register time. On a busy deploy day a newer worker supersedes it, leaving
   the captured ref pointing at a now-`redundant` worker. `postMessage` to a
   redundant worker is a silent no-op → no skipWaiting → no reload.
2. **`controllerchange` is not reliably delivered** on every browser (notably
   iOS Safari — the operator's platform). The entire reload depended on that
   single event, so even when skipWaiting succeeded the page never reloaded.

## Fix

Harden `applyUpdate` (`src/components/pwa/ServiceWorkerRegistrar.tsx`) so the
consented tap always makes progress:

- **Re-query the LIVE `reg.waiting`** at click time via
  `navigator.serviceWorker.getRegistration()` instead of trusting the captured
  ref (falls back to the ref, then to a plain reload if there is no waiting
  worker at all).
- **Reload on the new worker's own `statechange → 'activated'`** — reliable and
  independent of `controllerchange`, which is kept as the fast path.
- **Bounded fallback reload** (`setTimeout(reloadOnce, 3000)`) so a browser that
  fires neither event still gets the operator onto the new assets.
- A shared `reloadOnce` (`useRef` guard) collapses whichever trigger fires
  first into exactly one reload.

## Files

| File | Role |
| --- | --- |
| `src/components/pwa/ServiceWorkerRegistrar.tsx` | `reloadOnce` guard + hardened `applyUpdate` (live-worker re-query, `activated` + `controllerchange` + timer triggers) |
| `tests/rendered/service-worker-registrar-update.test.tsx` | Regression cover: live-worker targeting (not stale ref), reload-trigger wiring, bounded fallback timer |

## Decisions

- **Assert wiring, not `location.reload()`.** This jsdom version makes
  `window.location` non-configurable and `location.reload` a non-configurable
  read-only own property — it cannot be spied, redefined, or reassigned. The
  tests assert the observable wiring the fix installs (live-worker
  `postMessage`, the `statechange`/`controllerchange` listeners, the fallback
  timer) and exercise the reload path for smoke-safety. The wiring is where the
  bug lived; the terminal one-liner is not.
- **3s fallback, not immediate.** A premature reload (before the new worker
  activates) would serve the OLD cached shell and re-show the banner. skipWaiting
  → activate → claim on a local worker completes well within 3s, so by the time
  the fallback fires the new worker controls and the reload gets fresh assets.
- **Reload on `activated` only, not `redundant`.** Reloading when the freshly
  re-queried worker goes redundant risks a reload to stale assets; the timer
  covers that edge instead.
