/**
 * Roadmap-13 PR-10 — Section divider as soft gradient.
 *
 * R12-PR3 shipped section dividers as a flat `border-t
 * border-border-subtle/40` — a hard 1px line at ~20% effective alpha.
 * Honest and quiet, but architectural; the line reads as a STAMPED
 * seam between sections.
 *
 * R13-PR10 evolves the divider to a `::before` pseudo-element
 * painted with a horizontal gradient:
 *
 *   linear-gradient(90deg, transparent, --border-subtle, transparent)
 *
 * The line fades in from transparent at each edge to
 * `--border-subtle` at center and back to transparent. The in-and-out
 * fade reads as BREATH between sections, not as a hard seam. The
 * sidebar inhales between Govern / Comply / Manage instead of
 * stamping a rule between them.
 *
 * Why a `::before` pseudo (not a `border-image: linear-gradient`)?
 *   - `border-image` works but loses the `:focus-visible` /
 *     `:hover` state targeting we may want later.
 *   - The `::before` overlay is a proper sub-element we can style
 *     freely — opacity, blur, even animation — without affecting
 *     the wrapper's box model.
 *
 * Why peak at `--border-subtle` (theme token)?
 *   - The token is already alpha-tuned per theme (METRO navy @ 50%,
 *     PwC warm gray @ 60%). The gradient fade at edges drops
 *     effective brightness to ~25-30% at peak — quieter than the
 *     R12 flat ~20%, but the in-and-out fade is what makes it feel
 *     like a sigh rather than a hard rule.
 *
 * Why absolute-positioned (`before:absolute before:top-0`)?
 *   - The line sits on the wrapper's exact top edge regardless of
 *     content. A `before:block before:h-px` flow-positioned
 *     approach would push content down by 1px on divided sections
 *     only, causing 1px alignment drift between first-section
 *     (undivided) and later sections (divided).
 *
 * R12-PR3 invariants preserved:
 *   - `isFirst` suppresses the divider.
 *   - Section header recipe (10px, tracking-0.12em, etc.) unchanged.
 *   - JSX shape (`<div>` wrapper with conditional divider class).
 *
 * The R12-PR3 ratchet's "divider recipe" assertion is updated in
 * the same diff to accept either the R12 (`border-t`) or R13
 * (`::before` gradient) form; a future regression that drops both
 * is caught.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SECTION_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-section.tsx'),
    'utf8',
);

function dividerRecipe(): string {
    return (
        SECTION_SRC.match(
            /export\s+const\s+NAV_SECTION_DIVIDER\s*=\s*['"]([^'"]+)['"]/,
        )?.[1] ?? ''
    );
}

describe('Roadmap-13 PR-10 — section divider as soft gradient', () => {
    describe('divider uses a ::before pseudo-element', () => {
        it('declares before:absolute pinned to top edge', () => {
            // The divider line is a positioned overlay on the
            // section wrapper's top edge. Anchored at top-0 so it
            // sits exactly on the boundary between sections.
            const recipe = dividerRecipe();
            expect(recipe).toMatch(/before:absolute/);
            expect(recipe).toMatch(/before:top-0/);
        });

        it('spans full width via left-0 + right-0', () => {
            // Both edges anchored — the gradient fades in/out
            // SYMMETRICALLY across the row's width. Anchoring just
            // one edge would skew the visual breath.
            const recipe = dividerRecipe();
            expect(recipe).toMatch(/before:left-0/);
            expect(recipe).toMatch(/before:right-0/);
        });

        it('is exactly 1 CSS pixel tall', () => {
            // R12-PR3's `border-t` rendered as 1px. R13-PR10
            // preserves the line weight — only the shape changes
            // from flat to faded.
            const recipe = dividerRecipe();
            expect(recipe).toMatch(/before:h-px/);
        });
    });

    describe('gradient paints from transparent → --border-subtle → transparent', () => {
        it('uses linear-gradient(90deg, ...) as the background image', () => {
            // 90deg = horizontal gradient (left → right). Vertical
            // (180deg / to-b) would fade top-to-bottom on a 1px
            // tall element — visually impossible to read.
            const recipe = dividerRecipe();
            expect(recipe).toMatch(
                /before:bg-\[linear-gradient\(90deg,/,
            );
        });

        it('peaks at var(--border-subtle) (theme-aware)', () => {
            // The token is alpha-tuned per theme (METRO @ 50%, PwC
            // @ 60%). Hardcoding the rgba here would break theme
            // parity.
            const recipe = dividerRecipe();
            expect(recipe).toMatch(/var\(--border-subtle\)/);
        });

        it('fades from transparent on both ends', () => {
            // The IN-AND-OUT fade is what makes the line read as
            // "breath" rather than "rule". A `linear-gradient(90deg,
            // var(--border-subtle), transparent)` would only fade
            // on one end — feels off-balance.
            const recipe = dividerRecipe();
            // Both `transparent` tokens must appear in the gradient.
            const transparents =
                recipe.match(/transparent/g)?.length ?? 0;
            expect(transparents).toBeGreaterThanOrEqual(2);
        });
    });

    describe('section wrapper still anchors the absolute ::before', () => {
        it('the divider recipe sets `relative` on the wrapper', () => {
            // Without `relative` on the parent, `before:absolute`
            // escapes to the nearest positioned ancestor — the
            // line would land somewhere else in the layout.
            const recipe = dividerRecipe();
            expect(recipe).toMatch(/\brelative\b/);
        });
    });

    describe('preserved R12-PR3 invariants', () => {
        it('still spaced 8px from previous content (mt-2 pt-2)', () => {
            // The breathing-room around the divider stays. The
            // R12 spacing rhythm reads as "section break" — drop
            // it and sections feel crammed together.
            const recipe = dividerRecipe();
            expect(recipe).toMatch(/\bmt-2\b/);
            expect(recipe).toMatch(/\bpt-2\b/);
        });

        it('isFirst still suppresses the divider', () => {
            // The conditional that prevents a divider above the
            // first section is preserved verbatim — R13-PR10 only
            // changes the divider's RECIPE, not the gate that
            // applies it.
            expect(SECTION_SRC).toMatch(
                /!isFirst\s*&&\s*title\s*&&\s*NAV_SECTION_DIVIDER/,
            );
        });
    });

    describe('the retired R12-PR3 border-t recipe is gone', () => {
        it('NAV_SECTION_DIVIDER does NOT carry both forms', () => {
            // Either-or: the recipe is the gradient OR the border.
            // Both at once would render TWO lines (the border and
            // the ::before gradient layered) — a regression we
            // catch here.
            const recipe = dividerRecipe();
            const hasBorder = /\bborder-t\b/.test(recipe);
            const hasGradient =
                /before:bg-\[linear-gradient\(/.test(recipe);
            expect(hasBorder && hasGradient).toBe(false);
        });
    });
});
