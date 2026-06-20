/**
 * AI task-routing policy (feat/ai-prod-routing).
 *
 * Maps a high-level TASK to a concrete MODEL TIER — which backend,
 * which model, the token budget, timeout, retry count, and an ordered
 * failover chain. This is the single place that decides "what does
 * `copilot-chat` run on?" so call sites stay declarative: they name a
 * task, not a model.
 *
 * Tiering philosophy:
 *   - Cheap, high-volume, low-stakes tasks (bulk classification, quick
 *     explanations) run on Groq (fast/cheap) or Claude Haiku.
 *   - Load-bearing reasoning (dosage calc, regulatory, long-horizon
 *     planning) runs on Claude Sonnet/Opus — correctness over cost.
 *   - Every tier has an ordered `failover` chain: if the primary
 *     backend hard-fails, `completeWithRouting` retries on the next
 *     entry. The chains cross provider boundaries (Claude → OpenRouter,
 *     Groq → OpenRouter) so a single-provider outage degrades rather
 *     than fails.
 *
 * Provider-agnostic: a route entry names a `backend` + `model`, and
 * `completeWithRouting` constructs the matching provider. It works
 * whether the entry is `claude` or any OpenAI-compatible backend.
 *
 * Entitlement gating: each tier carries an `AiTier`; before any model
 * call, `completeWithRouting` runs `assertAiTierAllowed(ctx, tier)`
 * so a FREE tenant cannot reach a premium-tier model even by naming a
 * premium task.
 */
import type { RequestContext } from '@/app-layer/types';
import { logger } from '@/lib/observability/logger';
import { assertAiTierAllowed, type AiTier } from '@/lib/billing/entitlements';
import { AiProviderError } from './provider/openai-compatible-provider';
import { ClaudeProvider } from './provider/claude-provider';
import { OpenAiCompatibleProvider } from './provider/openai-compatible-provider';
import type {
    AiBackend,
    AiCompleteOptions,
    AiCompletion,
    AiProvider,
} from './provider/types';
import { env } from '@/env';

// ─── Task taxonomy ───────────────────────────────────────────────

/**
 * The set of routable tasks. Each maps to a tier in `TASK_TIER`.
 *
 *   copilot-chat      — interactive assistant chat (default reasoning).
 *   spray-explanation — explain a spray/treatment recommendation.
 *   dosage-calc       — compute a chemical dosage (load-bearing: wrong
 *                       numbers are dangerous → premium tier).
 *   regulatory        — regulatory / compliance reasoning (premium).
 *   long-horizon      — multi-step planning over a season (premium).
 *   cheap-bulk        — high-volume, low-stakes classification/tagging.
 */
export type AiTask =
    | 'copilot-chat'
    | 'spray-explanation'
    | 'dosage-calc'
    | 'regulatory'
    | 'long-horizon'
    | 'cheap-bulk';

/** One backend+model target in a route's primary/failover chain. */
export interface AiRouteTarget {
    backend: AiBackend;
    model: string;
}

/** The resolved policy for a task. */
export interface AiRoute {
    /** Capability/entitlement tier — gated against the tenant's plan. */
    tier: AiTier;
    /** Primary backend to try first. */
    backend: AiBackend;
    /** Primary model id. */
    model: string;
    /** Token budget for the completion. */
    maxTokens: number;
    /** Per-attempt timeout in ms (AbortController). */
    timeoutMs: number;
    /** Transient-failure retries on the SAME target before failover. */
    retries: number;
    /**
     * Ordered failover chain tried after the primary (and its retries)
     * hard-fail. Each entry is a distinct backend/model.
     */
    failover: AiRouteTarget[];
}

// ─── Tier model targets ──────────────────────────────────────────
//
// Models per tier. Claude tiers use the canonical Anthropic ids.
// OpenAI-compatible failover uses OpenRouter (broad model catalogue)
// and Groq (cheap/fast) — the model strings are illustrative slugs
// resolved by those backends at request time.

const CLAUDE_HAIKU = 'claude-haiku-4-5';
const CLAUDE_SONNET = 'claude-sonnet-4-6';
const CLAUDE_OPUS = 'claude-opus-4-8';

// OpenRouter / Groq failover model slugs.
const OPENROUTER_SONNET = 'anthropic/claude-sonnet-4-6';
const OPENROUTER_HAIKU = 'anthropic/claude-haiku-4-5';
const GROQ_FAST = 'llama-3.3-70b-versatile';

