/**
 * R17-PR10 — NextBestActionCard urgency-tinted glow.
 *
 * The card carries one of five action ids — each represents a
 * different urgency tier. Pre-R17 the card was flat across all
 * states; the urgency information lived in the COPY only.
 * PR-10 adds a corner glow whose tone reflects the urgency tier,
 * so the eye registers "this is urgent" before reading the words.
 *
 * Mapping (urgency tier → token):
 *   • overdue-evidence / overdue-tasks → `--bg-error` (urgent)
 *   • high-risks                        → `--bg-warning` (attention)
 *   • low-coverage                      → `--bg-info` (informational)
 *   • readiness-check                   → `--brand-subtle` (calm)
 *
 * Five load-bearing invariants:
 *
 *   1. The card wrapper carries `relative isolate overflow-hidden`
 *      — required for the `before:` pseudo's `-z-10` to resolve
 *      against a local stacking context AND for the soft edge to
 *      stay clipped.
 *
 *   2. The `URGENCY_GLOW_BY_ID` map is typed as
 *      `Record<NextBestAction["id"], string>`. Adding a new action
 *      id without a glow entry breaks compilation — keeps the
 *      mapping inventory authoritative.
 *
 *   3. Each of the five known action ids has a `before:bg-
 *      [radial-gradient(...)]` entry. Drift on any one — say,
 *      replacing `--bg-error` with a hex literal — breaks the
 *      token-discipline guard and CI.
 *
 *   4. The glow gradient shape is consistent across all tiers
 *      (`circle 240px at 95% 5%`, `0% → 55%`). The ONLY thing
 *      that varies between urgency tiers is the colour token.
 *      Locked so a future "let me tweak just the overdue one"
 *      diff is forced to also tweak the others (or none).
 *
 *   5. The card exposes the contract DOM attribute
 *      `data-next-best-action-urgency-glow` so the rendered
 *      surface is targetable for E2E and future tooltips.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/NextBestActionCard.tsx'),
    'utf8',
);

describe('R17-PR10 — NextBestActionCard urgency glow', () => {
    it('card wrapper carries `relative isolate overflow-hidden`', () => {
        expect(SRC).toMatch(/"relative\s+isolate\s+overflow-hidden"/);
    });

    it('URGENCY_GLOW_BY_ID is typed as Record<NextBestAction["id"], string>', () => {
        expect(SRC).toMatch(
            /URGENCY_GLOW_BY_ID:\s*Record<NextBestAction\["id"\],\s*string>/,
        );
    });

    it('each of the five action ids has a token-backed gradient', () => {
        const ids = [
            'overdue-evidence',
            'overdue-tasks',
            'high-risks',
            'low-coverage',
            'readiness-check',
        ] as const;
        for (const id of ids) {
            // Each entry is `"<id>": "before:bg-[radial-gradient(...)]"`
            // — the gradient must reference a CSS variable, not a
            // hex literal (token discipline). The regex anchors to
            // the id key so a stray entry without the gradient
            // pattern is caught.
            const pattern = new RegExp(
                `["']${id}["']\\s*:\\s*["']before:bg-\\[radial-gradient\\([^\\]]*var\\(--[\\w-]+\\)`,
            );
            expect(SRC).toMatch(pattern);
        }
    });

    it('the gradient shape is consistent across urgency tiers (only colour varies)', () => {
        // The "circle 240px at 95% 5%" placement + the 0% → 55%
        // stops are shared. The colour token is what changes per
        // tier. A future diff that varies the shape per tier
        // would break this assertion (forcing the dev to either
        // align them or update the ratchet on purpose).
        const occurrences = SRC.match(
            /before:bg-\[radial-gradient\(circle_240px_at_95%_5%,\s*var\(--[\w-]+\)_0%,\s*transparent_55%\)\]/g,
        );
        expect(occurrences).not.toBeNull();
        expect(occurrences!.length).toBe(5);
    });

    it('exposes the `data-next-best-action-urgency-glow` attribute', () => {
        expect(SRC).toMatch(/data-next-best-action-urgency-glow/);
    });
});
