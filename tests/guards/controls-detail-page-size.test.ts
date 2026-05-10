/**
 * Elevation PR-2 — controls/[controlId] page-size ratchet.
 *
 * The control detail page is the largest in the codebase and a
 * known velocity tax. Polish PR-2 began the decomposition by
 * extracting the Edit Control modal into `_modals/`. This ratchet
 * locks the line count at the current value so future PRs:
 *   - cannot ADD inline content to the page (forced to extract
 *     instead), AND
 *   - are encouraged to extract more (the FLOOR can drop monotonically
 *     as more sub-components are pulled out).
 *
 * To bump the floor down (good — page shrank): adjust MAX_LINES to
 * the new line count of the file in the same diff that does the
 * extraction. To bump the floor up (bad — page grew): the ratchet
 * fails CI and asks the author to extract or delete content
 * elsewhere instead.
 *
 * The eventual target is ≤ 300 lines (page coordinates, doesn't
 * implement). This is multi-PR work — track in
 * docs/implementation-notes/2026-05-09-controls-page-decomposition.md
 * (future).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const PAGE = 'src/app/t/[tenantSlug]/(app)/controls/[controlId]/page.tsx';

// Adjust DOWNWARD as the page shrinks. The single allowable upward
// nudge happens when a deliberate platform-wide primitive adoption
// lands here in the SAME PR (e.g. Elevation PR-1 adopted the shared
// MetaStrip primitive across all detail pages, +42 lines net here).
// Anything else MUST shrink the page or extract a sub-component
// instead.
//
// R8-PR2 raised by 20 (1430 → 1450) to accommodate the
// InlineEmptyState migration on four tab-body empty states (Tasks /
// Evidence / Frameworks / Activity). Each call expands from a
// one-line inline `<div className="p-8 text-center
// text-content-subtle text-sm">No X yet</div>` to a 4-line
// `<InlineEmptyState title=... description=...>` block. Visual
// uniformity gain is real; line cost is the trade.
const MAX_LINES = 1450;

describe('Controls detail page size ratchet (Elevation PR-2)', () => {
    it('controls/[controlId]/page.tsx stays at or below the size floor', () => {
        const abs = path.resolve(ROOT, PAGE);
        expect(fs.existsSync(abs)).toBe(true);
        const content = fs.readFileSync(abs, 'utf8');
        const lineCount = content.split('\n').length;
        if (lineCount > MAX_LINES) {
            throw new Error(
                `${PAGE} grew to ${lineCount} lines (floor: ${MAX_LINES}).\n\nThe page is the largest in the codebase and a known velocity tax. Don't add inline content — extract a tab body or a modal into a sub-component under \`_modals/\` or \`_tabs/\`, then update MAX_LINES in this ratchet to the new (lower) line count.\n\nDecomposition guide: docs/implementation-notes/.../controls-page-decomposition.md`,
            );
        }
        expect(lineCount).toBeLessThanOrEqual(MAX_LINES);
    });

    it('the _modals/ extraction directory exists', () => {
        // Sanity check — if the _modals directory disappears (e.g.
        // someone reverts the extraction), the ratchet should signal.
        const modalsDir = path.resolve(
            ROOT,
            'src/app/t/[tenantSlug]/(app)/controls/[controlId]/_modals',
        );
        expect(fs.existsSync(modalsDir)).toBe(true);
        const files = fs.readdirSync(modalsDir);
        expect(files.length).toBeGreaterThan(0);
    });
});
