/**
 * Roadmap-13 PR-2 — Band gradient richness + soft glow.
 *
 * R12-PR5 shipped a 2-stop brand-gradient band (default → emphasis).
 * Honest, but flat — the eye reads it as "a strip of yellow",
 * full stop. R13-PR2 evolves the recipe in two ways:
 *
 *   1. **3-stop gradient with a highlight midstop.** The middle stop
 *      uses `--brand-muted` (one rung lighter than `--brand-default`),
 *      so the band reads like brushed metal with a polished highlight
 *      bar across its middle. The "alive" feel comes from the shape
 *      of light on the band, not from motion.
 *
 *   2. **Soft outer glow.** A 6px-blur `box-shadow` resolved from
 *      `--nav-band-glow` (theme-aware: yellow @ 35% on METRO, orange
 *      @ 35% on PwC) bleeds brand-coloured light into the row
 *      surface. The band stops looking like a stamped line and
 *      starts looking like an ornament with an aura.
 *
 * These two additions are what the user means by "more gradient,
 * more fluid, no rough edges". They're a pure visual richness step
 * — opacity transition, geometry, and the underlying R12-PR5
 * invariants are unchanged.
 *
 * What this ratchet does NOT police:
 *
 *   - The exact midstop colour (just that `--brand-muted` is
 *     wired). A future "let's tune the highlight darker" PR is
 *     fine within that boundary.
 *   - The glow blur radius or alpha. Tokens.css carries those
 *     literal values; this ratchet locks the `--nav-band-glow`
 *     plumbing, not the value.
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

describe('Roadmap-13 PR-2 — band gradient richness + glow', () => {
    describe('3-stop gradient', () => {
        it('keeps the R12-PR5 from-default + to-emphasis endpoints', () => {
            // R12-PR5 still owns the gradient's endpoints. R13-PR2
            // is purely additive — a midstop inserted between the
            // two locked endpoints. If a future PR drops either
            // endpoint, the R12-PR5 ratchet fires; this assertion
            // doubles up the contract from the R13 side.
            expect(NAV_ITEM_SRC).toMatch(
                /before:from-\[var\(--brand-default\)\]/,
            );
            expect(NAV_ITEM_SRC).toMatch(
                /before:to-\[var\(--brand-emphasis\)\]/,
            );
        });

        it('adds a `--brand-muted` midstop via `before:via-[...]`', () => {
            // The highlight bar. `--brand-muted` is the lightest tier
            // of the brand palette (METRO: lighter yellow #FFE066;
            // PwC: lighter orange #E06520). Pulling it through the
            // middle of the band produces the "polished metal" read.
            expect(NAV_ITEM_SRC).toMatch(
                /before:via-\[var\(--brand-muted\)\]/,
            );
        });

        it('the three stops appear in `from → via → to` order', () => {
            // Tailwind's gradient utilities are positional —
            // from/via/to map to 0%/50%/100% by default. Order in
            // the className string is order in the rendered
            // gradient. A future PR that scrambles them would
            // produce a different visual without warning; this
            // assertion catches it.
            const fromIdx = NAV_ITEM_SRC.search(
                /before:from-\[var\(--brand-default\)\]/,
            );
            const viaIdx = NAV_ITEM_SRC.search(
                /before:via-\[var\(--brand-muted\)\]/,
            );
            const toIdx = NAV_ITEM_SRC.search(
                /before:to-\[var\(--brand-emphasis\)\]/,
            );
            expect(fromIdx).toBeGreaterThan(-1);
            expect(viaIdx).toBeGreaterThan(fromIdx);
            expect(toIdx).toBeGreaterThan(viaIdx);
        });
    });

    describe('soft glow', () => {
        it('NAV_ITEM_BAND_BASE wires `before:shadow-[var(--nav-band-glow)]`', () => {
            // The glow is theme-aware via the CSS custom property.
            // The recipe MUST go through the token — a hardcoded
            // rgba shadow would break theme parity (the orange
            // glow would render on the dark METRO theme too).
            expect(NAV_ITEM_SRC).toMatch(
                /before:shadow-\[var\(--nav-band-glow\)\]/,
            );
        });

        it('METRO declares --nav-band-glow with METRO-yellow rgba', () => {
            // The METRO declaration MUST sit inside `:root` and use
            // the yellow tone — `rgba(255, 205, 17, …)`. Alpha is
            // locked at 0.35 for now; future tuning can move it
            // within reason.
            const rootBlock =
                TOKENS_SRC.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
            expect(rootBlock).toMatch(
                /--nav-band-glow:\s*0\s+0\s+6px\s+rgba\(255,\s*205,\s*17,\s*0\.35\)/,
            );
        });

        it('PwC declares --nav-band-glow with PwC-orange rgba', () => {
            const lightBlock =
                TOKENS_SRC.match(
                    /\[data-theme="light"\]\s*\{[\s\S]*?\n\}/,
                )?.[0] ?? '';
            expect(lightBlock).toMatch(
                /--nav-band-glow:\s*0\s+0\s+6px\s+rgba\(208,\s*74,\s*2,\s*0\.35\)/,
            );
        });

        it('glow blur radius is identical across themes', () => {
            // The geometry of the glow is theme-independent — only
            // the hue swaps. A future PR that bumps METRO to 8px
            // and PwC stays at 6px would make the visual feel
            // off-balance between themes; this assertion prevents
            // accidental drift.
            const metroMatch = TOKENS_SRC.match(
                /:root\s*\{[\s\S]*?--nav-band-glow:\s*(0\s+0\s+\d+px)[^;]*;/,
            );
            const pwcMatch = TOKENS_SRC.match(
                /\[data-theme="light"\]\s*\{[\s\S]*?--nav-band-glow:\s*(0\s+0\s+\d+px)[^;]*;/,
            );
            expect(metroMatch).not.toBeNull();
            expect(pwcMatch).not.toBeNull();
            expect(metroMatch![1]).toBe(pwcMatch![1]);
        });

        it('glow alpha is identical across themes', () => {
            // Same logic — the glow's STRENGTH is theme-independent;
            // only the hue varies. If one theme drifts to 0.25 and
            // the other stays at 0.35, the brand "presence" of the
            // band feels different on the two themes.
            const metroAlpha = TOKENS_SRC.match(
                /:root\s*\{[\s\S]*?--nav-band-glow:[^;]*rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/,
            )?.[1];
            const pwcAlpha = TOKENS_SRC.match(
                /\[data-theme="light"\]\s*\{[\s\S]*?--nav-band-glow:[^;]*rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/,
            )?.[1];
            expect(metroAlpha).toBe(pwcAlpha);
        });
    });

    describe('preserved R12-PR5 invariants', () => {
        it('still transitions only allowed properties (R13-PR9 broadening: opacity + top/bottom/width)', () => {
            // R13-PR2 was opacity-only motion; R13-PR9 broadened
            // the transition-property list to include band-geometry
            // (`transition-[opacity,top,bottom,width]`) so the band
            // can reach toward the cursor on hover. The motion-
            // language contract is preserved at the principle
            // level — no transform, no scale, no translate — and
            // we accept either the original `transition-opacity`
            // or the broadened arbitrary-value form here.
            const baseRegion =
                NAV_ITEM_SRC.match(
                    /const\s+NAV_ITEM_BAND_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
                )?.[0] ?? '';
            expect(baseRegion).toMatch(
                /before:transition-(opacity\b|\[opacity[^\]]*\])/,
            );
            expect(baseRegion).not.toMatch(/before:transition-transform/);
            expect(baseRegion).not.toMatch(/before:scale-/);
            expect(baseRegion).not.toMatch(/before:translate-/);
        });

        it('still pinned to left-0 + 3px wide', () => {
            // R12-PR2/PR5 geometry invariants — we're not changing
            // the band's footprint, just what it looks like.
            const baseRegion =
                NAV_ITEM_SRC.match(
                    /const\s+NAV_ITEM_BAND_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
                )?.[0] ?? '';
            expect(baseRegion).toMatch(/before:left-0/);
            expect(baseRegion).toMatch(/before:w-\[3px\]/);
        });
    });
});
