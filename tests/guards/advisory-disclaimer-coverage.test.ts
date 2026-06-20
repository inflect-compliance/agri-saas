/**
 * Structural ratchet — advisory disclaimer coverage (feat/ai-evals-safety).
 *
 * The safety advisor MUST attach the disclaimer to EVERY result, on every
 * path (answer, refusal, escalation, no-sources). This guard locks that
 * invariant two ways:
 *
 *   1. The disclaimer constant is non-empty and mentions "agronomist".
 *   2. Every value the advisor returns is constructed via the single
 *      `makeResult(...)` helper (which stamps the disclaimer) — i.e. the
 *      advisor never builds an `AdvisoryResult` object literal that could
 *      omit the disclaimer. We assert this structurally: the source has
 *      no bare `return { ... }` AdvisoryResult literals, only
 *      `return makeResult({ ... })`.
 *   3. A behavioural smoke check: a refusal path result carries the
 *      disclaimer constant.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { makeRequestContext } from '../helpers/make-context';
import { ADVISORY_DISCLAIMER } from '@/app-layer/ai/safety/disclaimer';

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { askAgronomyAdvisor, type AdvisorDeps } from '@/app-layer/ai/safety/advisor';

const ADVISOR_SRC = join(
    __dirname,
    '..',
    '..',
    'src',
    'app-layer',
    'ai',
    'safety',
    'advisor.ts',
);

describe('advisory disclaimer ratchet', () => {
    it('the disclaimer constant is non-empty and names an agronomist', () => {
        expect(ADVISORY_DISCLAIMER.trim().length).toBeGreaterThan(0);
        expect(ADVISORY_DISCLAIMER.toLowerCase()).toContain('agronomist');
    });

    it('every advisor return goes through makeResult (no bare AdvisoryResult literals)', () => {
        const src = readFileSync(ADVISOR_SRC, 'utf8');
        // No AdvisoryResult-shaped object literal may be returned directly:
        // a result carries both `answer:` and `intent:` keys, and those must
        // only ever be assembled inside `makeResult({ ... })`. A bare
        // `return { answer: ..., intent: ... }` would bypass the disclaimer
        // stamp — ban it. (Other small helper literals like
        // `return { facts, citation }` are fine and don't match.)
        const resultShaped = /return\s*\{[^}]*\banswer:\s/.test(src);
        expect(resultShaped).toBe(false);
        // The helper must stamp the disclaimer.
        expect(src).toContain('disclaimer: ADVISORY_DISCLAIMER');
        // And every result is produced via makeResult(...).
        expect(src).toContain('return makeResult(');
    });

    it('behavioural: a refusal carries the disclaimer constant', async () => {
        const deps: AdvisorDeps = {
            async retrieve() {
                return [];
            },
            async getPesticideSafety() {
                return null;
            },
            async completeWithRouting() {
                return { text: '', parsed: undefined };
            },
            async audit() {
                /* no-op */
            },
        };
        const res = await askAgronomyAdvisor(
            makeRequestContext('ADMIN'),
            'What dose per hectare?',
            { productItemId: 'missing' },
            deps,
        );
        expect(res.refused).toBe(true);
        expect(res.disclaimer).toBe(ADVISORY_DISCLAIMER);
        expect(res.disclaimer.toLowerCase()).toContain('agronomist');
    });
});