/**
 * The route table. The primary target on the premium/standard tiers is
 * native Claude (prompt caching + tool-use); the cheap tier defaults to
 * Groq for high-volume throughput. Every tier fails over across
 * provider boundaries.
 */
const ROUTES: Record<AiTask, AiRoute> = {
    // Interactive chat — standard reasoning on Sonnet, fail over to
    // OpenRouter's Sonnet, then Haiku.
    'copilot-chat': {
        tier: 'standard',
        backend: 'claude',
        model: CLAUDE_SONNET,
        maxTokens: 4096,
        timeoutMs: 60_000,
        retries: 1,
        failover: [
            { backend: 'openrouter', model: OPENROUTER_SONNET },
            { backend: 'claude', model: CLAUDE_HAIKU },
        ],
    },
    // Spray explanation — cheap/standard; Haiku is plenty, fail over to
    // OpenRouter Haiku.
    'spray-explanation': {
        tier: 'standard',
        backend: 'claude',
        model: CLAUDE_HAIKU,
        maxTokens: 2048,
        timeoutMs: 45_000,
        retries: 1,
        failover: [{ backend: 'openrouter', model: OPENROUTER_HAIKU }],
    },
    // Dosage — premium; correctness critical → Opus, fail over to
    // Sonnet (still strong) then OpenRouter Sonnet.
    'dosage-calc': {
        tier: 'premium',
        backend: 'claude',
        model: CLAUDE_OPUS,
        maxTokens: 4096,
        timeoutMs: 90_000,
        retries: 2,
        failover: [
            { backend: 'claude', model: CLAUDE_SONNET },
            { backend: 'openrouter', model: OPENROUTER_SONNET },
        ],
    },
    // Regulatory — premium; same shape as dosage.
    regulatory: {
        tier: 'premium',
        backend: 'claude',
        model: CLAUDE_OPUS,
        maxTokens: 8192,
        timeoutMs: 120_000,
        retries: 2,
        failover: [
            { backend: 'claude', model: CLAUDE_SONNET },
            { backend: 'openrouter', model: OPENROUTER_SONNET },
        ],
    },
    // Long-horizon planning — premium; large token budget + long
    // timeout for multi-step reasoning.
    'long-horizon': {
        tier: 'premium',
        backend: 'claude',
        model: CLAUDE_OPUS,
        maxTokens: 16_384,
        timeoutMs: 180_000,
        retries: 1,
        failover: [{ backend: 'claude', model: CLAUDE_SONNET }],
    },
    // Cheap bulk — Groq for cheap/fast high volume, fail over to
    // OpenRouter Haiku.
    'cheap-bulk': {
        tier: 'cheap',
        backend: 'groq',
        model: GROQ_FAST,
        maxTokens: 1024,
        timeoutMs: 30_000,
        retries: 1,
        failover: [{ backend: 'openrouter', model: OPENROUTER_HAIKU }],
    },
};

/** Resolve the routing policy for a task. */
export function routeTask(task: AiTask): AiRoute {
    const route = ROUTES[task];
    if (!route) {
        throw new AiProviderError('openai-compatible', `No route configured for AI task "${task}".`);
    }
    return route;
}

// ─── Provider construction per target ────────────────────────────

/**
 * Build the provider for a route target. Native Claude targets use
 * ClaudeProvider (ANTHROPIC_API_KEY); every OpenAI-compatible target
 * uses OpenAiCompatibleProvider configured for that backend.
 *
 * Backend → base URL / key mapping is read from env. OpenRouter and
 * Groq are the documented prod failover hosts; their keys live in
 * AI_API_KEY (single configured OpenAI-compatible key) unless the
 * target's host already matches the configured AI_BASE_URL.
 */
export function providerForTarget(target: AiRouteTarget): AiProvider {
    if (target.backend === 'claude') {
        const apiKey = env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new AiProviderError('claude', 'Claude route target requires ANTHROPIC_API_KEY.');
        }
        return new ClaudeProvider({
            apiKey,
            model: target.model,
            baseURL: env.ANTHROPIC_BASE_URL,
        });
    }

    const baseURL = baseUrlForBackend(target.backend);
    return new OpenAiCompatibleProvider({
        backend: target.backend,
        baseURL,
        apiKey: env.AI_API_KEY,
        model: target.model,
        embedModel: env.AI_EMBED_MODEL,
    });
}

