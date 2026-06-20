/**
 * AI completion metrics (feat/ai-guardrails).
 *
 * OTel instruments for every routed AI completion. Lazy-initialised per
 * the `metrics.ts` pattern (give the global MeterProvider time to register;
 * the noop meter makes these zero-overhead when OTel is off).
 *
 *   ai.completion.count       — Counter   (task, model, backend, outcome, cache_hit)
 *   ai.completion.tokens      — Histogram (task, model, backend) [tokens, total]
 *   ai.completion.cost_micros — Histogram (task, model, backend) [USD micro-$]
 *   ai.completion.latency_ms  — Histogram (task, model, backend, outcome) [ms]
 *
 * CARDINALITY: task/model/backend are bounded enums (a handful of values).
 * tenant_id is intentionally NOT a label — it would explode cardinality on
 * a multi-tenant deployment; it lives on the span + the AuditLog instead.
 */
import { metrics, type Counter, type Histogram } from '@opentelemetry/api';
import type { AiUsage } from '@/app-layer/ai/provider/types';

const METER_NAME = 'inflect-compliance';

function getMeter() {
    return metrics.getMeter(METER_NAME);
}

let _count: Counter | undefined;
let _tokens: Histogram | undefined;
let _cost: Histogram | undefined;
let _latency: Histogram | undefined;

function getCount(): Counter {
    if (!_count) {
        _count = getMeter().createCounter('ai.completion.count', {
            description: 'Total AI completions by task/model/backend/outcome/cache',
            unit: '1',
        });
    }
    return _count;
}

function getTokens(): Histogram {
    if (!_tokens) {
        _tokens = getMeter().createHistogram('ai.completion.tokens', {
            description: 'Total tokens (prompt + completion) per AI completion',
            unit: '1',
        });
    }
    return _tokens;
}

function getCost(): Histogram {
    if (!_cost) {
        _cost = getMeter().createHistogram('ai.completion.cost_micros', {
            description: 'Estimated cost per AI completion in USD micro-dollars',
            unit: '1',
        });
    }
    return _cost;
}

function getLatency(): Histogram {
    if (!_latency) {
        _latency = getMeter().createHistogram('ai.completion.latency_ms', {
            description: 'AI completion wall-clock latency',
            unit: 'ms',
        });
    }
    return _latency;
}

export type AiCompletionOutcome = 'success' | 'error';

export interface RecordAiCompletionInput {
    task: string;
    model: string;
    backend: string;
    usage?: AiUsage;
    costMicros: number;
    latencyMs: number;
    cacheHit: boolean;
    outcome: AiCompletionOutcome;
}

/** Record one AI completion across all four instruments. */
export function recordAiCompletion(input: RecordAiCompletionInput): void {
    const labels = {
        'ai.task': input.task,
        'ai.model': input.model,
        'ai.backend': input.backend,
    };
    getCount().add(1, {
        ...labels,
        'ai.outcome': input.outcome,
        'ai.cache_hit': input.cacheHit,
    });
    if (input.usage) {
        getTokens().record(input.usage.totalTokens, labels);
    }
    getCost().record(input.costMicros, labels);
    getLatency().record(input.latencyMs, { ...labels, 'ai.outcome': input.outcome });
}
