/**
 * R24-PR-B — Liquid-glass primitive redesign ratchet.
 *
 * Locks four invariants:
 *   1. The glass recipe seams exist: `glassSurface` for solid fills,
 *      `glassOnHover` for transparent variants.
 *   2. Every variant references one of the two glass recipes —
 *      `carbonSurface` / `carbonOnHover` are GONE from variants.
 *   3. The cva file no longer references `--btn-carbon-*` tokens
 *      anywhere (the R24 material swap is complete).
 *   4. R20-PR-B's iridescent / aura layer + R19's `carbonStates`
 *      interaction-state layer SURVIVE the swap (they're
 *      material-agnostic and shouldn't be casualties of the rename).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const VARIANTS_PATH = path.resolve(
    __dirname,
    '../../src/components/ui/button-variants.ts',
);

const SRC = fs.readFileSync(VARIANTS_PATH, 'utf8');

describe('R24-PR-B — Liquid-glass primitive redesign', () => {
    describe('New glass recipes exist', () => {
        it('declares `glassSurface` for solid-fill variants', () => {
            expect(SRC).toMatch(/const\s+glassSurface\s*=\s*\[/);
        });

        it('declares `glassOnHover` for transparent variants', () => {
            expect(SRC).toMatch(/const\s+glassOnHover\s*=\s*\[/);
        });

        it('glassSurface consumes the R24-PR-A token suite', () => {
            // The recipe must reference the canonical glass tokens
            // (not just any --btn-* token). A future "simplify"
            // pass that drops the token references and hard-codes
            // the gradient would break the light/dark parity story.
            //
            // Slice to the glassSurface array literal to scope the
            // assertion.
            const start = SRC.indexOf('const glassSurface = [');
            const end = SRC.indexOf('];', start);
            expect(start).toBeGreaterThan(-1);
            const block = SRC.slice(start, end);
            expect(block).toContain('--btn-glass-tint');
            expect(block).toContain('--btn-glass-blur');
            expect(block).toContain('--btn-glass-inner');
            expect(block).toContain('--btn-glass-shadow');
        });
    });

    describe('Variants migrated off carbon onto glass', () => {
        it('every variant spread is `glassSurface` or `glassOnHover` (no carbon spreads)', () => {
            // Variant array literals spread one of the two recipes.
            // Carbon spreads inside variants would mean the swap
            // is half-done; fail CI.
            //
            // Scope to the variants block: from the `variant:` key
            // opening to its closing brace.
            const variantsStart = SRC.indexOf('variant: {');
            const variantsEnd = SRC.indexOf('size: {', variantsStart);
            expect(variantsStart).toBeGreaterThan(-1);
            const block = SRC.slice(variantsStart, variantsEnd);
            expect(block).not.toMatch(/\.\.\.carbonSurface/);
            expect(block).not.toMatch(/\.\.\.carbonOnHover/);
            // Positive: at least one glass spread exists.
            expect(block).toMatch(/\.\.\.glassSurface/);
            expect(block).toMatch(/\.\.\.glassOnHover/);
        });

        it('no `--btn-carbon-*` token references in cva variant arrays', () => {
            // The variant arrays must reference glass tokens only.
            // Carbon token references inside variants would mean the
            // material swap leaked one of the old layers. Comments
            // referencing the historical carbon layer are fine; the
            // CSS class strings must not contain `--btn-carbon-`.
            const variantsStart = SRC.indexOf('variant: {');
            const variantsEnd = SRC.indexOf('size: {', variantsStart);
            const block = SRC.slice(variantsStart, variantsEnd);
            expect(block).not.toMatch(/--btn-carbon-/);
        });
    });

    describe('R19/R20 layers survive the material swap', () => {
        it('R19-PR-D `carbonStates` (interaction state opacity) is preserved', () => {
            // Despite the carbon-named identifier, this recipe is
            // MATERIAL-AGNOSTIC — it drives `::before` opacity for
            // active/focus/disabled, regardless of what the surface
            // paints. R24 deliberately keeps the name so the R19
            // contract reading stays accurate; a future rename to
            // `interactionStates` is fine but separate.
            expect(SRC).toMatch(/const\s+carbonStates\s*=\s*\[/);
            expect(SRC).toMatch(/\.\.\.carbonStates/);
        });

        it('R20-PR-B `iridescentEdge` recipe survives', () => {
            expect(SRC).toMatch(/const\s+iridescentEdge\s*=\s*\[/);
            expect(SRC).toMatch(/\.\.\.iridescentEdge/);
        });

        it('R20-PR-B `auraPrimary` / `auraNeutral` recipes survive', () => {
            expect(SRC).toMatch(/const\s+auraPrimary\s*=\s*\[/);
            expect(SRC).toMatch(/const\s+auraNeutral\s*=\s*\[/);
        });
    });
});
