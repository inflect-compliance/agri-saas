/**
 * AI cost estimation (feat/ai-guardrails).
 *
 * Maps a model id + token usage to an estimated cost in USD
 * micro-dollars (integer — 1_000_000 micros = $1). Used by the budget
 * ledger (`AiUsageEvent.costMicros`) and the per-completion cost metric.
 *
 * IMPORTANT — the prices below are OPERATOR-TUNABLE ESTIMATES, not a
 * billing source of truth. They are list prices per 1,000,000 tokens at
 * the time of writing and WILL drift; an operator running a different
 * model mix should adjust `MODEL_PRICES`. Cost here exists for budgeting,
 * abuse-detection and observability — not invoicing. An unknown model
 * resolves to 0 (free) with a logged warning so a new/un-priced model is
 * loud but never blocks a completion.
 *
 * Local backends (ollama) cost nothing — the operator pays for the box,
 * not per token — so their models price at 0.
 */
import { logger } from '@/lib/observability/logger';
import type { AiUsage } from './provider/types';

/** Per-1M-token list prices (USD) for a model. */
interface ModelPrice {
    /** USD per 1,000,000 input (prompt) tokens. */
    inputPerMillion: number;
    /** USD per 1,000,000 output (completion) tokens. */
    outputPerMillion: number;
}

/**
 * Operator-tunable price table. Keys are matched case-insensitively and
 * by prefix (so `claude-opus-4-8`, `anthropic/claude-opus-4-8` and any
 * dated variant resolve to the same Opus price). Covers the models the
 * routing policy (`./routing.ts`) actually targets.
 *
 *   Claude Opus / Sonnet / Haiku — Anthropic list prices.
 *   Groq llama — Groq list price (cheap/fast tier).
 *   Ollama / local — 0 (self-hosted, no per-token cost).
 */
const MODEL_PRICES: Record<string, ModelPrice> = {
    // ── Anthropic Claude (native + OpenRouter-proxied) ──
    'claude-opus': { inputPerMillion: 15, outputPerMillion: 75 },
    'claude-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
    'claude-haiku': { inputPerMillion: 1, outputPerMillion: 5 },
    // ── Groq (cheap/fast bulk tier) ──
    'llama-3.3-70b': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
    'llama-3.1-8b': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
    // ── Embedding models (priced low; mostly local) ──
    'nomic-embed-text': { inputPerMillion: 0, outputPerMillion: 0 },
};

/**
 * Resolve the price entry for a model id. Normalises provider prefixes
 * (`anthropic/…`) and matches the longest table key that is a substring
 * of the (lower-cased) model id, so dated/region variants share a price.
 * Returns null when nothing matches.
 */
function lookupPrice(model: string): ModelPrice | null {
    const id = model.toLowerCase();
    // Local backends never cost anything.
    if (id.startsWith('ollama') || id.includes(':')) {
        // `qwen3:1.7b` and other Ollama-tagged ids are local → free.
        // (Hosted ids don't carry a `:` tag.)
        return { inputPerMillion: 0, outputPerMillion: 0 };
    }
    let best: ModelPrice | null = null;
    let bestLen = 0;
    for (const [key, price] of Object.entries(MODEL_PRICES)) {
        if (id.includes(key) && key.length > bestLen) {
            best = price;
            bestLen = key.length;
        }
    }
    return best;
}

/**
 * Estimate the cost of a completion in USD micro-dollars (integer).
 *
 * micros = round( (promptTokens/1e6 * inputPerMillion
 *                + completionTokens/1e6 * outputPerMillion) * 1e6 )
 *        = round( promptTokens * inputPerMillion
 *                + completionTokens * outputPerMillion )
 *
 * Unknown model → 0 + a logged warning (loud but non-blocking).
 */
export function estimateCostMicros(model: string, usage: AiUsage): number {
    const price = lookupPrice(model);
    if (!price) {
        logger.warn('ai cost: no price entry for model, charging 0', {
            component: 'ai',
            model,
        });
        return 0;
    }
    const micros =
        usage.promptTokens * price.inputPerMillion +
        usage.completionTokens * price.outputPerMillion;
    return Math.round(micros);
}
