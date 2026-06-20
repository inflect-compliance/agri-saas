/**
 * Untrusted-content sanitiser for the advisory prompt (feat/ai-evals-safety).
 *
 * Retrieved RAG chunks AND tenant free-text are UNTRUSTED — they can carry
 * prompt-injection ("ignore previous instructions", a forged "system:"
 * line, role-spoofing). The PRIMARY defences are elsewhere (delimiting the
 * untrusted block in the prompt, Zod-validating the model output, and the
 * fact that dosage numbers come from structured data not free text). This
 * is a belt-and-suspenders pre-filter that neutralises the most obvious
 * injection markers BEFORE they enter the prompt so they can't even be
 * read as instructions.
 *
 * It NEVER eval/exec's anything and never follows the content — it only
 * rewrites known injection-shaped lines into an inert, labelled form.
 */

/** Patterns that look like an attempt to override the system instructions. */
const INJECTION_LINE_PATTERNS: RegExp[] = [
    /\bignore (?:all )?(?:the )?(?:previous|prior|above|preceding) (?:instructions?|prompts?|rules?)\b/i,
    /\bdisregard (?:all )?(?:the )?(?:previous|prior|above) (?:instructions?|rules?)\b/i,
    /\bforget (?:everything|all) (?:above|before|previous)\b/i,
    /\boverride (?:the )?(?:system|previous) (?:prompt|instructions?)\b/i,
    /\byou are now\b/i,
    /\bnew instructions?:\b/i,
];

/** Role-spoofing prefixes at the start of a line (e.g. "system:", "assistant:"). */
const ROLE_SPOOF_PREFIX = /^\s*(system|assistant|developer|tool)\s*:/i;

/**
 * Replacement marker for a neutralised line — visible to the model as
 * data, never as an instruction.
 */
const NEUTRALISED = '[removed: untrusted directive]';

/**
 * Sanitise a single untrusted text blob. Strips/escapes obvious injection
 * markers line-by-line; leaves ordinary agronomic content untouched.
 */
export function sanitizeUntrusted(text: string): string {
    if (!text) return '';
    return text
        .split(/\r?\n/)
        .map((line) => {
            if (INJECTION_LINE_PATTERNS.some((p) => p.test(line))) return NEUTRALISED;
            if (ROLE_SPOOF_PREFIX.test(line)) {
                // Defang the role prefix so it reads as plain text.
                return line.replace(ROLE_SPOOF_PREFIX, '[role] ');
            }
            return line;
        })
        .join('\n');
}
