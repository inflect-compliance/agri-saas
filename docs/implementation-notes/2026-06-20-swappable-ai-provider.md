# 2026-06-20 — Swappable AI provider

**Commit:** `<pending> feat: swappable OpenAI-compatible AI provider`

## Design

ONE OpenAI-compatible provider (`src/app-layer/ai/provider/`) backed by the
`openai` SDK. Local dev runs Ollama (`qwen3:1.7b`, Apache-2.0) at
`http://localhost:11434/v1` for zero API cost; prod swaps to any hosted
OpenAI-compatible backend (OpenRouter / Groq / Together) purely by env —
they differ only by `{ baseURL, apiKey, model }` plus a per-backend
capability map.

```
getAiProvider()  ── reads env.AI_* ──▶  new OpenAiCompatibleProvider({backend,baseURL,apiKey,model})
                                              │
                  complete<T>({messages, schema?, tools?, stream?})  ──▶  openai SDK chat.completions
                  health()  ──▶  openai SDK models.list
```

Structured output: when a `schema` (Zod) is supplied and the backend
advertises `jsonSchema` support → `response_format: json_schema (strict)`,
parse + Zod-validate. **Validate/repair fallback:** if the backend rejects
json_schema OR the response fails validation → `response_format:
json_object` with the JSON Schema injected into the system prompt, one
repair re-prompt, then a typed `AiProviderError` if still invalid.

## Capability map (why)

| backend | jsonSchema | tools | streaming |
|---|---|---|---|
| ollama | **false** | true | true |
| openrouter | true | true | true |
| groq | true | true | true |
| together | true | true | true |
| openai-compatible | false | true | true |

`ollama.jsonSchema = false` is deliberate: the dev model (qwen3:1.7b) is
small and Ollama's json_schema support is version-dependent, so we force
the universally-reliable json_object + system-prompt-schema + Zod-validate
path. Hosted backends advertise true; the runtime fallback still recovers
on a model that rejects it. `openai-compatible` (unknown host) stays
conservative.

## Files

| file | role |
|---|---|
| `src/app-layer/ai/provider/types.ts` | `AiProvider` / message / tool / completion interfaces (no `any`) |
| `src/app-layer/ai/provider/openai-compatible-provider.ts` | the single impl + `CAPABILITIES` + `AiProviderError` |
| `src/app-layer/ai/provider/index.ts` | `getAiProvider()` factory + `inferBackend()` |
| `src/app-layer/ai/risk-assessment/openrouter-provider.ts` | rewired to a thin adapter over the new provider |
| `src/env.ts` | `AI_BACKEND` / `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` (+ reserved `AI_EMBED_MODEL`) with Ollama dev defaults |
| `docker-compose.yml` | added `ollama` dev service + named volume |

## Decisions

- **Zod 4, not Zod 3.** The spec named `zod-to-json-schema`, but this
  codebase is on Zod 4, where that v3-era package silently returns an
  empty schema. The conversion helper uses Zod 4's native
  `z.toJSONSchema()` as the accurate path and keeps `zod-to-json-schema`
  installed as the documented Zod-3 fallback (so the dep is real, clean,
  and used).
- **Risk-assessment rewire preserves the seam.** `OpenRouterRiskSuggestion-
  Provider` keeps its class name + `RiskSuggestionProvider` interface +
  knowledge-base fallback; internally it now calls
  `complete({ messages, schema })`. The factory + call site
  (`usecases/risk-suggestions.ts`, which mocks `getProvider`) and the stub
  + feature-gate selection are untouched. Same call site now runs on local
  Ollama OR OpenRouter via env.
- **`ws` HIGH advisory.** `openai` pulls `ws` (optional Realtime peer) as a
  transitive at `8.20.1` (HIGH). `npm audit fix` bumped it to `8.21.0`;
  prod audit (`--omit=dev --audit-level=moderate`) is clean. We do not use
  the Realtime API.
- **No `any`.** Interfaces use generics + `unknown`; the one Zod-3↔Zod-4
  type bridge to `zod-to-json-schema` is reached through an `unknown`-typed
  signature, never `as any`.
