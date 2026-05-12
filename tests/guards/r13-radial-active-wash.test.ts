/**
 * Roadmap-13 PR-11 — Radial brand wash on the active row.
 *
 * R12-PR6 shipped the active row's background as a uniform
 * `bg-[var(--brand-subtle)]` — a warm-primary tinted wash sitting
 * evenly across the row. Honest, but flat: the row reads as "a
 * coloured rectangle" rather than "a row LIT by the band".
 *
 * R13-PR11 evolves the wash to a RADIAL gradient that originates
 * at the row's left edge (where the band lives) and fades to
 * transparent at the right:
 *
 *   bg-[radial-gradient(circle_at_left,
 *                       var(--brand-secondary-subtle),
 *                       transparent 75%)]
 *
 * The navy radial bleeds out from the band — feels like the band
 * is leaking light into the row, fading toward the right edge. The
 * eye reads this as "lit object on a surface", which is the
 * physical metaphor every premium nav design converges on.
 *
 * Two consequential changes from R12-PR6:
 *
 *   1. SHAPE: uniform → radial-from-left.
 *   2. HUE FAMILY: warm primary (--brand-subtle) → cool secondary
 *      (--brand-secondary-subtle). The wash now matches the band's
 *      hue family. The warm/cool contrast is preserved by R13-PR5's
 *      brand-coloured label (text-[var(--brand-default)] — warm
 *      yellow/orange), so the row still has the temperature
 *      duality the eye reads as "object on surface".
 *
 * The R12-PR6 ratchet's bg-wash assertion is updated in the same
 * diff to accept either form (the R12 uniform `bg-[var(--brand-
 * subtle)]` OR the R13 radial gradient). A future regression that
 * drops both leaves no wash at all — still caught.
 *
 * What this ratchet does NOT police:
 *
 *   - The exact fade stop (75%). Tuning is allowed within the
 *     "fades to transparent at the right edge" intent.
 *   - The hue family. A future PR that wants to swap back to
 *     warm primary for some other reason would need to update
 *     this ratchet AND argue against the cool/warm-cool design
 *     reasoning in the doc-comment.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAV_ITEM_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);

function activeRecipe(): string {
    return (
        NAV_ITEM_SRC.match(
            /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
        )?.[1] ?? ''
    );
}

describe('Roadmap-13 PR-11 — radial brand wash on the active row', () => {
    describe('the wash is a radial-gradient (not uniform)', () => {
        it('NAV_ITEM_ACTIVE uses bg-[radial-gradient(...)]', () => {
            // The shape change is what makes the row read as LIT
            // rather than coloured. A regression to flat
            // `bg-[var(--brand-subtle)]` loses the radial light.
            expect(activeRecipe()).toMatch(/bg-\[radial-gradient\(/);
        });

        it('the gradient originates at the LEFT edge', () => {
            // The band lives on the left. Anchoring the gradient
            // there is what produces the "band leaking light" effect.
            // `circle at left` is the canonical CSS form — Tailwind
            // arbitrary value uses underscores in place of spaces.
            expect(activeRecipe()).toMatch(
                /radial-gradient\(circle_at_left,/,
            );
        });

        it('peaks at --brand-secondary-subtle (cool hue family)', () => {
            // R13-PR11's hue choice. Warm/cool contrast preserved
            // via the brand-coloured label (PR-5).
            expect(activeRecipe()).toMatch(
                /var\(--brand-secondary-subtle\)/,
            );
        });

        it('fades to transparent at the right side', () => {
            // The right edge MUST end at transparent — that's
            // what makes the gradient feel like light fading off
            // into nothing rather than ending in a hard band.
            // Tailwind arbitrary values use `_` as the space
            // separator; `,_transparent` is the canonical form.
            // (Can't use `[^)]+` to scan inside the parens because
            // the gradient body contains nested `var(...)` calls.)
            // No \b after `transparent` — Tailwind's arbitrary-
            // value space-encoding (`_`) is a word char, so there's
            // no word boundary between `transparent` and the
            // following `_75%`. Match the literal substring instead.
            expect(activeRecipe()).toMatch(
                /bg-\[radial-gradient\([\s\S]*?,_transparent/,
            );
        });
    });

    describe('the old uniform wash is retired', () => {
        it('NAV_ITEM_ACTIVE does NOT carry both the radial AND uniform forms', () => {
            // Either-or. Both would render two backgrounds
            // (gradient + flat) layered.
            const recipe = activeRecipe();
            const hasUniform =
                /\bbg-\[var\(--brand-subtle\)\]/.test(recipe);
            const hasRadial = /bg-\[radial-gradient\(/.test(recipe);
            expect(hasUniform && hasRadial).toBe(false);
        });
    });

    describe('preserved R12-PR6 + R13 invariants', () => {
        it('still carries brand-default text colour', () => {
            // R13-PR5's brand-coloured label preserved.
            expect(activeRecipe()).toMatch(
                /\btext-\[var\(--brand-default\)\]/,
            );
        });

        it('still carries the band overrides + glow', () => {
            // R13-PR4's band-to-navy is preserved verbatim — the
            // radial wash + the navy band are coordinated.
            const recipe = activeRecipe();
            expect(recipe).toMatch(
                /before:from-\[var\(--brand-secondary-default\)\]!/,
            );
            expect(recipe).toMatch(
                /before:shadow-\[var\(--nav-band-glow-active\)\]!/,
            );
        });

        it('still carries font-medium and opacity-100 band', () => {
            const recipe = activeRecipe();
            expect(recipe).toMatch(/\bfont-medium\b/);
            expect(recipe).toMatch(/(?<!hover:)\bbefore:opacity-100\b/);
        });
    });
});
