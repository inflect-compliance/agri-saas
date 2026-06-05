# 2026-06-05 — Build with webpack so strict-CSP chunks carry a nonce

**Commit:** `<sha>` fix(csp): build production with webpack so dynamic chunks are nonced

## Problem

A second strict-CSP report (alongside the Zod `eval` one fixed the same
day — see `2026-06-05-zod-csp-eval-jitless.md`): some dynamically-loaded
chunks on authed pages were blocked by `script-src-elem`.

```
Content-Security-Policy: blocked a script (script-src-elem) at
/_next/static/chunks/0nqgfebz35iv_.js … violates "script-src 'self'
'nonce-…' 'strict-dynamic'"
```

Non-breaking (the chunk reloads on demand) but it spams the console.

## Root cause

The deployed app is a **Turbopack** build — Next 16 makes Turbopack the
default for `next build`, and the repo's `Dockerfile` just ran
`npx next build`. The deployed runtime chunk is the give-away
(`globalThis.TURBOPACK`).

Inspecting the deployed Turbopack runtime, its chunk loader is:

```js
let e = document.createElement("script");
e.src = t; e.onerror = …; document.head.appendChild(e);   // no nonce set
```

It sets **no nonce** on dynamically-created chunk `<script>`s — it relies
entirely on `strict-dynamic` propagation (trust inherited from the
nonce'd root script). The initial markup is nonced correctly (verified:
header nonce == all 33 `<script>` nonces in one request), but some
runtime-loaded chunks still tripped `script-src-elem`.

**Webpack's runtime sets the nonce explicitly** — Next wires the request
nonce into `__webpack_nonce__`, and the loader does
`script.setAttribute('nonce', __webpack_nonce__)` on every chunk. So
chunks are allowed by `'nonce-…'` directly, with zero reliance on
strict-dynamic propagation.

## Fix

Build production with webpack via the `--webpack` flag on every
`next build` invocation. A local webpack build verified: ~3 min wall
clock (on par with Turbopack — no Docker-timeout risk), and the runtime
chunks carry `setAttribute("nonce", …)`.

## Files

| File | Change |
| --- | --- |
| `Dockerfile` | `next build` → `next build --webpack` (the deployed image). |
| `package.json` | `build` script → `--webpack`. |
| `.github/workflows/ci.yml` | the three `next build` steps → `--webpack` (CI matches prod). |
| `scripts/e2e-local.mjs`, `scripts/ci-local.mjs` | local runners → `--webpack`. |
| `tests/guards/webpack-bundler-pinning.test.ts` | ratchet: every `next build` carries `--webpack`. |

## Decisions

- **Webpack over patching Turbopack.** Turbopack's runtime is generated;
  there's no supported seam to make it nonce dynamic chunks. Webpack's
  `__webpack_nonce__` path is the mature, documented Next + strict-CSP
  story — the CSP module's own comments were written against it.
- **Whole pipeline, not just the Dockerfile.** CI's build + e2e steps
  also switched so CI tests the bundler we actually ship.
- **The earlier turbopack-only note still stands.** `globalThis.TURBOPACK`
  stack misattribution (`reference_prisma_turbopack_stack_misattribution`)
  is moot now that prod is webpack.
