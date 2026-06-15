# Dependency risk review

> Part of the dependency-governance model — see
> `docs/dependency-governance.md` for the four-pillar overview and
> the contributor lifecycle. This document is the **runtime-risk**
> layer.

A periodic, package-by-package security + classification review of
dependencies with a history of CVE activity or a large blast radius.
This is a *posture document* — a reusable template for future audits,
not a one-off note. It complements `docs/dependency-policy.md` (which
covers install-time policy: strict peers, `npm ci`, overrides).

## Why these packages

Each entry below is reviewed because it (a) parses untrusted input,
(b) handles credentials / network egress, or (c) has a documented
history of advisories in its ecosystem. The review answers four
questions per package:

1. **Where is it used?** Every import site in shipping code.
2. **Is it classified correctly?** `dependencies` (ships in the
   production image) vs `devDependencies` (stripped by
   `npm prune --omit=dev` in the `Dockerfile`).
3. **Version + exposure risk.** Pinned vs latest, audit posture,
   maintenance health.
4. **Decision.** Upgrade (in-major only), reclassify (only with
   proof of zero runtime use), isolate, or document-and-justify.

## Reclassification safety rule

Moving a package `dependencies` → `devDependencies` is **dangerous**.
The production `Dockerfile` runs `npm prune --omit=dev`; a
runtime-needed package wrongly in `devDependencies` is stripped from
the image and the app crashes in production — and CI, which installs
*with* devDependencies, will not catch it.

A package may only move to `devDependencies` with an **exhaustive
grep** proving zero import anywhere that ships in the build — all of
`src/**`, `next.config.js`, `src/instrumentation.ts`, dynamic
`import()` and `require()` included. When in any doubt, leave the
classification and document the reasoning. **Never** remove a
package as part of a risk review.

---

## Review — 2026-05-22

Scope: `js-yaml`, `jszip`, `pdfkit`, `nodemailer`. All four are
declared in `dependencies`.

### js-yaml — `^4.1.1`

| | |
|---|---|
| **Direct?** | Yes (also transitive via `eslint`, `semantic-release`, `ts-jest`). |
| **Runtime use** | `src/app-layer/libraries/library-loader.ts` and `src/app-layer/services/mapping-set-importer.ts` — both `yaml.load()` the framework-library + mapping-set YAML files. This is `src/app-layer` code that ships in the production build. Also `prisma/catalog-loader.ts` (seed-time) and six `tests/guards/*` workflow-lint tests. |
| **Classification** | `dependencies` — **correct**. `src/app-layer` is shipped code; the library-import service path is reachable at runtime. |
| **Version** | `4.1.1` is `latest` (`dist-tags.latest = 4.1.1`). The `^4.1.1` caret stays inside the safe major. |
| **Exposure** | Parses YAML. v4 dropped the unsafe `yaml.load` default that made v3 dangerous — v4's `load` is the old `safeLoad` (no arbitrary type construction). All three call sites use bare `yaml.load()`, which is the safe schema in v4. The transitive `js-yaml@3.14.2` under `ts-jest` is dev-only and never touches request input. |
| **Maintenance** | Mature, stable, widely used. No open advisories against v4. |
| **Decision** | **Reviewed — correctly classified, at latest, no action.** |

### jszip — `^3.10.1`

| | |
|---|---|
| **Direct?** | Yes (sole copy in the tree — no transitive dupes). |
| **Runtime use** | `src/app-layer/jobs/evidence-import.ts` — `JSZip.loadAsync()` on uploaded evidence archives. Registered as the `evidence-import` executor in `src/app-layer/jobs/executor-registry.ts`, so it is a live background-job path. |
| **Classification** | `dependencies` — **correct**. The job runs in the shipped worker. |
| **Version** | `3.10.1` is `latest`. v3 is the current stable line (no v4). |
| **Exposure** | Decompresses untrusted ZIPs — a zip-bomb / path-traversal surface. The code already mitigates: `evidence-import.ts` cross-checks the central directory's declared sizes via jszip and rejects oversized entries, and `tests/integration/evidence-import.test.ts` exercises traversal-form normalisation. The decompression bound is the application's responsibility and is already implemented. |
| **Maintenance** | Slower cadence (last publish 2025-03) but stable and not deprecated. |
| **Decision** | **Reviewed — correctly classified, at latest, no action.** The untrusted-archive risk is real but already bounded in `evidence-import.ts`; that bound is the durable mitigation. |

### pdfkit — `^0.18.0`

