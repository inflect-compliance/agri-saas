/**
 * General-purpose LLM client (OpenRouter / Claude) for ag-domain AI.
 *
 * Reuses the same OpenRouter endpoint + `OPENROUTER_API_KEY` /
 * `OPENROUTER_MODEL` env the risk-assessment provider uses, but exposes a
 * GENERIC text + vision JSON-completion surface so the agronomy copilot
 * and the photo pest/disease identifier (and any future ag AI) don't each
 * re-implement the HTTP call.
 *
 * FAIL-SAFE by construction: every entry point returns `null` (never
 * throws) when the key is absent or the call fails. AI here is an
 * enrichment — a spray signal still fires and a photo still uploads with
 * the AI off; the caller treats `null` as "no suggestion this time".
 *
 * Multimodal: OpenRouter normalises to the OpenAI content-block shape, so
 * an image rides as an `image_url` block with a base64 data URI — Claude
 * vision models read it directly.
 */
import { env } from '@/env';
import { logger } from '@/lib/observability/logger';
import { localeOutputInstruction } from './locale-instruction';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

export interface TextBlock {
    type: 'text';
    text: string;
}
export interface ImageBlock {
    type: 'image_url';
    image_url: { url: string };
}
export type ContentBlock = TextBlock | ImageBlock;

export interface LlmMessage {
    role: 'system' | 'user';
    content: string | ContentBlock[];
}

export interface LlmOptions {
    maxTokens?: number;
    temperature?: number;
    /** Override the model (defaults to OPENROUTER_MODEL / claude-3.5-sonnet). */
    model?: string;
    /** Owning user's UI locale — pins the model's OUTPUT language (bg → Bulgarian). */
    locale?: string | null;
}

/** True when an LLM key is configured — gate UI/enqueue on this. */
export function isLlmConfigured(): boolean {
    return Boolean(env.OPENROUTER_API_KEY);
}

/** A base64 data URI for an image content block. */
export function imageDataUri(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`;
}

/**
 * Send messages to the model and return the parsed JSON object, or `null`
 * if the LLM isn't configured or anything fails. The model is asked for a
 * JSON object (`response_format`); the caller validates the shape with its
 * own Zod schema.
 */
export async function llmCompleteJson(
    messages: LlmMessage[],
    opts: LlmOptions = {},
): Promise<Record<string, unknown> | null> {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    const model = opts.model ?? env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
    // Pin the output language to the owning user's locale by prepending a
    // system instruction (empty → unchanged for English).
    const instruction = localeOutputInstruction(opts.locale);
    const finalMessages: LlmMessage[] = instruction
        ? [{ role: 'system', content: instruction }, ...messages]
        : messages;
    try {
        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://inflect-compliance.app',
                'X-Title': 'Inflect — Agronomy AI',
            },
            body: JSON.stringify({
                model,
                messages: finalMessages,
                temperature: opts.temperature ?? 0.2,
                max_tokens: opts.maxTokens ?? 1024,
                response_format: { type: 'json_object' },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown');
            logger.warn('llm call non-ok', { component: 'ai', status: response.status, error: errorText.slice(0, 200) });
            return null;
        }

        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            logger.warn('llm returned empty content', { component: 'ai', model });
            return null;
        }
        const parsed = JSON.parse(content) as Record<string, unknown>;
        return parsed;
    } catch (error) {
        logger.warn('llm call failed', {
            component: 'ai',
            model,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
