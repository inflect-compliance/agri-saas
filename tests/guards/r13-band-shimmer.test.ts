/**
 * Roadmap-13 PR-3 — Band shimmer animation.
 *
 * R12-PR5 + R13-PR2 give the band a richly-coloured form. PR-3 adds
 * the SLOW VERTICAL PULSE — the band breathes. A 4-second ease-in-out
 * loop pans the gradient along the band's length (`background-size:
 * 100% 200%`, `background-position` 0% → 100% → 0%). The eye reads
 * this as a quiet pulse of brand light travelling top-to-bottom and
 * back; deliberately slower than the 1.6s skeleton-shimmer tempo so
 * it doesn't read as a loading indicator.
 *
 * Three load-bearing pieces, each invariant-checked here:
 *
 *   1. The `nav-band-shimmer` keyframe is declared in
 *      `tailwind.config.js` with the 0% / 50% / 100% palindrome
 *      (`background-position` 0% 0% → 0% 100% → 0% 0%). The
 *      back-and-forth shape is what lets the loop be seamless with
 *      an asymmetric 3-stop gradient — a 0→100% linear infinite
 *      would jump at every cycle's seam.
 *
 *   2. The animation utility (`animation.nav-band-shimmer`) wires
 *      4s ease-in-out infinite. The slow tempo is deliberate.
 *
 *   3. The band's `::before` is set to `background-size: 100% 200%`
 *      via `before:[background-size:100%_200%]`. Without this the
 *      pan would be a no-op (gradient is already at 100% so there's
 *      nowhere to pan to). The shimmer animation is gated to
 *      hover + active states (not the always-mounted base) so an
 *      idle sidebar with 20+ rows isn't running 20 invisible
 *      animations.
 *
 * `prefers-reduced-motion: reduce` is handled globally in
 * `src/styles/tokens.css` (every `animation-duration` flattened to
 * 1ms !important). No per-component opt-in needed — but the
 * existence of the global guard IS load-bearing, so this ratchet
 * verifies it still lives in tokens.css.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAV_ITEM_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);
const TAILWIND_CONFIG = fs.readFileSync(
    path.join(ROOT, 'tailwind.config.js'),
    'utf8',
);
const TOKENS_SRC = fs.readFileSync(
    path.join(ROOT, 'src/styles/tokens.css'),
    'utf8',
);

describe('Roadmap-13 PR-3 — band shimmer animation', () => {
    describe('keyframe declaration', () => {
        it('declares `nav-band-shimmer` in tailwind.config.js keyframes', () => {
            // The keyframe name MUST be `nav-band-shimmer` — that's
            // what the Tailwind utility `animate-nav-band-shimmer`
            // resolves to. A different name silently breaks the
            // animation.
            expect(TAILWIND_CONFIG).toMatch(/'nav-band-shimmer':\s*\{/);
        });

        it('uses the 0% / 50% / 100% palindrome shape', () => {
            // `0%, 100%` at one position + `50%` at the other is the
            // back-and-forth that makes the loop seamless. A
            // `0% → 100%` linear keyframe with `infinite` would
            // jump at every cycle's seam because the gradient
            // endpoints (default → emphasis) are asymmetric.
            //
            // Match the two keyframe step lines anywhere in the
            // file (between the `nav-band-shimmer` declaration and
            // its closing). Both must point at `background-position`.
            const blockMatch = TAILWIND_CONFIG.match(
                /'nav-band-shimmer':\s*\{[\s\S]*?'0%,\s*100%':\s*\{\s*'background-position':\s*'0%\s+0%'\s*\}/,
            );
            expect(blockMatch).not.toBeNull();
            const midMatch = TAILWIND_CONFIG.match(
                /'nav-band-shimmer':\s*\{[\s\S]*?'50%':\s*\{\s*'background-position':\s*'0%\s+100%'\s*\}/,
            );
            expect(midMatch).not.toBeNull();
        });

        it('animates `background-position` (not transform / opacity)', () => {
            // R12's motion-language rule is "opacity + colour only".
            // R13-PR3 stretches "opacity" into "any non-geometry
            // property that doesn't trigger layout" — background
            // position counts (it's painted-pixel-only). Transform /
            // translate / scale would compose with the band's
            // existing 200ms opacity transition and break the
            // motion-reduce contract in a way that doesn't reflow.
            // We lock background-position as the animated property.
            //
            // Slice the file from the `nav-band-shimmer:` declaration
            // to the first three-step keyframe close (the comma at
            // the end of the entry). Anything inside that slice that
            // mentions `transform` would mean we accidentally added a
            // banned motion property to this keyframe.
            const declStart = TAILWIND_CONFIG.indexOf(
                "'nav-band-shimmer': {",
            );
            expect(declStart).toBeGreaterThan(-1);
            const tail = TAILWIND_CONFIG.slice(declStart);
            // Use the first occurrence of `},\n` after the second `{` to
            // bound the keyframe declaration.
            const slice = tail.slice(0, tail.indexOf('100%') + 200);
            expect(slice).toContain('background-position');
            expect(slice).not.toContain('transform');
            expect(slice).not.toContain('translate');
            expect(slice).not.toContain('scale');
        });
    });

    describe('animation declaration', () => {
        it('wires `animation.nav-band-shimmer` with 4s ease-in-out infinite', () => {
            // 4s is the slow tempo — not a loading indicator.
            // ease-in-out gives the breathing curve. `infinite` keeps
            // it going as long as the band is visible.
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-shimmer':\s*'nav-band-shimmer\s+4s\s+ease-in-out\s+infinite'/,
            );
        });
    });

    describe('NavItem band wiring', () => {
        it('NAV_ITEM_BAND_BASE sets background-size to 100% 200%', () => {
            // Without `background-size: 100% 200%` the gradient
            // already covers the band — there's nowhere to pan to.
            // The arbitrary-value form `[background-size:100%_200%]`
            // is the only Tailwind-4 idiom that compiles cleanly
            // here. (`bg-[length:...]` is for background-image, not
            // background-size.)
            expect(NAV_ITEM_SRC).toMatch(
                /before:\[background-size:100%_200%\]/,
            );
        });

        it('NAV_ITEM_DEFAULT animates the band on hover only', () => {
            // The animation MUST be gated to hover. An always-running
            // animation on every sidebar row would burn CPU on
            // 20+ invisible rows. `hover:before:animate-...` only
            // fires while the row is pointed at, which is also the
            // only moment the band is opacity-1 in the default state.
            //
            // R15-PR2 broadened the animation utility from
            // `nav-band-shimmer` (single-track) to `nav-band-alive`
            // (composed: shimmer + halo-breath). Both forms are
            // accepted here — the load-bearing piece is that the
            // 4-second shimmer pan reaches the rendered surface;
            // the `nav-band-alive` keyframe definition (asserted
            // separately by the R15-PR2 ratchet) embeds
            // `nav-band-shimmer 4s ease-in-out infinite` as its
            // first track, so the visual contract is preserved.
            const defaultRecipe =
                NAV_ITEM_SRC.match(
                    /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
                )?.[1] ?? '';
            const shimmerForm = /hover:before:animate-nav-band-shimmer\b/.test(
                defaultRecipe,
            );
            const aliveForm = /hover:before:animate-nav-band-alive\b/.test(
                defaultRecipe,
            );
            expect(shimmerForm || aliveForm).toBe(true);
            // Critical: the un-prefixed animate utility (either
            // form) must NOT appear in the default recipe — that
            // would run the animation even when the band is
            // opacity-0.
            expect(defaultRecipe).not.toMatch(
                /(?<!hover:before:)animate-nav-band-shimmer\b/,
            );
            expect(defaultRecipe).not.toMatch(
                /(?<!hover:before:)animate-nav-band-alive\b/,
            );
        });

        it('NAV_ITEM_ACTIVE animates the band unconditionally', () => {
            // Active rows hold the band visible permanently, so the
            // shimmer runs permanently too — that's part of what
            // makes the current page feel "alive" vs the static
            // hovered rows.
            //
            // R15-PR2 broadened to `nav-band-alive` (shimmer +
            // halo-breath composed). Both forms accepted; the
            // `nav-band-alive` definition embeds `nav-band-shimmer
            // 4s ease-in-out infinite` so the underlying contract
            // holds either way.
            const activeRecipe =
                NAV_ITEM_SRC.match(
                    /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
                )?.[1] ?? '';
            const shimmerForm = /before:animate-nav-band-shimmer\b/.test(
                activeRecipe,
            );
            // R15-PR2 introduced `nav-band-alive`; R15-PR4
            // introduced `nav-band-active-alive` (adds the
            // starburst bloom for the active row). Both embed
            // `nav-band-shimmer 4s ease-in-out infinite` as a
            // track inside their Tailwind animation entries, so
            // the underlying R13-PR3 visual contract still holds.
            const aliveForm = /before:animate-nav-band-(?:active-)?alive\b/.test(
                activeRecipe,
            );
            expect(shimmerForm || aliveForm).toBe(true);
            // No hover prefix in active — the active recipe is
            // un-gated.
            expect(activeRecipe).not.toMatch(
                /hover:before:animate-nav-band-shimmer\b/,
            );
            expect(activeRecipe).not.toMatch(
                /hover:before:animate-nav-band-(?:active-)?alive\b/,
            );
        });
    });

    describe('motion-reduce safety net', () => {
        it('tokens.css carries the global prefers-reduced-motion override', () => {
            // The global guard flattens every animation duration to
            // 1ms !important. As long as this exists, every component
            // animation — including nav-band-shimmer — respects the
            // user's OS-level preference automatically.
            expect(TOKENS_SRC).toMatch(
                /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
            );
            expect(TOKENS_SRC).toMatch(
                /animation-duration:\s*1ms\s*!important/,
            );
        });
    });
});
