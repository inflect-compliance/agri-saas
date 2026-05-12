/**
 * Roadmap-13 PR-4 — Active band swaps to secondary brand.
 *
 * The headline change of R13. Until PR-4, hover and active painted
 * the band in the SAME hue family (primary brand — yellow on METRO,
 * orange on PwC), distinguished only by the brand-subtle wash and
 * font-weight on active. The user reads "more yellow" vs "even more
 * yellow", which is a tonal whisper rather than a state shout.
 *
 * R13-PR4 introduces a TWO-TONE state vocabulary:
 *
 *   HOVER  → primary brand band   (warm — yellow / orange)
 *   ACTIVE → secondary brand band (cool — electric blue / deep navy)
 *
 * Cool band against warm wash is the colour-temperature contrast the
 * eye reads as "lit object on a coloured surface" — the active row
 * pops past every hovered row at a glance.
 *
 * The override is implemented via Tailwind's `!` important suffix on
 * each gradient stop class. BASE declares the primary-brand gradient;
 * ACTIVE needs to win unambiguously. Without `!`, JIT-compiled
 * siblings with the same specificity rely on source order in the
 * emitted CSS — fragile to refactors.
 *
 * Five load-bearing pieces, each invariant-checked here:
 *
 *   1. `--brand-secondary-muted` exists in both themes — the
 *      highlight midstop on the secondary gradient.
 *   2. `--nav-band-glow-active` exists in both themes — the
 *      navy-tinted aura.
 *   3. ACTIVE recipe overrides `from`/`via`/`to` with `!` important.
 *   4. ACTIVE recipe overrides the glow shadow with `!` important.
 *   5. The hover recipe (`NAV_ITEM_DEFAULT`) does NOT touch the
 *      secondary tokens — preserves the two-tone vocabulary.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAV_ITEM_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);
const TOKENS_SRC = fs.readFileSync(
    path.join(ROOT, 'src/styles/tokens.css'),
    'utf8',
);

const DARK_BLOCK = TOKENS_SRC.match(/:root\s*\{[\s\S]*?\n\}/)![0];
const LIGHT_BLOCK = TOKENS_SRC.match(
    /\[data-theme="light"\]\s*\{[\s\S]*?\n\}/,
)![0];

describe('Roadmap-13 PR-4 — active band swaps to secondary brand', () => {
    describe('token foundation extends (--brand-secondary-muted)', () => {
        it('METRO declares --brand-secondary-muted', () => {
            // METRO's secondary-default is electric blue (#3B82F6);
            // the muted tier is one rung lighter (#60A5FA) — the
            // highlight midstop on the active band's 3-stop gradient.
            expect(DARK_BLOCK).toMatch(
                /--brand-secondary-muted:\s*#60A5FA\b/i,
            );
        });

        it('PwC declares --brand-secondary-muted', () => {
            // PwC's secondary-default is deep navy (#1E3A8A); the
            // muted tier is one rung lighter (#3B82F6) — same
            // electric blue used as METRO's secondary-default,
            // which works here because relative to PwC's deep navy
            // it reads as the "highlight" position.
            expect(LIGHT_BLOCK).toMatch(
                /--brand-secondary-muted:\s*#3B82F6\b/i,
            );
        });

        it('METRO + PwC both list secondary tokens in default/emphasis/muted/subtle order', () => {
            // The token order conveys hierarchy. Future PRs adding
            // tokens to this family MUST insert at the right tier;
            // a `--brand-secondary-emphasis` declared AFTER `--brand-
            // secondary-subtle` would read as a flat list rather
            // than a three-tier-plus-tint vocabulary.
            for (const block of [DARK_BLOCK, LIGHT_BLOCK]) {
                const idxDefault = block.search(
                    /--brand-secondary-default:/,
                );
                const idxEmphasis = block.search(
                    /--brand-secondary-emphasis:/,
                );
                const idxMuted = block.search(
                    /--brand-secondary-muted:/,
                );
                const idxSubtle = block.search(
                    /--brand-secondary-subtle:/,
                );
                expect(idxDefault).toBeGreaterThan(-1);
                expect(idxEmphasis).toBeGreaterThan(idxDefault);
                expect(idxMuted).toBeGreaterThan(idxEmphasis);
                expect(idxSubtle).toBeGreaterThan(idxMuted);
            }
        });
    });

    describe('active-glow token (--nav-band-glow-active)', () => {
        it('METRO declares --nav-band-glow-active in the electric-blue family', () => {
            // The active glow has to MATCH the active band's stops
            // — yellow-glow around a blue band would read as
            // accidental colour bleed.
            expect(DARK_BLOCK).toMatch(
                /--nav-band-glow-active:\s*0\s+0\s+6px\s+rgba\(59,\s*130,\s*246,\s*0\.35\)/,
            );
        });

        it('PwC declares --nav-band-glow-active in the deep-navy family', () => {
            expect(LIGHT_BLOCK).toMatch(
                /--nav-band-glow-active:\s*0\s+0\s+6px\s+rgba\(30,\s*58,\s*138,\s*0\.35\)/,
            );
        });

        it('blur radius matches the base glow across themes', () => {
            // The geometry of the active glow MUST equal the
            // geometry of the base glow — same 6px blur, same
            // 35% alpha. Otherwise the active row would feel
            // visually heavier/lighter than the hover row in a way
            // that's distracting.
            for (const block of [DARK_BLOCK, LIGHT_BLOCK]) {
                const baseGeom = block.match(
                    /--nav-band-glow:\s*(0\s+0\s+\d+px)/,
                )?.[1];
                const activeGeom = block.match(
                    /--nav-band-glow-active:\s*(0\s+0\s+\d+px)/,
                )?.[1];
                expect(baseGeom).toBeDefined();
                expect(activeGeom).toBe(baseGeom);
            }
        });
    });

    describe('NAV_ITEM_ACTIVE wires the secondary gradient + glow', () => {
        function activeRecipe(): string {
            const m = NAV_ITEM_SRC.match(
                /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
            );
            expect(m).not.toBeNull();
            return m![1];
        }

        it('overrides `before:from` with secondary-default + `!` important', () => {
            // The `!` is what guarantees the override regardless of
            // Tailwind's emitted-CSS ordering. Without it, BASE's
            // `from-[--brand-default]` might win randomly.
            expect(activeRecipe()).toMatch(
                /before:from-\[var\(--brand-secondary-default\)\]!/,
            );
        });

        it('overrides `before:via` with secondary-muted + `!` important', () => {
            expect(activeRecipe()).toMatch(
                /before:via-\[var\(--brand-secondary-muted\)\]!/,
            );
        });

        it('overrides `before:to` with secondary-emphasis + `!` important', () => {
            expect(activeRecipe()).toMatch(
                /before:to-\[var\(--brand-secondary-emphasis\)\]!/,
            );
        });

        it('overrides `before:shadow` with the active-glow token + `!` important', () => {
            // Glow follows the band's stops. The `!` is required for
            // the same reason as the gradient overrides — BASE
            // declares the primary glow.
            expect(activeRecipe()).toMatch(
                /before:shadow-\[var\(--nav-band-glow-active\)\]!/,
            );
        });

        it('preserves the R12-PR6 + R13-PR5 conviction tokens', () => {
            // R13-PR4 is purely additive on top of R12-PR6's four
            // tokens. If a future regression drops one of them,
            // the active state collapses to "just the band changed"
            // — not what we want.
            //
            // Text colour: R12-PR6 originally locked `text-content-
            // emphasis`; R13-PR5 evolved to `text-[var(--brand-
            // default)]`. Either form is accepted here so the
            // "active has a distinct text colour" contract stays
            // intact across the R12 → R13 evolution.
            const recipe = activeRecipe();
            const r12Text = /\btext-content-emphasis\b/.test(recipe);
            const r13Text = /\btext-\[var\(--brand-default\)\]/.test(
                recipe,
            );
            expect(r12Text || r13Text).toBe(true);
            // Wash: R13-PR11 evolved from uniform brand-subtle to
            // a radial gradient from brand-secondary-subtle.
            const r12Wash = /\bbg-\[var\(--brand-subtle\)\]/.test(recipe);
            const r13Wash =
                /bg-\[radial-gradient\(/.test(recipe) &&
                /var\(--brand(-secondary)?-subtle\)/.test(recipe);
            expect(r12Wash || r13Wash).toBe(true);
            expect(recipe).toMatch(/(?<!hover:)\bbefore:opacity-100\b/);
            expect(recipe).toMatch(/\bfont-medium\b/);
        });
    });

    describe('hover state preserves the primary-brand band (no secondary leak)', () => {
        it('NAV_ITEM_DEFAULT does NOT reference any --brand-secondary token', () => {
            // The two-tone vocabulary collapses if hover also leaks
            // into the secondary palette. Hover stays primary;
            // active commits to secondary.
            const defaultMatch = NAV_ITEM_SRC.match(
                /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
            );
            expect(defaultMatch).not.toBeNull();
            const recipe = defaultMatch![1];
            expect(recipe).not.toMatch(/--brand-secondary/);
            expect(recipe).not.toMatch(/nav-band-glow-active/);
        });
    });
});