| | |
|---|---|
| **Direct?** | Yes. |
| **Runtime use** | `src/lib/pdf/*` (`pdfKitFactory.ts`, `table.ts`, `sections.ts`, `layout.ts`) and the report generators under `src/app-layer/reports/pdf/*`, consumed by the PDF API routes (`src/app/api/t/[tenantSlug]/reports/pdf/generate/route.ts`, access-review export). |
| **Classification** | `dependencies` — **correct**. Listed in `next.config.js` `serverExternalPackages` because it uses `stream`/`zlib`/native deps that don't survive webpack bundling; the report route pins `export const runtime = 'nodejs'`. This is unambiguously shipped runtime code. |
| **Version** | `0.18.0` is `latest`. The `0.x` numbering is the package's long-standing convention — it is a mature project, not pre-release; `^0.18.0` correctly locks to the `0.18` minor. |
| **Exposure** | Generates PDFs from server-side data; does not parse untrusted input. Low input-driven risk. |
| **Maintenance** | Active (last publish 2026-03), not deprecated. |
| **Decision** | **Reviewed — correctly classified, at latest, no action.** |

### nodemailer — `^9.0.0`

| | |
|---|---|
| **Direct?** | Yes (also a peer of `next-auth@4`, pinned to the root version via the `overrides` block — `"nodemailer": "$nodemailer"`). |
| **Runtime use** | `src/lib/mailer.ts` — `NodemailerProvider` wraps `nodemailer.createTransport` for production SMTP; selected by `initMailerFromEnv()` when `SMTP_HOST` is set. Underpins all transactional email. |
| **Classification** | `dependencies` — **correct**. The mailer ships and runs in production. |
| **Version** | Bumped `8.0.11 → 9.0.0` (Dependabot, 2026-06). `9.0.0` is `latest`. The v9 major is a maintenance break — it drops support for end-of-life Node versions and removes the long-deprecated built-in `xoauth2` token generator and a few legacy options. None of those are reachable from our usage. |
| **Exposure** | Handles SMTP credentials + outbound network egress. nodemailer has a CVE history (header-injection classes); v9 is the current hardened line. The code passes only structured fields (`to`, `subject`, `text`/`html`, `bcc`, `attachments`) to `sendMail` — no raw header construction, no `xoauth2`. The v9 surface our two call sites touch (`createTransport` SMTP options + `sendMail` structured fields) is unchanged from v8; `npm run typecheck` is clean against the installed v9 + `@types/nodemailer@^8`. |
| **Maintenance** | Actively maintained; v9 is the current major line. |
| **Decision** | **Reviewed — v9 major bump verified safe for our usage; reviewed major raised 8 → 9.** |

## Summary

| Package | Classification | Version vs latest | Decision |
|---------|----------------|-------------------|----------|
| `js-yaml` | `dependencies` ✓ | `4.1.1` = latest | No action |
| `jszip` | `dependencies` ✓ | `3.10.1` = latest | No action |
| `pdfkit` | `dependencies` ✓ | `0.18.0` = latest | No action |
| `nodemailer` | `dependencies` ✓ | `9.0.0` = latest | Reviewed — v9 bump safe |

`npm audit --omit=dev --audit-level=moderate` reports **0
vulnerabilities** in production dependencies. No package is
deprecated. All four are at the latest published version inside
their current major and are genuine runtime dependencies — none can
safely move to `devDependencies`, and no in-major upgrade is
available or needed.

This review made **no `package.json` change** — the four packages
were already correctly classified and current. That is a valid,
documented outcome: a risk review's job is to *verify* posture, and
"verified clean" is as legitimate a result as a remediation.

Feature regression coverage was confirmed adequate rather than
re-added: `tests/unit/mailer.test.ts` (nodemailer transport
wiring), `tests/pdf/generators.test.ts` + `tests/pdf/table.test.ts`
(pdfkit), `tests/unit/library-loader.test.ts` +
`tests/unit/mapping-set-importer.test.ts` (js-yaml parsing),
`tests/integration/evidence-import.test.ts` (jszip archive
extraction) — 192 tests, all green.

## Re-running this review

When auditing the next batch of dependencies, copy the per-package
table shape above. The structural ratchet
`tests/guards/dependency-risk-review.test.ts` keeps the four
packages reviewed here pinned where this document says they are — if
a future change moves one of them to `devDependencies`, downgrades a
major, or drops it, the guard fails and points back here. Add new
audited packages to that guard's `REVIEWED` map in the same diff
that reviews them.
