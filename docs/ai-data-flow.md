# AI data flow, redaction & egress (feat/ai-guardrails)

This document is the operator-facing map of **what data leaves the box**
when the AI subsystem runs a completion or an embedding, what is redacted
before it leaves, and the "prefer local for sensitive content" routing
policy. It is the privacy contract for the AI guardrails epic.

## Per-backend egress table

`completeWithRouting` resolves a task to a backend (see
`src/app-layer/ai/routing.ts`). The resolved backend determines whether
data leaves the box and whether PII redaction runs.

| Backend | Class | Provider / host | Leaves the box? | Redacted before egress |
|---|---|---|---|---|
| `ollama` | LOCAL | self-hosted Ollama (localhost) | **No** — stays on the box | n/a (no egress) |
| `claude` | EXTERNAL | Anthropic Messages API | Yes (Anthropic) | **Yes** |
| `openrouter` | EXTERNAL | OpenRouter (proxies upstream models) | Yes (OpenRouter + upstream) | **Yes** |
| `groq` | EXTERNAL | Groq | Yes (Groq) | **Yes** |
| `together` | EXTERNAL | Together AI | Yes (Together) | **Yes** |
| `openai-compatible` | EXTERNAL | operator-configured host | Yes (that host) | **Yes** |

"EXTERNAL" means the prompt content is transmitted off-box to a hosted
third party. "LOCAL" means it never leaves the operator's infrastructure.

## What is redacted before an EXTERNAL call

`src/lib/security/ai-redaction.ts::redactForExternal` replaces detected
PII with stable, reversible placeholders before the prompt is sent, and
`rehydrate` restores the real values in the model's RESPONSE so the user
sees their own data back. The round-trip is invisible to the caller.

Detected and replaced:

- **Emails** → `[EMAIL_n]`
- **Phone numbers** (≥ 7 digits) → `[PHONE_n]`
- **Precise lat/long coordinate pairs** (decimal) → `[COORD_n]`
- **Caller-supplied sensitive spans** (contract terms, identifiers passed
  via `opts.sensitiveTerms`) → `[TERM_n]`

LOCAL (`ollama`) calls skip redaction entirely — the data stays on the
box, so there is nothing to protect from egress.

The immutable `AI_COMPLETION` audit entry and the `AiUsageEvent` ledger
store **only the sha256 `promptHash`** — never the raw prompt, response,
or any PII. The `audit-redact` `SENSITIVE_PATTERNS` are extended so
`prompt` / `response` / `messages` fields are scrubbed from any audit
payload (the anchored patterns deliberately do NOT match `promptHash`).

## "Prefer local for sensitive content" policy

When a request is sensitive **and** a local backend is configured,
`completeWithRouting` biases routing to keep the data on the box. A
request is considered sensitive when **either**:

1. the caller sets `opts.sensitive === true`, **or**
2. redaction detected PII in the prompt (the redaction map is non-empty).

Precedence:

1. If sensitive **and** a local backend (`ollama`) is configured
   (`AI_BACKEND=ollama` or `AI_BASE_URL` infers to localhost), the local
   target is tried **first**, ahead of the route's natural chain.
2. Otherwise the route's natural order (primary + failover) is used.

This is **best-effort and behind the existing routing**: if the local
target hard-fails, the normal cross-provider failover chain still runs
(redaction applies to those external fallbacks), so resilience is never
sacrificed for the preference.

## Caching

`src/lib/cache/ai-cache.ts` caches **deterministic** completions
(temperature ≤ 0.2, non-streaming, non-tool) and embeddings in Redis. The
cache key is a sha256 over the normalised prompt + model; the cached
VALUE is the model's generic answer. No tenant id is in the key — an
identical prompt yields an identical answer regardless of tenant, and
nothing tenant-private is derivable from the cache. Cache hits charge **0
new tokens/cost** to the budget but still write the audit + usage rows
with `cacheHit: true`. When Redis is absent the cache is a transparent
no-op (provider is called every time).

## Dhenu2 A/B eval hook — LICENCE NOTE

The offline eval harness (`scripts/ai/eval/run.ts`) has an OPTIONAL,
config-driven A/B hook gated by the `AI_EVAL_AB_BACKEND` env var
(`<baseURL>|<model>`). When set, it runs the open-ended agronomy suite a
second time against that operator-supplied endpoint and reports it
side-by-side (`agronomy-open-ab`) with the default general + RAG backend.
It is **default OFF** — unset means no A/B run and CI is unaffected.

**Dhenu2-1B (KissanAI) is an agri-tuned model some operators may want to
evaluate here.** This repo does **NOT** bundle, vendor, or download any
model weights. The hook only POSTs prompts to an **operator-supplied
endpoint** the operator stands up themselves.

> **Verify the Dhenu2-1B licence before any commercial use.** Treat it as
> an operator-supplied endpoint only, never as vendored weights. Because
> the harness performs no redistribution — it merely points at a running
> endpoint — it stays compliant even if the model's licence is
> non-permissive / non-commercial. If you intend to *deploy* Dhenu2 (not
> just eval it), do your own licence review first.
