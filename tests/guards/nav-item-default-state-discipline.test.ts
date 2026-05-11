/**
 * Roadmap-12 PR-4 — NavItem default-state vocabulary.
 *
 * The default state for a nav row sets the tone for the rest of
 * the sidebar. Three invariants matter:
 *
 *   1. Default text colour is `text-content-muted` — humble,
 *      ready, quiet. Not emphasis (which is the active state)
 *      and not subtle (which is the section-header recipe).
 *
 *   2. Hover lifts the text to `text-content-emphasis`. One rung
 *      brighter, driven by `transition-colors duration-150
 *      ease-out` in `NAV_ITEM_BASE` — never a hard step, never a
 *      transform.
 *
 *   3. Hover background is SOLID `bg-bg-muted` — no alpha. The
 *      pre-R12-PR4 `/50` alpha blended with whatever was behind
 *      and read as un-decided. Solid is what premium dense-nav
 *      surfaces use (Linear, Notion, Vercel).
 *
 * What this ratchet does NOT police
 *
 *   - The exact shade of `bg-bg-muted` — that's a token-system
 *     decision shared with the rest of the product.
 *   - Motion duration / easing — those live in `NAV_ITEM_BASE`
 *     and are covered by R12-PR2's geometry ratchet and the
 *     motion-language ratchet.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);

describe('Roadmap-12 PR-4/5 — NavItem default-state discipline', () => {
    it('exports `NAV_ITEM_DEFAULT` with the locked recipe', () => {
        // R12-PR5 retired the full-row `hover:bg-bg-muted` and
        // replaced it with a left-edge brand-gradient band on a
        // `::before` pseudo-element. The default recipe now drives
        // two things on hover: text brightens AND band fades in.
        const match = SRC.match(
            /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
        );
        expect(match).not.toBeNull();
        const recipe = match![1];
        // Default text colour.
        expect(recipe).toMatch(/\btext-content-muted\b/);
        // Hover text colour — one rung up.
        expect(recipe).toMatch(/\bhover:text-content-emphasis\b/);
        // Hover band — opacity 0 → 100 on the `::before` element.
        expect(recipe).toMatch(/\bhover:before:opacity-100\b/);
    });

    it('hover has NO full-row background (the band replaces it — R12-PR5)', () => {
        // The whole point of R12-PR5 is to retire the full-row
        // hover bg. Any reappearance of `hover:bg-bg-*` in the
        // default recipe regresses the "band, not row" UX.
        const match = SRC.match(
            /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
        );
        expect(match).not.toBeNull();
        const recipe = match![1];
        expect(recipe).not.toMatch(/\bhover:bg-bg-/);
    });

    it('default-state recipe has no transform / scale / translate', () => {
        // Motion language for nav rows is colour-only. If a future
        // PR reaches for `hover:scale-[1.01]` or
        // `hover:-translate-y-px` here, the sidebar starts
        // feeling like 2014 UI chrome. The motion-language ratchet
        // covers this product-wide, but locking it at the
        // primitive level too catches the regression earlier.
        const match = SRC.match(
            /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
        );
        expect(match).not.toBeNull();
        const recipe = match![1];
        expect(recipe).not.toMatch(/\b(?:hover|group-hover):(?:scale|translate|-translate)\b/);
    });

    it('the `<NavItem>` JSX consumes `NAV_ITEM_DEFAULT` (not parallel-hardcoded)', () => {
        // The default branch of the active-state ternary references
        // the const. A future regression where someone hand-rolls
        // a className that bypasses `NAV_ITEM_DEFAULT` (e.g. an
        // experiment shortcut) would un-link the ratchet from the
        // runtime — catch it.
        expect(SRC).toMatch(
            /active\s*\?\s*NAV_ITEM_ACTIVE\s*:\s*NAV_ITEM_DEFAULT/,
        );
    });
});
