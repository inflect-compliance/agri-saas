# 2026-06-17 — GAP-05 finish: retire the `AsyncifyParams` type bridge

**Closes** the GAP-05 async-params migration. The per-handler `await
params` migration (#636) and the runtime-shim removal landed earlier;
this removes the last vestige — the `AsyncifyParams` type transform —
by migrating the one wrapper that still typed params synchronously.

## The remnant

`withApiErrorHandling` carried an `AsyncifyParams<C>` type transform +
a dual sync/async overload. Its job: take a handler whose `Context`
typed `params` synchronously and present a Next-16-shaped
(`{ params: Promise<P> }`) signature to the route export.

Direct route handlers had already migrated to Promise-typed params, so
for them `AsyncifyParams` was a no-op. But **`requirePermission`** still
typed its returned `RouteHandler` with sync `params: TParams` — so its
~43 wrapped routes (admin / billing / sso / security / sharepoint) only
satisfied Next 16's `RouteHandlerConfig` *because* `AsyncifyParams`
bridged them. Worse, `permissionedRoute` forwarded the **unresolved
Promise** `routeArgs` to inner handlers that read `params.keyId`
synchronously — a latent runtime bug for every non-tenant dynamic param
(it only worked in unit tests, which passed sync params).

## The fix

1. **`requirePermission` resolves params once, forwards them resolved.**
   `const params = await routeArgs.params;` then
   `handler(req, { params }, ctx)`. Inner handlers (`PermissionedHandler`)
   keep their ergonomic sync `params.keyId` read — and now it's
   *correct* at runtime, not just in tests.
2. **`RouteHandler` outer type → `{ params: Promise<TParams> }`** (the
   Next 16 shape). The export `withApiErrorHandling` produces is now
   Promise-shaped with no type bridge.
3. **Removed `AsyncifyParams` + collapsed the dual overload** in
   `api.ts` to a single `(req, ctx: Context) => Promise<…>`.
4. **Tests** that called wrapped routes with sync `{ params: {...} }`
   now pass `{ params: Promise.resolve({...}) }` (the real Next shape;
   `await` on a resolved value is identity, so behaviour is unchanged).

## Files

| File | Change |
|------|--------|
| `src/lib/errors/api.ts` | removed `AsyncifyParams` + dual overload → single pass-through signature |
| `src/lib/security/permission-middleware.ts` | `RouteHandler` params → `Promise`; `permissionedRoute` resolves once + forwards resolved params |
| `tests/unit/{key-rotation-admin-api, security/*}.test.ts` | wrapped call-site params in `Promise.resolve(...)`; updated the forward-args assertion |
| `CLAUDE.md` | framework-baseline paragraph: GAP-05 marked complete |

## Decisions

- **Forward RESOLVED params (not the Promise) to inner handlers.** Keeps
  every existing `requirePermission` handler unchanged (sync `params.foo`)
  AND fixes the latent unresolved-Promise read. The alternative —
  forwarding the Promise and making each handler `await` — would have
  touched dozens of route files for no ergonomic gain.
- **No new guard needed.** `async-params-route-typing.test.ts` already
  locks the route-handler contract; Next 16's generated
  `RouteHandlerConfig` validator (in `tsc`) now locks the export shape
  directly, since the bridge that masked sync exports is gone.
