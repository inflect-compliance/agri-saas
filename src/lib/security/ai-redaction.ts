/**
 * PII redaction for EXTERNAL AI calls (feat/ai-guardrails).
 *
 * Before any prompt leaves the box to a HOSTED model (claude / openrouter
 * / groq / together / openai-compatible), this module replaces detected
 * PII with stable, reversible placeholders and returns a rehydration map.
 * After the model responds, `rehydrate()` restores the real values in the
 * RESPONSE so the user sees their own data back — the placeholder round-trip
 * is invisible to the caller.
 *
 * LOCAL backends (ollama) keep data on the box, so callers skip redaction
 * entirely (`completeWithRouting` only redacts when the resolved backend
 * is external).
 *
 * Detected categories:
 *   • emails            → [EMAIL_n]
 *   • phone numbers     → [PHONE_n]
 *   • lat/long pairs    → [COORD_n]   (precise field coordinates)
 *   • caller-supplied   → [TERM_n]    (contract terms / identifiers via
 *     sensitive spans      opts.sensitiveTerms — longest-first so nested
 *                          terms don't partially match)
 *
 * Placeholders are STABLE within a single call: the same value always maps
 * to the same placeholder, so the model can reason about "the same person"
 * across turns. The map is per-call (not persisted) — it lives only for the
 * duration of one completion.
 *
 * Determinism: redaction is pure + side-effect-free. The same input +
 * sensitiveTerms produces the same output + map.
 */
import type { AiMessage } from '@/app-layer/ai/provider/types';

/** Reverse lookup: placeholder → original value. */
export type RedactionMap = Record<string, string>;

export interface RedactOptions {
    /**
     * Extra exact spans to redact (e.g. contract numbers, party names the
     * caller knows are sensitive). Matched literally, longest-first.
     */
    sensitiveTerms?: string[];
}

export interface RedactResult {
    messages: AiMessage[];
    map: RedactionMap;
}

// ─── Detectors ───────────────────────────────────────────────────

// Email — conservative RFC-ish; good enough for redaction (false
// positives are harmless — they just get a placeholder).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Phone — international + grouped forms. Requires at least 7 digits so a
// short number / year is not mistaken for a phone.
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g;

// Coordinate pair — "lat, long" with decimals, e.g. "12.9716, 77.5946".
// Both components decimal so plain integer pairs are not caught.
const COORD_RE = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g;

/**
 * A redactor accumulates value→placeholder mappings across all messages
 * in one call so the same value reuses one placeholder.
 */
class Redactor {
    readonly map: RedactionMap = {};
    private readonly seen = new Map<string, string>();
    private counters: Record<string, number> = {};

    /** Allocate (or reuse) a placeholder for `value` under `prefix`. */
    private placeholder(prefix: string, value: string): string {
        const existing = this.seen.get(value);
        if (existing) return existing;
        const n = (this.counters[prefix] ?? 0) + 1;
        this.counters[prefix] = n;
        const token = `[${prefix}_${n}]`;
        this.seen.set(value, token);
        this.map[token] = value;
        return token;
    }

    /** Redact one string: caller terms first, then coords, phones, emails. */
    redact(text: string, sensitiveTerms: string[]): string {
        let out = text;
        // Caller terms — longest first so "Acme Holdings Ltd" wins over "Acme".
        for (const term of [...sensitiveTerms].sort((a, b) => b.length - a.length)) {
            if (!term) continue;
            if (out.includes(term)) {
                out = out.split(term).join(this.placeholder('TERM', term));
            }
        }
        // Order matters: coords before phones (a coord pair contains
        // digit runs a phone matcher could grab); emails last.
        out = out.replace(COORD_RE, (m) => this.placeholder('COORD', m));
        out = out.replace(EMAIL_RE, (m) => this.placeholder('EMAIL', m));
        out = out.replace(PHONE_RE, (m) => this.placeholder('PHONE', m.trim()));
        return out;
    }
}

/**
 * Redact PII from a message array for an external call. Returns the
 * redacted messages + a rehydration map. The map is empty when nothing
 * was detected — callers use that to decide "prefer local" routing.
 */
export function redactForExternal(messages: AiMessage[], opts?: RedactOptions): RedactResult {
    const redactor = new Redactor();
    const terms = opts?.sensitiveTerms ?? [];
    const redacted = messages.map((m): AiMessage => ({
        ...m,
        content: redactor.redact(m.content, terms),
    }));
    return { messages: redacted, map: redactor.map };
}

/**
 * Restore placeholders in `text` back to their original values using the
 * map produced by `redactForExternal`. Safe to call with an empty map (a
 * no-op). Used on the model's response text/parsed-JSON string.
 */
export function rehydrate(text: string, map: RedactionMap): string {
    if (!text) return text;
    let out = text;
    for (const [token, value] of Object.entries(map)) {
        if (out.includes(token)) {
            out = out.split(token).join(value);
        }
    }
    return out;
}

/** Whether a backend is EXTERNAL (data leaves the box) vs LOCAL. */
export function isExternalBackend(backend: string): boolean {
    return backend !== 'ollama';
}
