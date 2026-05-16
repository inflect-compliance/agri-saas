/**
 * R19-PR-D — carbon interaction states + the Roadmap-19 capstone.
 *
 * R19-PR-A/B/C built the liquid-carbon SURFACE — tokens, the
 * `glassSurface` recipe (solid fills), the `glassOnHover` recipe
 * (transparent fills), the micro-grain layer. PR-D closes the
 * roadmap by making the three INTERACTION states read as the same
 * material, and locks the whole R19 system as a capstone.
 *
 * PR-D ships ONE recipe — `carbonStates` — that drives pressed /
 * focus / disabled through a single channel: the `::before`
 * depth-overlay's opacity. It sits in the cva BASE so every
 * variant inherits the identical state material.
 *
 * Part 1 — PR-D invariants (7):
 *
 *   1. A module-level `carbonStates` recipe const exists.
 *   2. `carbonStates` is spread into the cva BASE — not a variant.
 *      The interaction-state material is variant-agnostic.
 *   3. pressed: `active:before:opacity-70` — the light pool dims.
 *   4. focus: `focus-visible:before:opacity-100` — the carbon is
 *      revealed for keyboard users (parity with the hover lift).
 *   5. disabled: `disabled:before:opacity-0` — the carbon goes
 *      inert (flat dead material, not dimmed liquid).
 *   6. `carbonStates` carries `before:transition-opacity` +
 *      `motion-reduce:before:transition-none` — the state changes
 *      ride a smooth fade, dropped under reduced-motion.
 *   7. PR-D is ADDITIVE: the cva base still carries the R11-PR4
 *      press GEOMETRY (`active:scale-[0.97]`) and the a11y focus
 *      RING. carbonStates is the material layer — it does not
 *      replace the geometry or the ring.
 *
 * Part 2 — R19 capstone (the full system is whole):
 *
 *   8. All four `--btn-carbon-*` tokens are defined in tokens.css.
 *   9. Both surface recipes exist (`glassSurface`,
 *      `glassOnHover`).
 *  10. Every one of the five variants is carboned — the three
 *      solid fills via `...glassSurface`, the two transparent
 *      fills via `...glassOnHover`. No variant is left flat.
 *  11. The liquid-carbon system is documented in
 *      `docs/ui-buttons.md`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const TOKENS = fs.readFileSync(
    path.join(ROOT, 'src/styles/tokens.css'),
    'utf8',
);
const VARIANTS = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/button-variants.ts'),
    'utf8',
);
const UI_BUTTONS_DOC = fs.readFileSync(
    path.join(ROOT, 'docs/ui-buttons.md'),
    'utf8',
);

/** Slice a single variant's class array out of the cva config. */
function variantBlock(name: string): string {
    const re = new RegExp(`["']?${name}["']?:\\s*\\[([\\s\\S]*?)\\],`);
    return VARIANTS.match(re)?.[1] ?? '';
}

/** Slice a named module-level recipe const's array body. */
function recipeBlock(name: string): string {
    const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
    return VARIANTS.match(re)?.[1] ?? '';
}

