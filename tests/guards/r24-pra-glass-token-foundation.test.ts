/**
 * R24-PR-A — Liquid-glass button token foundation ratchet.
 *
 * Locks the 5-token `--btn-glass-*` suite in both the dark-theme
 * `:root` and the light-theme `:root.light` blocks of `tokens.css`.
 *
 * Why structural ratchet and not a render test: the visual contract
 * is owned by R24-PR-B (the cva recipes that consume these tokens).
 * The R24-PR-A risk is a future PR silently dropping or renaming a
 * token, which would orphan the consumer recipe. The five
 * assertions below catch that class of bug at the token-source.
 *
 * Naming contract: every glass token starts with `--btn-glass-`.
 * A sibling namespace (`--ctrl-glass-`, `--btn-frost-`, etc.) is
 * forbidden — R24 commits to ONE prefix so future material swaps
 * are a global find-and-replace, not a multi-prefix archaeology.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const TOKENS_PATH = path.resolve(
    __dirname,
    '../../src/styles/tokens.css',
);

const TOKENS = fs.readFileSync(TOKENS_PATH, 'utf8');

const REQUIRED_GLASS_TOKENS = [
    '--btn-glass-tint',
    '--btn-glass-blur',
    '--btn-glass-edge',
    '--btn-glass-inner',
    '--btn-glass-shadow',
] as const;

describe('R24-PR-A — Liquid-glass token foundation', () => {
    describe('Token surface (both themes)', () => {
        for (const token of REQUIRED_GLASS_TOKENS) {
            it(`declares ${token}`, () => {
                // The token must appear at least twice — once in the
                // dark-theme `:root` block and once in the light-theme
                // `[data-theme="light"]` block. A single declaration
                // means one theme is missing the material parity R24
                // commits to.
                //
                // Count via `split` rather than building a regex from
                // the token string — avoids the CodeQL
                // js/incomplete-sanitization alert on dynamic regex
                // construction. The literal `${token}:` substring is
                // unambiguous since CSS custom-property declarations
                // always use `--name:` syntax.
                const needle = `${token}:`;
                const occurrences = TOKENS.split(needle).length - 1;
                expect(occurrences).toBeGreaterThanOrEqual(2);
            });
        }
    });

    describe('Namespace lock', () => {
        it('does not introduce a sibling `--ctrl-glass-*` namespace', () => {
            // Form controls already have their own `--ctrl-edge-*`
            // material; R24 does NOT extend the glass material to
            // them. A sibling `--ctrl-glass-` token would fork the
            // material naming and dilute the R24 contract.
            expect(TOKENS).not.toMatch(/--ctrl-glass-/);
        });

        it('does not introduce a sibling `--btn-frost-*` or `--btn-glass2-*` namespace', () => {
            // Common drift patterns when material work is re-attempted
            // without retiring the previous tokens. R24 commits to
            // ONE prefix.
            expect(TOKENS).not.toMatch(/--btn-frost-/);
            expect(TOKENS).not.toMatch(/--btn-glass2-/);
        });
    });

    describe('Light + dark parity', () => {
        it('every glass token appears in BOTH `:root` and `[data-theme="light"]` blocks', () => {
            // Locate the two theme blocks by their canonical opening
            // selectors. The dark-theme block is `:root {`; the
            // light-theme block is `[data-theme="light"] {`
            // (tokens.css convention). Each block must contain all
            // five glass tokens.
            const darkStart = TOKENS.indexOf(':root {');
            const lightStart = TOKENS.indexOf('[data-theme="light"] {');
            expect(darkStart).toBeGreaterThan(-1);
            expect(lightStart).toBeGreaterThan(-1);
            // The dark block ends where the light block begins (the
            // tokens.css source orders them that way today). Slice
            // each region and check token presence.
            const darkBlock = TOKENS.slice(darkStart, lightStart);
            // Bound the light block at the end-of-file or the next
            // top-level selector. The current file uses `}` followed
            // by a blank line as the close — slicing to the end is
            // safe because nothing else in tokens.css declares more
            // `--btn-glass-*` tokens.
            const lightBlock = TOKENS.slice(lightStart);
            for (const token of REQUIRED_GLASS_TOKENS) {
                expect(darkBlock).toContain(token);
                expect(lightBlock).toContain(token);
            }
        });
    });

    describe('Material semantics', () => {
        it('--btn-glass-blur is a length value (px / rem)', () => {
            // Blur radius must be a CSS length. A unitless `0`
            // would silently disable the glass effect; a percentage
            // is invalid for backdrop-filter blur().
            expect(TOKENS).toMatch(/--btn-glass-blur\s*:\s*\d+(?:\.\d+)?(?:px|rem)\s*;/);
        });

        it('--btn-glass-tint is a gradient (not a flat colour)', () => {
            // The tint MUST be a gradient — a flat alpha-tinted
            // colour wouldn't have the directional light cue (top
            // brighter, bottom darker) that gives the surface volume.
            expect(TOKENS).toMatch(/--btn-glass-tint\s*:\s*linear-gradient\b/);
        });

        it('--btn-glass-edge is a gradient (the 1px meniscus stroke)', () => {
            // The edge sheen carries the light direction. A flat
            // colour edge reads as a printed outline; the gradient
            // reads as glass catching ambient light.
            expect(TOKENS).toMatch(/--btn-glass-edge\s*:\s*linear-gradient\b/);
        });
    });
});