/** Canonical base URL per OpenAI-compatible backend. */
function baseUrlForBackend(backend: AiBackend): string {
    switch (backend) {
        case 'openrouter':
            return 'https://openrouter.ai/api/v1';
        case 'groq':
            return 'https://api.groq.com/openai/v1';
        case 'together':
            return 'https://api.together.xyz/v1';
        case 'ollama':
        case 'openai-compatible':
        default:
            // Fall back to the configured base URL (local dev / generic).
            return env.AI_BASE_URL;
    }
}

// ─── Orchestrated completion ─────────────────────────────────────

/**
 * Whether an error is transient (worth a same-target retry) vs hard
 * (move to failover). Timeouts/aborts and 429/5xx-ish failures are
 * transient; everything else triggers failover.
 */
function isTransient(err: unknown): boolean {
    if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        if (msg.includes('timeout') || msg.includes('aborted') || msg.includes('econnreset')) return true;
        // OpenAI/Anthropic SDK errors carry a numeric `status`.
        const status = (err as { status?: number }).status;
        if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
    }
    return false;
}

/**
 * Run a single completion against one target with a per-attempt
 * timeout. If the caller passed a `signal`, it is linked so a client
 * abort cancels the upstream request; the timeout fires its own abort.
 */
async function completeOnce<T>(
    provider: AiProvider,
    opts: AiCompleteOptions<T>,
    model: string,
    maxTokens: number,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
): Promise<AiCompletion<T>> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(new Error('routing timeout')), timeoutMs);

    // Link the caller's signal so a client disconnect aborts too.
    const onCallerAbort = () => timeoutController.abort(new Error('aborted by caller'));
    if (callerSignal) {
        if (callerSignal.aborted) timeoutController.abort(new Error('aborted by caller'));
        else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
        return await provider.complete<T>({
            ...opts,
            model,
            maxTokens: opts.maxTokens ?? maxTokens,
            signal: timeoutController.signal,
        });
    } finally {
        clearTimeout(timer);
        if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    }
}

/**
 * Route a task to its tier and run the completion with entitlement
 * gating, per-attempt timeout, transient-failure retries, and
 * cross-provider failover.
 *
 * Order of operations:
 *   1. Resolve the route for the task.
 *   2. Gate the tier against the tenant's plan (throws 403 if denied).
 *   3. Try the primary target (with `retries` same-target retries on
 *      transient failure).
 *   4. On hard failure, walk the `failover` chain.
 *   5. If every target fails, throw the last error.
 */
export async function completeWithRouting<T = unknown>(
    ctx: RequestContext,
    task: AiTask,
    opts: AiCompleteOptions<T>,
): Promise<AiCompletion<T>> {
    const route = routeTask(task);

    // Entitlement gate — throws forbidden(...) if the plan can't use
    // this tier. Done before any model call so denials are cheap.
    await assertAiTierAllowed(ctx, route.tier);

    const targets: AiRouteTarget[] = [
        { backend: route.backend, model: route.model },
        ...route.failover,
    ];

    let lastError: unknown;

    for (let t = 0; t < targets.length; t++) {
        const target = targets[t];
        let provider: AiProvider;
        try {
            provider = providerForTarget(target);
        } catch (err) {
            // Target unconfigured (e.g. missing key) — skip to next.
            lastError = err;
            logger.warn('ai routing target unavailable, trying next', {
                component: 'ai',
                task,
                backend: target.backend,
                model: target.model,
                error: err instanceof Error ? err.message : String(err),
            });
            continue;
        }

        // attempt 0 + `retries` retries on the SAME target.
        for (let attempt = 0; attempt <= route.retries; attempt++) {
            try {
                return await completeOnce<T>(
                    provider,
                    opts,
                    target.model,
                    route.maxTokens,
                    route.timeoutMs,
                    opts.signal,
                );
            } catch (err) {
                lastError = err;
                const transient = isTransient(err);
                const moreRetries = attempt < route.retries;
                const moreTargets = t < targets.length - 1;

                logger.warn('ai routing attempt failed', {
                    component: 'ai',
                    task,
                    backend: target.backend,
                    model: target.model,
                    attempt,
                    transient,
                    willRetry: transient && moreRetries,
                    willFailover: (!transient || !moreRetries) && moreTargets,
                    error: err instanceof Error ? err.message : String(err),
                });

                // If caller aborted (not a timeout), don't keep retrying.
                if (opts.signal?.aborted) throw err;

                if (transient && moreRetries) continue; // same-target retry
                break; // move to next target
            }
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new AiProviderError(route.backend, `All routing targets failed for task "${task}".`);
}
