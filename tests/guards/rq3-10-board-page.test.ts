/**
 * RQ3-10 — Risk Board page ratchet.
 *
 * Regression classes guarded:
 *
 *   - the page sprouting a parallel orchestrator endpoint (the
 *     board MUST consume the existing /risks/dashboard payload —
 *     two sources of truth would drift);
 *   - the page losing its honest-null empty-state copy (a board
 *     pack with a fabricated 0 is the danger this PR exists to
 *     prevent);
 *   - the page losing one of the five sections (the contract is
 *     position / appetite / contributors / efficiency / hygiene);
 *   - the best-value list growing past 3 (the board view is a
 *     leaderboard, the dashboard list is the longer one).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const page = read('src/app/t/[tenantSlug]/(app)/risks/board/page.tsx');

describe('RQ3-10 — the board page reuses RQ3-9 + RQ3-8 endpoints', () => {
    test('consumes the orchestrator (no new server endpoint for the same data)', () => {
        expect(page).toMatch(/useTenantSWR<DashboardPayload>\(['"]\/risks\/dashboard['"]\)/);
    });

    test('reads the best-value leaderboard from /controls/best-value with limit=3', () => {
        expect(page).toMatch(/['"]\/controls\/best-value\?limit=3['"]/);
    });
});

describe('RQ3-10 — five sections, no fewer', () => {
    test.each([
        'board-position-card',
        'board-appetite-card',
        'board-top-risks-card',
        'board-best-value-card',
        'board-hygiene-card',
    ])('mounts the %s section', (testid) => {
        expect(page).toMatch(new RegExp(`data-testid="${testid}"`));
    });
});

describe('RQ3-10 — every section carries an honest-null empty state', () => {
    // Empty-state copy now routes through next-intl (Bulgarian sweep); the
    // honest-null invariant is preserved via the en.json riskManager values.
    test.each([
        ['Position', 'board-position-empty', 'boardPositionEmpty', /Not quantified yet/],
        ['Appetite', 'board-appetite-empty', 'boardAppetiteEmpty', /Set a portfolio loss ceiling/],
        ['Top contributors', 'board-top-risks-empty', 'boardTopRisksEmpty', /No quantified risks yet/],
        ['Best-value', 'board-best-value-empty', 'boardBestValueEmpty', /No control yet carries a price/],
    ])('%s has a typed empty-state nudge', (_section, testid, key, copy) => {
        expect(page).toMatch(new RegExp(`data-testid="${testid}"`));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        expect(require('../../messages/en.json').riskManager[key as string]).toMatch(copy);
    });

    test('Position never fabricates a zero — the ALE figure is gated on a non-null headline', () => {
        expect(page).toMatch(/headlineAle !== null \? \(/);
    });
});

describe('RQ3-10 — board scale (leaderboard, not register)', () => {
    test('top contributors capped at 5', () => {
        expect(page).toMatch(/\.slice\(0, 5\)/);
    });
});
