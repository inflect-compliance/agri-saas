/**
 * Provider token-usage population — unit tests.
 *
 * Verifies both providers surface `usage` on AiCompletion: actual when the
 * SDK reports it, and an `estimated` char/4 fallback when it does not.
 */
jest.mock('@/lib/observability/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// ── Mock the Anthropic SDK ──
const anthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
    return {
        __esModule: true,
        default: class Anthropic {
            messages = { create: anthropicCreate, stream: jest.fn() };
            models = { list: jest.fn() };
        },
    };
});

// ── Mock the OpenAI SDK ──
const openaiCreate = jest.fn();
jest.mock('openai', () => {
    return {
        __esModule: true,
        default: class OpenAI {
            chat = { completions: { create: openaiCreate } };
            embeddings = { create: jest.fn() };
            models = { list: jest.fn() };
        },
    };
});

import { ClaudeProvider } from '@/app-layer/ai/provider/claude-provider';
import { OpenAiCompatibleProvider } from '@/app-layer/ai/provider/openai-compatible-provider';

beforeEach(() => {
    anthropicCreate.mockReset();
    openaiCreate.mockReset();
});

describe('ClaudeProvider usage', () => {
    it('maps Anthropic input_tokens / output_tokens to AiUsage', async () => {
        anthropicCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'hello' }],
            usage: { input_tokens: 42, output_tokens: 13 },
            stop_reason: 'end_turn',
        });
        const provider = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-4-8' });
        const out = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
        expect(out.usage).toEqual({ promptTokens: 42, completionTokens: 13, totalTokens: 55 });
        expect(out.usage!.estimated).toBeUndefined();
    });

    it('estimates usage (char/4, estimated:true) when the SDK omits it', async () => {
        anthropicCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'abcdefgh' }], // 8 chars → 2 tokens
            usage: undefined,
            stop_reason: 'end_turn',
        });
        const provider = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-4-8' });
        const out = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
        expect(out.usage!.estimated).toBe(true);
        expect(out.usage!.completionTokens).toBe(2);
        expect(out.usage!.totalTokens).toBeGreaterThan(0);
    });
});

describe('OpenAiCompatibleProvider usage', () => {
    it('maps prompt_tokens / completion_tokens to AiUsage', async () => {
        openaiCreate.mockResolvedValue({
            choices: [{ message: { content: 'hello', tool_calls: [] } }],
            usage: { prompt_tokens: 30, completion_tokens: 20 },
        });
        const provider = new OpenAiCompatibleProvider({
            backend: 'groq',
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: 'k',
            model: 'llama-3.3-70b-versatile',
        });
        const out = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
        expect(out.usage).toEqual({ promptTokens: 30, completionTokens: 20, totalTokens: 50 });
    });

    it('estimates usage when the host omits the usage object', async () => {
        openaiCreate.mockResolvedValue({
            choices: [{ message: { content: 'abcd', tool_calls: [] } }], // 4 chars → 1 token
            usage: undefined,
        });
        const provider = new OpenAiCompatibleProvider({
            backend: 'groq',
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: 'k',
            model: 'llama-3.3-70b-versatile',
        });
        const out = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
        expect(out.usage!.estimated).toBe(true);
        expect(out.usage!.completionTokens).toBe(1);
    });
});
