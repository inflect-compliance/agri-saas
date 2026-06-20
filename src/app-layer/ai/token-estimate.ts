/**
 * Token estimation fallback (feat/ai-guardrails).
 *
 * When a provider SDK does not return real token usage (some
 * OpenAI-compatible hosts omit it, streaming partials, etc.) we still
 * need a number for the budget ledger + cost. The industry rule-of-thumb
 * is ~4 characters per token for English text; we use `ceil(chars / 4)`.
 *
 * This is deliberately crude — the resulting `AiUsage` carries
 * `estimated: true` so consumers know it is approximate. Real SDK usage
 * always takes precedence; this is only the floor.
 */
import type { AiMessage, AiUsage } from './provider/types';

const CHARS_PER_TOKEN = 4;

/** Estimate tokens for an arbitrary string (`ceil(chars / 4)`). */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate prompt tokens across a message array (sum of role+content). */
export function estimateMessageTokens(messages: AiMessage[]): number {
    let chars = 0;
    for (const m of messages) {
        chars += m.content.length + m.role.length;
        if (m.name) chars += m.name.length;
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Build an estimated `AiUsage` from the prompt messages + the completion
 * text. Used as a fallback when the SDK omitted usage.
 */
export function estimateUsage(messages: AiMessage[], completionText: string): AiUsage {
    const promptTokens = estimateMessageTokens(messages);
    const completionTokens = estimateTokens(completionText);
    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimated: true,
    };
}
