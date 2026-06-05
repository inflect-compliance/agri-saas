# ─── Stage 1: Dependencies ─────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# `npm ci` — strict, deterministic install: installs exactly the
# package-lock.json tree and fails if it is out of sync with
# package.json. Never `npm install` in an image build (it can mutate
# the lockfile and resolve fresh versions, defeating reproducibility).
COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: Builder ──────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (skip env validation — real vars provided at runtime).
# --webpack: build with webpack, NOT Next 16's default Turbopack. The
# strict production CSP (script-src 'nonce-…' 'strict-dynamic', no
# unsafe-eval) needs the bundler runtime to put the nonce on every
# dynamically-loaded chunk. Webpack does (via __webpack_nonce__ →
# script.setAttribute('nonce', …)); Turbopack's runtime sets no nonce and
# relies on strict-dynamic propagation, which left some dynamic chunks
# blocked by script-src-elem. See docs/implementation-notes/2026-06-05-csp-webpack-bundler.md.
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build --webpack

# Build the standalone BullMQ worker + scheduler bundles. esbuild is
# a devDependency, so this MUST run before the prune below. Produces
# self-contained dist/worker.mjs + dist/scheduler.mjs (node_modules
# external) — the `worker` compose service runs these.
RUN npm run build:worker

# Prune dev dependencies before the runner stage copies node_modules.
# Without this, the runtime image carries ts-jest, semantic-release,
# playwright, and friends — including their transitive CVEs (e.g.
# handlebars@4.7.8 via ts-jest) — which Trivy then reports as
# production vulnerabilities even though the runtime never executes
# those modules.
RUN npm prune --omit=dev

# ─── Stage 3: Runner ──────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# System deps for Prisma
RUN apk add --no-cache openssl

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy build output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
# Prisma 7 — connection URL config moved out of `datasource db {}`
# in `prisma/schema/base.prisma` into `prisma.config.ts`. The CLI
# (`prisma migrate deploy` from the entrypoint) reads URLs from
# this file. Without it, deploy fails with
# "datasource.url property is required in your Prisma config file".
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts/entrypoint.sh ./scripts/entrypoint.sh
# The compiled BullMQ worker + scheduler bundles — run by the
# `worker` compose service, a separate process from `next start`.
COPY --from=builder /app/dist ./dist

# Ensure entrypoint is executable and upload dir exists
RUN chmod +x ./scripts/entrypoint.sh && \
    mkdir -p /data/uploads && \
    chown -R nextjs:nodejs /app /data/uploads

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./scripts/entrypoint.sh"]
