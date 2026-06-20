# 2026-06-20 — AI guardrails (cheap / private / abuse-resistant / observable)

**Commit:** `feat(ai): per-tenant budgets, PII redaction, rate limit, cache, audit/metrics`

## Design

Cross-cutting AI governance wrapped around the single completion chokepoint,
`completeWithRouting` in `src/app-layer/ai/routing.ts`. Its public signature is
unchanged, so every caller (the agronomy advisor, copilot SSE route, Claude
vision provider, eval harness) inherits the guardrails for free.

Order of operations inside `completeWithRouting`:

```
rate-limit (tenant+user)        → 429 on abuse
  → tier entitlement gate        (existing)
  → monthly token budget         → hard-stop at 100%, soft-warn at 80%
  → response cache lookup        → tenant-scoped; hit = 0-cost ledger row + audit
  → per-target loop:
       PII redaction (external)  → placeholders before egress
       provider.complete         → returns token usage
       rehydrate (external)      → restore PII in the response text
  → cost estimate + OTel span + metrics + usage-ledger row + immutable audit
  → response cache store
```

Token usage is the foundation: `AiCompletion.usage` is now populated by both
providers (SDK-reported, with a `chars/4` estimate fallback), feeding the cost
table, the budget ledger, the metrics, and the audit entry.

Privacy has two layers: redaction (placeholder/rehydrate) is the guarantee for
hosted backends; a best-effort "prefer local" policy routes PII-bearing or
caller-flagged-sensitive requests to a local (Ollama) backend when one is
configured.

## Files

| File | Role |
|---|---|
| `src/app-layer/ai/provider/types.ts` | `AiUsage` + `AiCompletion.usage`; optional `sensitive`/`sensitiveTerms`/`citations` opts (backward compatible) |
| `src/app-layer/ai/provider/{claude,openai-compatible}-provider.ts` | populate `usage` from SDK (incl. streaming), estimate fallback |
| `src/app-layer/ai/token-estimate.ts` | `chars/4` token estimator |
| `src/app-layer/ai/cost.ts` | operator-tunable per-model price table → `estimateCostMicros` |
| `prisma/schema/ai.prisma` + migration `20260620000000_ai_usage_event` | `AiUsageEvent` append-only usage ledger + RLS split trio |
| `src/lib/billing/entitlements.ts` | `ai_tokens` gated resource; month-to-date sum in `getCurrentCount` |
| `src/app-layer/ai/budget.ts` | `assertAiBudget` — hard-stop / soft-warn / unlimited |
| `src/app-layer/ai/usage.ts` | `recordAiUsage` RLS-scoped ledger append |
| `src/lib/security/ai-redaction.ts` | `redactForExternal` / `rehydrate` / `isExternalBackend` |
| `src/lib/audit-redact.ts` | extended `SENSITIVE_PATTERNS` (anchored prompt/response/messages) |
| `src/lib/rate-limit/aiRateLimit.ts` | `assertAiRateLimit` — Upstash + in-memory fallback |
| `src/lib/observability/ai-metrics.ts` | `recordAiCompletion` (count/tokens/cost/latency) |
| `src/lib/cache/ai-cache.ts` | tenant-scoped response cache + global embedding cache |
| `src/app-layer/ai/rag/retrieve.ts` | query-embedding cache wired in |
| `src/app-layer/ai/routing.ts` | the orchestration described above |
| `src/env.ts` | `AI_CACHE_TTL_SECONDS`, `AI_EMBED_CACHE_TTL_SECONDS`, `AI_RATE_LIMIT_PER_MIN`, `AI_EVAL_AB_BACKEND` |
| `scripts/ai/eval/run.ts` | optional, off-by-default Dhenu2 A/B suite |
| `docs/ai-data-flow.md` | per-backend egress table + redaction list + Dhenu2 licence note |

## Decisions

- **Response cache is tenant-scoped; embedding cache is global.** A completion's
  prompt routinely carries tenant-private RAG context, so its cache value is
  kept within the tenant (matching the codebase's tenant-scoped-everything
  convention) — intra-tenant repeats capture nearly all the benefit. An
  embedding is a pure deterministic function of `(model, text)` and stores
  nothing tenant-private in the value, so it is shared globally where the real
  cost win lives. (The build agent's original cross-tenant response key was
  changed to tenant-scoped during review.)
- **Budget is a soft governance wall, not a hard quota.** It is checked before
  the call against month-to-date usage; a single call can overshoot its own cap.
  Acceptable for cost governance; a true hard wall would need pre-reservation.
- **`userId` on the ledger has no FK** so usage history survives user deletion
  and avoids a Layer-B FK-index obligation.
- **Audit stores the prompt hash, never the prompt** — keeps user PII out of the
  immutable audit chain while preserving verifiability of "what was asked".
- **RLS uses the repo's split trio** (`tenant_isolation` USING +
  `tenant_isolation_insert` WITH CHECK + `superuser_bypass`) required for
  non-nullable `tenantId`, mirrored from a recent standard-table migration.
- **Degrades safely with infra absent:** no Redis → cache no-op; no Upstash →
  in-memory rate limiter; no DB → ledger/audit best-effort (never fails the
  completion); self-hosted (no Stripe) → ENTERPRISE/unlimited budget.
- **Dhenu2 A/B is off by default and bundles no weights** — it points at an
  operator-supplied endpoint only, so the harness redistributes nothing
  regardless of Dhenu2's licence.