/** The cva BASE array — cva's first argument. */
function cvaBase(): string {
    return VARIANTS.match(/cva\(\s*\[([\s\S]*?)\]\s*,/)?.[1] ?? '';
}

describe('R19-PR-D — carbon interaction states', () => {
    it('a module-level `carbonStates` recipe const exists', () => {
        expect(VARIANTS).toMatch(/const\s+carbonStates\s*=\s*\[/);
    });

    it('`carbonStates` is spread into the cva BASE, not a variant', () => {
        // The interaction-state material is variant-agnostic — it
        // belongs in the base so every variant inherits it.
        expect(cvaBase()).toMatch(/\.\.\.carbonStates/);
        // And NOT spread into any individual variant block.
        for (const v of [
            'primary',
            'secondary',
            'ghost',
            'destructive',
            'destructive-outline',
        ]) {
            expect(variantBlock(v)).not.toMatch(/\.\.\.carbonStates/);
        }
    });

    describe('the three interaction states ride the ::before opacity channel', () => {
        it('pressed — `active:before:opacity-70` dims the light pool', () => {
            expect(recipeBlock('carbonStates')).toMatch(
                /active:before:opacity-70/,
            );
        });

        it('focus — `focus-visible:before:opacity-100` reveals the carbon for keyboard users', () => {
            expect(recipeBlock('carbonStates')).toMatch(
                /focus-visible:before:opacity-100/,
            );
        });

        it('disabled — `disabled:before:opacity-0` makes the carbon inert', () => {
            expect(recipeBlock('carbonStates')).toMatch(
                /disabled:before:opacity-0/,
            );
        });
    });

    it('`carbonStates` carries the smooth fade + the reduced-motion drop', () => {
        const recipe = recipeBlock('carbonStates');
        expect(recipe).toMatch(/before:transition-opacity/);
        expect(recipe).toMatch(/motion-reduce:before:transition-none/);
    });

    it('PR-D is additive — the press GEOMETRY and a focus-visible indicator survive in the base', () => {
        const base = cvaBase();
        // R11-PR4 press-down geometry — carbonStates adds the
        // MATERIAL response (the pool dims), it does not replace
        // the scale.
        expect(base).toMatch(/active:scale-\[0\.97\]/);
        expect(base).toMatch(/motion-reduce:active:scale-100/);
        // The focus indicator — R22-PR-B upgraded from Tailwind
        // `ring-2 ring-offset-2 ring-ring` (default-feel) to the
        // brand-tinted box-shadow halo via
        // `focus-visible:shadow-[var(--ctrl-edge-focus)]`. Carbon
        // is still depth — the halo IS the visible focus signal.
        expect(base).toMatch(/focus-visible:outline-none/);
        expect(base).toMatch(/focus-visible:shadow-\[var\(--ctrl-edge-focus\)\]/);
    });
});

describe('R19 capstone — the liquid-carbon system is whole', () => {
    it('all four --btn-carbon-* tokens are defined in tokens.css', () => {
        for (const token of [
            '--btn-carbon-overlay',
            '--btn-glass-inner',
            '--btn-glass-edge',
            '--btn-carbon-grain',
        ]) {
            expect(TOKENS).toMatch(new RegExp(`${token}:`));
        }
    });

    it('both surface recipes exist (`glassSurface` + `glassOnHover`)', () => {
        expect(VARIANTS).toMatch(/const\s+glassSurface\s*=\s*\[/);
        expect(VARIANTS).toMatch(/const\s+glassOnHover\s*=\s*\[/);
    });

    it('every variant is carboned — solid fills via glassSurface, transparent via glassOnHover', () => {
        // The three solid-background variants pool light at rest.
        for (const v of ['primary', 'secondary', 'destructive']) {
            expect(variantBlock(v)).toMatch(/\.\.\.glassSurface/);
            expect(variantBlock(v)).not.toMatch(/\.\.\.glassOnHover/);
        }
        // The two transparent variants gain carbon on hover/focus.
        for (const v of ['ghost', 'destructive-outline']) {
            expect(variantBlock(v)).toMatch(/\.\.\.glassOnHover/);
            expect(variantBlock(v)).not.toMatch(/\.\.\.glassSurface/);
        }
    });

    it('the liquid-carbon system is documented in docs/ui-buttons.md', () => {
        // The capstone doc section — a future contributor must be
        // able to find the carbon system from the buttons guide.
        expect(UI_BUTTONS_DOC).toMatch(/liquid.carbon/i);
        expect(UI_BUTTONS_DOC).toMatch(/(?:carbon|glass)Surface/);
        expect(UI_BUTTONS_DOC).toMatch(/(?:carbon|glass)OnHover/);
        expect(UI_BUTTONS_DOC).toMatch(/carbonStates/);
    });
});
