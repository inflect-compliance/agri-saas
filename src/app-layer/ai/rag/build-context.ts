/**
 * RAG context builder (feat/ai-rag).
 *
 * Turns the retrieved chunks into a system prompt that (1) lists them as
 * numbered, citable sources and (2) instructs the model to answer ONLY
 * from them, cite by number, and say "I don't have that in my sources"
 * when the answer is not supported. This is what makes the general model
 * behave like a grounded agricultural assistant — it answers from the
 * retrieved corpus, with citations, instead of free-associating.
 *
 * Mirrors the shape of `src/app-layer/ai/risk-assessment/prompt-builder.ts`
 * (a system-prompt assembler that returns a plain string).
 */
import type { RetrievedChunk } from './retrieve';

/** The exact refusal string the model is told to emit when unsupported. */
export const NO_SOURCES_ANSWER = "I don't have that in my sources.";

/**
 * Build the grounding system prompt from the retrieved chunks.
 *
 * Each chunk is rendered as `[n] (source) text`, so the model can cite
 * `[1]`, `[2]`, … The instruction block forces source-only answering +
 * citation + the explicit refusal phrase.
 */
export function buildContext(chunks: RetrievedChunk[], query: string): string {
    const parts: string[] = [
        'You are an agricultural knowledge assistant. Answer the user\'s ' +
            'question using ONLY the numbered sources below. Do not use any ' +
            'outside knowledge.',
        '',
        '## Rules',
        '- Answer ONLY from the sources. Never invent facts not in them.',
        '- Cite every claim with its source number in square brackets, e.g. [1] or [2][3].',
        `- If the sources do not contain the answer, reply EXACTLY: "${NO_SOURCES_ANSWER}"`,
        '- Be concise and practical. Prefer the most specific source.',
        '',
        '## Sources',
    ];

    if (chunks.length === 0) {
        parts.push('(no sources retrieved)');
    } else {
        chunks.forEach((chunk, i) => {
            const n = i + 1;
            // Collapse internal whitespace so a single source is one block.
            const text = chunk.text.replace(/\s+/g, ' ').trim();
            parts.push(`[${n}] (${chunk.source}) ${text}`);
        });
    }

    parts.push('');
    parts.push('## Question');
    parts.push(query.trim());

    return parts.join('\n');
}
