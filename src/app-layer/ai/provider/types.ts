/**
 * Swappable AI provider — types.
 *
 * A thin, backend-agnostic completion surface. ONE implementation
 * (OpenAiCompatibleProvider) is backed by the `openai` SDK and serves
 * Ollama (local dev) / OpenRouter / Groq / Together — they differ only
 * by base URL + key + model (+ a capability map). The interface stays
 * minimal and fully typed: no `any`, structured output via Zod
 * generics, tool calls + streaming as opt-in options.
 */
import type { ZodType } from 'zod';

// ─── Backends ───

/**
 * The OpenAI-compatible backends this provider serves. `openai-compatible`
 * is a generic catch-all for any other host speaking the same shape.
 */
export type AiBackend = 'ollama' | 'openrouter' | 'groq' | 'together' | 'openai-compatible';

/** What a given backend can do. Drives the structured-output path. */
export interface AiCapabilities {
    /** Backend honours `response_format: { type: 'json_schema' }`. */
    jsonSchema: boolean;
    /** Backend supports OpenAI function/tool calling. */
    tools: boolean;
    /** Backend supports streamed chat completions. */
    streaming: boolean;
}

// ─── Messages ───

export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiMessage {
    role: AiRole;
    content: string;
    /** Present on `tool` messages — the id of the tool call being answered. */
    toolCallId?: string;
    /** Optional name (tool name on a `tool` message). */
    name?: string;
}

// ─── Tools ───

export interface AiToolDef {
    /** Tool name the model calls. */
    name: string;
    /** Human/model-readable description of what the tool does. */
    description?: string;
    /** JSON-Schema object describing the tool's parameters. */
    parameters: Record<string, unknown>;
}

export interface AiToolCall {
    id: string;
    name: string;
    /** Raw JSON-string arguments emitted by the model. */
    arguments: string;
}

// ─── Completion request / response ───

export interface AiCompleteOptions<T = unknown> {
    messages: AiMessage[];
    /**
     * When set, structured output: the response is parsed as JSON and
     * validated against this Zod schema; `parsed` carries the typed value.
     */
    schema?: ZodType<T>;
    /** Name for the json_schema response format (defaults to 'response'). */
    schemaName?: string;
    /** Function/tool calling — passed through to the backend. */
    tools?: AiToolDef[];
    /** Opt into streaming — `complete()` returns once the stream drains. */
    stream?: boolean;
    /** Sampling temperature (provider default when unset). */
    temperature?: number;
    /** Max completion tokens. */
    maxTokens?: number;
    /** Per-call model override (defaults to the configured model). */
    model?: string;
}

export interface AiCompletion<T = unknown> {
    /** Full assistant text (assembled from stream chunks when streaming). */
    text: string;
    /** Present when `schema` was supplied and validation succeeded. */
    parsed?: T;
    /** Present when the model emitted tool calls. */
    toolCalls?: AiToolCall[];
}

/** Result of a non-throwing backend probe. */
export interface AiHealth {
    /** The probe itself succeeded (backend reachable + responded). */
    ok: boolean;
    /** The configured model id. */
    model: string;
    /** Configured model is present in the backend's model list. */
    modelAvailable: boolean;
    /** Optional human-readable detail (error summary on failure). */
    detail?: string;
}

// ─── Provider ───

export interface AiProvider {
    /** The backend this provider instance is configured for. */
    readonly backend: AiBackend;
    /** Structured / tool / streaming completion. */
    complete<T = unknown>(opts: AiCompleteOptions<T>): Promise<AiCompletion<T>>;
    /** Non-throwing backend probe (model availability + reachability). */
    health(): Promise<AiHealth>;
}

/** Construction config for the OpenAI-compatible provider. */
export interface OpenAiCompatibleConfig {
    backend: AiBackend;
    baseURL: string;
    apiKey: string;
    model: string;
}
