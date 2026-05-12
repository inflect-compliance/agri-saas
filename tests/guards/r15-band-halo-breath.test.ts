/**
 * Roadmap-15 PR-2 — Asymmetric halo breath on the band.
 *
 * R13-PR3 gave the band one timeline: a 4-second `background-position`
 * pan (`nav-band-shimmer`) that drifts the gradient along the band's
 * length. Honest motion — but a single periodic timeline reads as
 * mechanical to the eye after about 8 seconds (two cycles).
 *
 * R15-PR2 adds a SECOND timeline on the same `::before`:
 *
 *   `nav-band-halo-breath` — 6-second `filter: brightness()` pulse,
 *   1.0 → 1.25 → 1.0. The band's entire rendered surface (gradient
 *   + stardust particles + outer glow) gets brighter and softer
 *   over 3 seconds, then settles back over 3 more.
 *
 * The two animations compose in CSS via the `animation` shorthand's
 * comma-separated list — `nav-band-alive` declares BOTH tracks:
 *
 *   nav-band-shimmer    4s ease-in-out infinite,
 *   nav-band-halo-breath 6s ease-in-out infinite
 *
 * Why two different durations?
 *
 *   The least-common-multiple of 4 and 6 is 12. So the two timelines
 *   only re-synchronise once every 12 seconds. For every glance
 *   shorter than that (which is every glance), the band is in a
 *   never-repeating phase combination — the eye reads "alive,
 *   evolving" rather than "looping". Two animations at the same
 *   tempo would synchronise and become hypnotic; deliberately
 *   mismatched tempos break the loop.
 *
 * Why filter: brightness() and not opacity?
 *
 *   Opacity on the ::before would fight the existing R12-PR5
 *   opacity-0 → 100 reveal transition. Filter doesn't compose with
 *   any other property — it's a clean third channel. Brightness >1
 *   also lifts the band's COLOUR alongside its luminosity, so the
 *   pulse feels warm rather than washed out.
 *
 * What this ratchet does NOT police:
 *
 *   - The exact brightness peak (1.25). A future tuning to 1.20 or
 *     1.30 is fine within the "soft pulse, not flash" boundary.
 *   - Per-row delay/offset. PR-5 will introduce per-row staggers;
 *     this PR just establishes the two-timeline composition.
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

describe('Roadmap-15 PR-2 — band halo breath', () => {
    describe('keyframe declaration', () => {
        it('declares `nav-band-halo-breath` in tailwind.config.js keyframes', () => {
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-halo-breath':\s*\{/,
            );
        });

        it('animates `filter: brightness()` (not transform / opacity / colour)', () => {
            // Filter is the clean third channel — opacity is owned
            // by the R12-PR5 reveal transition; transform is owned
            // by the R13-PR8 press-feedback `active:translate-y-px`;
            // background-position is owned by the R13-PR3 shimmer.
            // Filter sits orthogonal to all three.
            const declStart = TAILWIND_CONFIG.indexOf(
                "'nav-band-halo-breath': {",
            );
            expect(declStart).toBeGreaterThan(-1);
            // Slice forward to the keyframe block close — bounded
            // by the next entry's opening line. The simplest bound
            // is "100%" + a few chars for the closing brace.
            const tail = TAILWIND_CONFIG.slice(declStart);
            const slice = tail.slice(0, tail.indexOf('100%') + 200);
            expect(slice).toMatch(/filter:\s*'brightness/);
            expect(slice).not.toContain('transform');
            expect(slice).not.toContain('translate');
            expect(slice).not.toContain('scale');
            expect(slice).not.toContain('background-position');
            expect(slice).not.toContain('opacity');
        });

        it('peaks above baseline brightness (>1.0)', () => {
            // The pulse needs an actual amplitude — `brightness(1)`
            // at every keyframe step would be a no-op. The 50%
            // step must exceed 1.0 to make the band visibly
            // brighter at its peak.
            const declStart = TAILWIND_CONFIG.indexOf(
                "'nav-band-halo-breath': {",
            );
            const tail = TAILWIND_CONFIG.slice(declStart);
            const slice = tail.slice(0, tail.indexOf('100%') + 200);
            const peakMatch = slice.match(
                /'50%':\s*\{\s*filter:\s*'brightness\(([\d.]+)\)'/,
            );
            expect(peakMatch).not.toBeNull();
            const peak = parseFloat(peakMatch![1]);
            expect(peak).toBeGreaterThan(1.0);
            // Cap upper bound at 1.5 — anything brighter starts to
            // read as a "flash" rather than a "breath".
            expect(peak).toBeLessThanOrEqual(1.5);
        });

        it('returns to baseline at 0% and 100% (palindrome shape)', () => {
            // A `0% → peak → 100%` keyframe that doesn't return to
            // baseline would create a hard jump every cycle. The
            // palindrome shape is what makes infinite play seamless.
            const declStart = TAILWIND_CONFIG.indexOf(
                "'nav-band-halo-breath': {",
            );
            const tail = TAILWIND_CONFIG.slice(declStart);
            const slice = tail.slice(0, tail.indexOf('100%') + 200);
            expect(slice).toMatch(
                /'0%,\s*100%':\s*\{\s*filter:\s*'brightness\(1\)'/,
            );
        });
    });

    describe('animation entry', () => {
        it('wires `animation.nav-band-halo-breath` with 6s ease-in-out infinite', () => {
            // 6s — deliberately mismatched against the 4s shimmer.
            // LCM(4, 6) = 12 means the two timelines never re-sync
            // for any glance shorter than 12 seconds.
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-halo-breath':\s*'nav-band-halo-breath\s+6s\s+ease-in-out\s+infinite'/,
            );
        });

        it('declares the composed `nav-band-alive` animation entry', () => {
            // The `nav-band-alive` utility is the consumer-facing
            // composed animation — applies BOTH shimmer + halo-breath
            // as a single class. The CSS `animation` property accepts
            // a comma-separated list; this is the canonical way to
            // stack two timelines on one element.
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-alive':\s*['"][^'"]*nav-band-shimmer[^'"]*nav-band-halo-breath[^'"]*['"]/,
            );
        });

        it('`nav-band-alive` includes the 4s shimmer track first', () => {
            // The shimmer is the band's PRIMARY motion — the
            // halo-breath is a SECONDARY softer pulse layered
            // beneath. Order matters for `animation-fill-mode`
            // composition when the band first becomes opacity-1.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            const shimmerIdx = value.indexOf('nav-band-shimmer');
            const breathIdx = value.indexOf('nav-band-halo-breath');
            expect(shimmerIdx).toBeGreaterThan(-1);
            expect(breathIdx).toBeGreaterThan(shimmerIdx);
        });

        it('`nav-band-alive` preserves both per-track durations (4s + 6s)', () => {
            // Each track inside the composed string must carry its
            // own duration — `animation: nav-band-shimmer, nav-band-
            // halo-breath` (no durations) would use the inherited
            // animation-duration for both. Explicit per-track
            // durations are the load-bearing piece.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            expect(value).toMatch(/nav-band-shimmer\s+4s\s+ease-in-out\s+infinite/);
            expect(value).toMatch(
                /nav-band-halo-breath\s+6s\s+ease-in-out\s+infinite/,
            );
        });
    });

    describe('NavItem wiring', () => {
        it('NAV_ITEM_DEFAULT applies the composed alive animation on hover', () => {
            // The composed `animate-nav-band-alive` replaces the
            // single-track `animate-nav-band-shimmer` so hover-fade
            // -in rows immediately get both timelines.
            const defaultRecipe =
                NAV_ITEM_SRC.match(
                    /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
                )?.[1] ?? '';
            expect(defaultRecipe).toMatch(
                /hover:before:animate-nav-band-alive/,
            );
        });

        it('NAV_ITEM_ACTIVE applies the composed alive animation unconditionally', () => {
            // The active row holds both timelines permanently —
            // that's the "current page feels alive" signal.
            // R15-PR4 introduced `nav-band-active-alive` (adds the
            // starburst bloom as the first track); its definition
            // includes both `nav-band-shimmer` and
            // `nav-band-halo-breath` as later tracks, so the halo-
            // breath contract still holds. Accept either variant.
            const activeRecipe =
                NAV_ITEM_SRC.match(
                    /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
                )?.[1] ?? '';
            expect(activeRecipe).toMatch(
                /(?<!hover:)before:animate-nav-band-(?:active-)?alive\b/,
            );
        });

        it('the single-track `animate-nav-band-shimmer` no longer appears in NavItem', () => {
            // Once the composed alive utility is in place, the
            // single-track shimmer reference is dead code. Leaving
            // it would imply two separate animation declarations
            // on the same element — the second one wins, so the
            // first would silently be a no-op.
            expect(NAV_ITEM_SRC).not.toMatch(/animate-nav-band-shimmer/);
        });
    });
});
