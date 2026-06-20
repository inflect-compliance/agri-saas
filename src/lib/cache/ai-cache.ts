/**
 * AI response + embedding cache (feat/ai-guardrails).
 *
 * Mirrors `list-cache.ts` fallback semantics (graceful no-Redis bypass,
 * fail-open on Redis errors). Two caches:
 *
 *   • RESPONSE cache — keyed by model + a sha256 over the NORMALISED
 *     messages + task + temperature + maxTokens. Only deterministic-ish
 *     calls are cacheable (temperature ≤ 0.2 or unset; never streaming;
 *     never tool calls — those aren't idempotent / cleanly serialisable).
 *     TTL via `AI_CACHE_TTL_SECONDS` (default 3600s).
 *
 *   • EMBEDDING cache — keyed by model + sha256(normalised text). Longer
 *     TTL via `AI_EMBED_CACHE_TTL_SECONDS` (default 30 days) since
 *     embeddings are fully deterministic.
 *
 * Normalisation (trim + collapse whitespace) is applied before hashing so
 * trivially-different-but-equal prompts share a cache entry.
 *
 * Tenant scoping:
 *   • RESPONSE cache keys are tenant-scoped (`…:resp:{tenantId}:…`). A
 *     completion's prompt routinely carries tenant-private RAG context, and
 *     a privacy-first feature should not share advisory responses across
 *     tenant boundaries — intra-tenant repeats (retries, identical dashboard
 *     queries) capture essentially all the cost/latency benefit, and
 *     cross-tenant sharing is the only part that raises an isolation
 *     concern. So we keep it within the tenant, matching the codebase's
 *     tenant-scoped-everything convention.
 *   • EMBEDDING cache is intentionally GLOBAL. A vector is a pure
 *     deterministic function of (model, text) and stores nothing
 *     tenant-private in the value; sharing the embedding of an identical
 *     query string across tenants is safe and is where the real cost win
 *     lives.
 */
import { createHash } from 'node:crypto';
import { getRedis } from '@/lib/redis';
import { env } from '@/env';
import { logger } from '@/lib/observability/logger';
import type { AiCompletion, AiCompleteOptions } from '@/app-layer/ai/provider/types';

/** The routed task name — a plain string at the cache layer (no AI import cycle). */
type AiTaskLike = string;

const PREFIX = 'inflect:cache:v1:ai';
const DEFAULT_RESPONSE_TTL = 3600; // 1h
const DEFAULT_EMBED_TTL = 60 * 60 * 24 * 30; // 30d
/** Calls hotter than this temperature are too non-deterministic to cache. */
const MAX_CACHEABLE_TEMPERATURE = 0.2;

function responseTtl(): number {
    return env.AI_CACHE_TTL_SECONDS ?? DEFAULT_RESPONSE_TTL;
}
function embedTtl(): number {
    return env.AI_EMBED_CACHE_TTL_SECONDS ?? DEFAULT_EMBED_TTL;
}

/** Trim + collapse internal whitespace so equal-but-spaced prompts match. */
export function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

/**
 * Whether a completion call is eligible for the response cache. Streaming
 * and tool-call responses are never cached (not idempotent / cleanly
 * serialisable); high-temperature calls are too non-deterministic.
 */
export function isCacheableCompletion(opts: AiCompleteOptions): boolean {
    if (opts.stream) return false;
    if (opts.tools && opts.tools.length > 0) return false;
    const temp = opts.temperature;
    if (temp !== undefined && temp > MAX_CACHEABLE_TEMPERATURE) return false;
    return true;
}

/** Stable, tenant-scoped cache key for a completion. */
function completionKey(
    tenantId: string,
    model: string,
    task: AiTaskLike,
    opts: AiCompleteOptions,
): string {
    const norm = opts.messages.map((m) => ({
        role: m.role,
        content: normalizeText(m.content),
    }));
    const payload = JSON.stringify({
        task,
        messages: norm,
        temperature: opts.temperature ?? null,
        maxTokens: opts.maxTokens ?? null,
        // schema presence changes the response shape → part of the key.
        schema: opts.schema ? 'json' : 'text',
        schemaName: opts.schemaName ?? null,
    });
    return `${PREFIX}:resp:${tenantId}:${model}:${sha256(payload)}`;
}

/**
 * Look up a cached completion. Returns null on miss / no-Redis / error
 * (fail-open). The returned completion carries its ORIGINAL usage (so the
 * cache-hit ledger row records the would-have-been token count) — the
 * caller marks `cacheHit` + charges 0 cost.
 */
export async function getCachedCompletion<T = unknown>(
    tenantId: string,
    model: string,
    task: AiTaskLike,
    opts: AiCompleteOptions<T>,
): Promise<AiCompletion<T> | null> {
    const redis = getRedis();
    if (!redis || !isCacheableCompletion(opts)) return null;
    const key = completionKey(tenantId, model, task, opts);
    try {
        const raw = await redis.get(key);
        if (raw === null) return null;
        return JSON.parse(raw) as AiCompletion<T>;
    } catch (err) {
        logger.warn('ai-cache completion get failed', {
            component: 'ai-cache',
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/** Store a completion in the response cache (no-op without Redis). */
export async function setCachedCompletion<T = unknown>(
    tenantId: string,
    model: string,
    task: AiTaskLike,
    opts: AiCompleteOptions<T>,
    completion: AiCompletion<T>,
): Promise<void> {
    const redis = getRedis();
    if (!redis || !isCacheableCompletion(opts)) return;
    const key = completionKey(tenantId, model, task, opts);
    try {
        await redis.set(key, JSON.stringify(completion), 'EX', responseTtl());
    } catch (err) {
        logger.warn('ai-cache completion set failed', {
            component: 'ai-cache',
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ─── Embedding cache ──────────────────────────────────────────────

function embeddingKey(model: string, text: string): string {
    return `${PREFIX}:emb:${model}:${sha256(normalizeText(text))}`;
}

/** Look up a cached embedding vector. null on miss / no-Redis / error. */
export async function getCachedEmbedding(model: string, text: string): Promise<number[] | null> {
    const redis = getRedis();
    if (!redis) return null;
    try {
        const raw = await redis.get(embeddingKey(model, text));
        if (raw === null) return null;
        return JSON.parse(raw) as number[];
    } catch (err) {
        logger.warn('ai-cache embedding get failed', {
            component: 'ai-cache',
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/** Store an embedding vector (no-op without Redis). */
export async function setCachedEmbedding(model: string, text: string, vector: number[]): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
        await redis.set(embeddingKey(model, text), JSON.stringify(vector), 'EX', embedTtl());
    } catch (err) {
        logger.warn('ai-cache embedding set failed', {
            component: 'ai-cache',
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
