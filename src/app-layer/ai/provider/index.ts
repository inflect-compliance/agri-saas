/**
 * Swappable AI provider — factory.
 *
 * `getAiProvider()` reads the AI_* env contract (via src/env.ts — never
 * raw process.env) and returns ONE OpenAiCompatibleProvider configured
 * for the chosen backend. Local dev defaults to Ollama (qwen3:1.7b at
 * http://localhost:11434/v1, key 'ollama') so it runs with zero config
 * at zero API cost; prod swaps the backend purely by setting AI_BASE_URL
 * / AI_API_KEY / AI_MODEL (+ optional AI_BACKEND).
 *
 * Backend inference: when AI_BACKEND is the default 'ollama' but the base
 * URL points elsewhere (openrouter.ai / groq / together), the backend is
 * inferred from the host so the capability map matches the real backend.
 */
import { env } from '@/env';
import { OpenAiCompatibleProvider, AiProviderError } from './openai-compatible-provider';
import { ClaudeProvider } from './claude-provider';
import type { AiBackend, AiProvider } from './types';

/** Infer the backend from a base-URL host when not set explicitly. */
export function inferBackend(baseURL: string): AiBackend {
    let host: string;
    try {
        host = new URL(baseURL).hostname.toLowerCase();
    } catch {
        return 'openai-compatible';
    }
    // Exact host OR a subdomain of it — NOT a substring match (a substring
    // check would treat e.g. `evilgroq.com` / `groq.com.attacker.net` as Groq;
    // CodeQL's js/incomplete-url-substring-sanitization flags that).
    const isHost = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (isHost('openrouter.ai')) return 'openrouter';
    if (isHost('groq.com')) return 'groq';
    if (isHost('together.ai') || isHost('together.xyz')) return 'together';
    if (host === 'localhost' || host === '127.0.0.1' || isHost('ollama')) return 'ollama';
    return 'openai-compatible';
}

/**
 * Resolve the configured backend. An explicitly-set AI_BACKEND (anything
 * other than the schema default 'ollama') wins; otherwise infer from the
 * base URL so a hosted base URL with the default backend still maps right.
 */
function resolveBackend(): AiBackend {
    const explicit = env.AI_BACKEND;
    const inferred = inferBackend(env.AI_BASE_URL);
    // 'ollama' is the schema default — treat it as "unset" so a hosted
    // AI_BASE_URL is honoured. Any other explicit value is respected.
    if (explicit !== 'ollama') {
        // 'openai-compatible' is a deliberate generic choice — prefer a
        // sharper inference when the host is recognisable.
        if (explicit === 'openai-compatible' && inferred !== 'openai-compatible') return inferred;
        return explicit;
    }
    return inferred;
}

/**
 * Build the configured provider from env. When `AI_BACKEND='claude'`
 * the native `ClaudeProvider` (Anthropic Messages API) is returned,
 * authenticated with `ANTHROPIC_API_KEY`; every other backend resolves
 * to the single `OpenAiCompatibleProvider`.
 */
export function getAiProvider(): AiProvider {
    if (env.AI_BACKEND === 'claude') {
        const apiKey = env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new AiProviderError(
                'claude',
                'AI_BACKEND=claude requires ANTHROPIC_API_KEY to be set.',
            );
        }
        return new ClaudeProvider({
            apiKey,
            model: env.AI_MODEL,
            baseURL: env.ANTHROPIC_BASE_URL,
        });
    }

    return new OpenAiCompatibleProvider({
        backend: resolveBackend(),
        baseURL: env.AI_BASE_URL,
        apiKey: env.AI_API_KEY,
        model: env.AI_MODEL,
        embedModel: env.AI_EMBED_MODEL,
    });
}

export { OpenAiCompatibleProvider, CAPABILITIES, AiProviderError } from './openai-compatible-provider';
export { ClaudeProvider, DEFAULT_CLAUDE_MODEL } from './claude-provider';
export type {
    AiBackend,
    AiCapabilities,
    AiProvider,
    AiMessage,
    AiRole,
    AiToolDef,
    AiToolCall,
    AiCompleteOptions,
    AiCompletion,
    AiEmbedOptions,
    AiEmbedding,
    AiHealth,
    OpenAiCompatibleConfig,
} from './types';
