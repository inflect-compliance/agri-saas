/**
 * Codebase-hygiene capstone — the meta-ratchet.
 *
 * Roadmap-6 closed three codebase-hygiene gaps, each with a
 * structural guardrail:
 *
 *   1. `as any` debt — driven 174 → 4, held on a downward ratchet
 *      (binding baseline + per-pattern caps).
 *   2. Logging discipline — `console.*` banned in server code, with
 *      the dub-ported utility tree no longer blanket-exempt.
 *   3. Async route-handler `params` typing — every handler migrated
 *      to the Next 15 `Promise` contract; the transparent-await shim
 *      retired.
 *
 * Each shipped its own guardrail. THIS test guards the guards: it
 * fails CI if any one is deleted or gutted to a no-op, and it
 * asserts the codebase-hygiene doc survives with its load-bearing
 * pillar statements. A contributor who removes a hygiene guardrail
 * must reckon with a red meta-ratchet — the gap cannot silently
 * reopen.
 *
 * Sibling of `ci-pipeline-integrity.test.ts`,
 * `observability-reliability-integrity.test.ts`,
 * `verification-integrity.test.ts`, and
 * `dependency-governance-integrity.test.ts` — same "guard the
 * guards" pattern, the codebase-hygiene domain.
 *
 * See docs/codebase-hygiene.md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/**
 * The codebase-hygiene guardrail registry. Each must exist, still
 * contain its subject anchors (proof it was not gutted), and carry a
 * real assertion surface.
 */
const GUARDRAILS: ReadonlyArray<{
    file: string;
    pillar: string;
    anchors: string[];
}> = [
    {
        file: 'tests/guardrails/no-explicit-any-ratchet.test.ts',
        pillar: 'no `as any` growth — downward-ratcheted baseline',
        anchors: ['CURRENT_BASELINE', 'as any'],
    },
    {
        file: 'tests/guards/no-explicit-any-ratchet.test.ts',
        pillar: '`any`-pattern caps — `: any` / `<any>` / `as any` / `@ts-ignore`',
        anchors: ['CAPS', 'as any'],
    },
    {
        file: 'tests/guardrails/logging-import-hygiene.test.ts',
        pillar: 'logging discipline — no `console.*`, adapted code included',
        anchors: ['console', 'dub-utils'],
    },
    {
        file: 'tests/guards/async-params-route-typing.test.ts',
        pillar: 'async route-handler `params` typing',
        anchors: ['params', 'Promise'],
    },
];

/** Count `it(` / `it.each(` / `test(` / `test.each(` blocks. */
function itCount(src: string): number {
    return (src.match(/\b(?:it|test)(?:\.each)?\s*[(`]/g) ?? []).length;
}

describe('codebase-hygiene integrity — guard the guards', () => {
    describe.each(GUARDRAILS)('$pillar — $file', ({ file, anchors }) => {
        it('the guardrail file exists', () => {
            expect(exists(file)).toBe(true);
        });

        it('the guardrail still references its subject (not gutted)', () => {
            const src = read(file);
            for (const anchor of anchors) {
                expect(src).toContain(anchor);
            }
        });

        it('the guardrail carries a real assertion surface (>= 3 blocks)', () => {
            expect(itCount(read(file))).toBeGreaterThanOrEqual(3);
        });
    });

    it('the registry is complete (4 hygiene guardrails, distinct)', () => {
        expect(GUARDRAILS).toHaveLength(4);
        expect(new Set(GUARDRAILS.map((g) => g.file)).size).toBe(4);
    });

    it('the codebase-hygiene doc exists', () => {
        expect(exists('docs/codebase-hygiene.md')).toBe(true);
    });

    it('the doc states all three hygiene pillars', () => {
        // The load-bearing structure — if the doc is hollowed out,
        // this catches it.
        const doc = read('docs/codebase-hygiene.md');
        expect(doc).toMatch(/as any/i);
        expect(doc).toMatch(/downward ratchet/i);
        expect(doc).toMatch(/logging discipline/i);
        expect(doc).toMatch(/adapted/i);
        expect(doc).toMatch(/params/i);
        expect(doc).toMatch(/Promise/);
    });
});
