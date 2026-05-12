/**
 * Roadmap-15 PR-4 — Active starburst bloom.
 *
 * R13-PR4 + R13-PR11 give the ACTIVE row a settled, brand-coloured
 * vocabulary: navy band (R13-PR4), radial brand wash bleeding from
 * the left (R13-PR11), brand-coloured letters (R13-PR5). Honest
 * conviction — but the transition from "this row was inactive" to
 * "this row is now active" is silent. The user clicks; the band
 * appears; nothing celebrates the moment.
 *
 * R15-PR4 adds a one-shot CELEBRATION: a 700ms `box-shadow`
 * starburst that blooms from baseline (6px blur) outward to a peak
 * (24px blur + 4px spread) at 30% of the animation, then settles
 * back to baseline by 100%. The peak-then-settle shape reads as a
 * quick bloom that fades — like the band itself flexing outward
 * for a moment to mark the page change.
 *
 * Composition: the starburst is added to a NEW `nav-band-active-
 * alive` Tailwind animation entry that the active state references
 * via `before:animate-nav-band-active-alive`. The new entry is a
 * 4-track composition:
 *
 *   nav-band-starburst     700ms ease-out (one-shot)
 *   nav-band-reveal-sweep  450ms ease-out (one-shot)
 *   nav-band-shimmer       4s ease-in-out infinite
 *   nav-band-halo-breath   6s ease-in-out infinite
 *
 * Default rows continue to use the 3-track `nav-band-alive`
 * (without starburst). The bloom is reserved for the active row's
 * "this is now where you are" signal — applying it on hover would
 * dilute the celebration into background noise.
 *
 * Channel orthogonality preserved: the starburst animates
 * `box-shadow`, joining the existing five-channel vocabulary
 * (opacity, transform/translate, background-position, filter,
 * clip-path). Six independent motion channels on the band — each
 * with a distinct PR-level meaning.
 *
 * What this ratchet does NOT police:
 *
 *   - The exact peak blur radius (24px) or spread (4px). Future
 *     tuning is allowed within "felt as a bloom, not a flash".
 *   - The percentage of the peak (30%). The asymmetric peak-then-
 *     settle shape IS locked; the exact ratio can shift.
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

/**
 * Slice the `nav-band-starburst` keyframe block out of the
 * tailwind.config.js source. Bounded by the keyframe's opening
 * declaration and the next top-level `'nav-` key, so we don't
 * accidentally read into other animation entries (e.g. `scale-in`)
 * that mention substrings we want to ban inside the starburst
 * block.
 */
function getStarburstKeyframeSlice(): string {
    const declStart = TAILWIND_CONFIG.indexOf("'nav-band-starburst': {");
    if (declStart < 0) return '';
    const tail = TAILWIND_CONFIG.slice(declStart);
    // The starburst keyframe is followed by the closing `},` of
    // the `keyframes:` object, then the `animation:` key. The
    // next top-level entry inside `keyframes:` (if any) starts
    // with `'nav-` at indent level. Since starburst is currently
    // the LAST keyframe entry, bound at the next sibling-level
    // identifier — `animation:`.
    const animKeyIdx = tail.indexOf('animation:');
    if (animKeyIdx < 0) return tail;
    return tail.slice(0, animKeyIdx);
}

describe('Roadmap-15 PR-4 — active starburst bloom', () => {
    describe('keyframe declaration', () => {
        it('declares `nav-band-starburst` in tailwind.config.js keyframes', () => {
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-starburst':\s*\{/,
            );
        });

        it('animates `box-shadow` (sixth motion channel)', () => {
            // box-shadow joins the established channel set:
            //   opacity            (R12-PR5 reveal)
            //   transform          (R13-PR8 press)
            //   background-position(R13-PR3 shimmer)
            //   filter             (R15-PR2 halo-breath)
            //   clip-path          (R15-PR3 reveal-sweep)
            //   box-shadow         (R15-PR4 starburst) ← new
            // Each channel sits orthogonal to the others — the
            // six animations compose cleanly on a single element.
            const slice = getStarburstKeyframeSlice();
            expect(slice.length).toBeGreaterThan(0);
            expect(slice).toMatch(/'box-shadow':/);
            expect(slice).not.toContain('transform');
            expect(slice).not.toContain('translate');
            expect(slice).not.toContain('scale');
            expect(slice).not.toContain('background-position');
            expect(slice).not.toContain('opacity');
            expect(slice).not.toContain('filter:');
            expect(slice).not.toContain('clip-path');
        });

        it('starts at the resting glow (baseline)', () => {
            // The 0% state matches the band's declared resting
            // shadow — `0 0 6px var(--brand-secondary-default)`.
            // This way the animation's first frame matches the
            // shadow that's already painted, and there's no
            // visible jump at the start.
            const slice = getStarburstKeyframeSlice();
            expect(slice).toMatch(
                /'0%':\s*\{\s*'box-shadow':\s*'0\s+0\s+6px\s+var\(--brand-secondary-default\)'/,
            );
        });

        it('peaks at 30% with expanded blur + spread (the bloom)', () => {
            // The peak is at 30% of the animation (210ms into the
            // 700ms run). 24px blur + 4px spread is the dramatic
            // outer reach — visible across the sidebar's width
            // without overwhelming neighbouring rows.
            const slice = getStarburstKeyframeSlice();
            expect(slice).toMatch(
                /'30%':\s*\{\s*'box-shadow':\s*'0\s+0\s+24px\s+4px\s+var\(--brand-secondary-default\)'/,
            );
        });

        it('returns to the resting glow at 100% (settle, not snap)', () => {
            // The 100% state matches 0% — same baseline shadow.
            // CSS animations without `animation-fill-mode: forwards`
            // hand back to the declared property value after end;
            // the 100% keyframe matching ensures there's no jump
            // at the handoff.
            const slice = getStarburstKeyframeSlice();
            expect(slice).toMatch(
                /'100%':\s*\{\s*'box-shadow':\s*'0\s+0\s+6px\s+var\(--brand-secondary-default\)'/,
            );
        });

        it('uses brand-secondary-default for the glow colour (band hue family)', () => {
            // The active band is navy (R13-PR4 secondary-brand
            // override). The bloom uses the SAME hue so it reads
            // as "the existing band, blooming outward" rather than
            // a separate signal. A primary-brand bloom would clash
            // with the navy band.
            const slice = getStarburstKeyframeSlice();
            const stopMatches =
                slice.match(/'box-shadow':\s*'[^']+'/g) ?? [];
            expect(stopMatches.length).toBeGreaterThanOrEqual(3);
            for (const stop of stopMatches) {
                expect(stop).toContain('--brand-secondary-default');
            }
        });
    });

    describe('animation entry', () => {
        it('wires `animation.nav-band-starburst` with 700ms ease-out (one-shot)', () => {
            // 700ms — the bloom needs enough time to peak and
            // settle visibly. ease-out lets the peak feel earned
            // (slow approach) and the settle feel like a breath
            // (slow release). No `infinite` — one-shot only.
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-starburst':\s*'nav-band-starburst\s+700ms\s+ease-out'/,
            );
        });

        it('does NOT use `infinite` — bloom is one-shot only', () => {
            // An infinite starburst would have the band perpetually
            // pulsing outward every 700ms. Not the intent — the
            // bloom marks a moment, not a state.
            const entryMatch = TAILWIND_CONFIG.match(
                /'nav-band-starburst':\s*'nav-band-starburst\s+[^']+'/,
            );
            expect(entryMatch).not.toBeNull();
            expect(entryMatch![0]).not.toContain('infinite');
        });
    });

    describe('nav-band-active-alive composition', () => {
        it('declares `nav-band-active-alive` as a separate animation entry', () => {
            // The active state needs its own composed animation
            // because the bloom belongs to active-only. Default
            // hover still uses `nav-band-alive` (3 tracks); active
            // uses `nav-band-active-alive` (4 tracks).
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-active-alive':\s*'[^']+'/,
            );
        });

        it('starburst is the FIRST track in the active-alive composition', () => {
            // The bloom must fire at the same instant the row
            // engages. Putting it first in the animation order
            // (and giving it the longest one-shot duration) makes
            // it the dominant visual at the start of the engage
            // moment. The reveal-sweep runs concurrently for
            // 450ms; both end before the bloom's 700ms peak-and-
            // settle finishes.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-active-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            const burstIdx = value.indexOf('nav-band-starburst');
            const revealIdx = value.indexOf('nav-band-reveal-sweep');
            expect(burstIdx).toBeGreaterThan(-1);
            expect(revealIdx).toBeGreaterThan(burstIdx);
        });

        it('preserves all four per-track durations', () => {
            // 700ms (starburst) + 450ms (reveal) + 4s (shimmer) +
            // 6s (halo-breath). Each track carries its own
            // duration explicitly so all four motions resolve
            // correctly.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-active-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            expect(value).toMatch(/nav-band-starburst\s+700ms\s+ease-out/);
            expect(value).toMatch(
                /nav-band-reveal-sweep\s+450ms\s+ease-out/,
            );
            expect(value).toMatch(
                /nav-band-shimmer\s+4s\s+ease-in-out\s+infinite/,
            );
            expect(value).toMatch(
                /nav-band-halo-breath\s+6s\s+ease-in-out\s+infinite/,
            );
        });

        it('default `nav-band-alive` does NOT include starburst', () => {
            // The bloom is the active row's signal — hover rows
            // should NOT bloom. If a future PR adds starburst to
            // `nav-band-alive` too, every hover would celebrate
            // and the active-row signal would lose its meaning.
            const defaultAliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-alive':\s*'([^']+)'/,
            );
            expect(defaultAliveMatch).not.toBeNull();
            expect(defaultAliveMatch![1]).not.toContain('nav-band-starburst');
        });
    });

    describe('NavItem active wiring', () => {
        it('NAV_ITEM_ACTIVE references the active-alive animation utility', () => {
            const activeRecipe =
                NAV_ITEM_SRC.match(
                    /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
                )?.[1] ?? '';
            expect(activeRecipe).toMatch(
                /before:animate-nav-band-active-alive\b/,
            );
        });

        it('NAV_ITEM_DEFAULT still references the non-starburst alive utility', () => {
            // The default state's hover composes the reveal +
            // shimmer + halo-breath — no bloom. Verify the
            // active-alive utility doesn't leak into the default
            // recipe.
            const defaultRecipe =
                NAV_ITEM_SRC.match(
                    /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
                )?.[1] ?? '';
            expect(defaultRecipe).toMatch(
                /hover:before:animate-nav-band-alive\b/,
            );
            expect(defaultRecipe).not.toMatch(
                /animate-nav-band-active-alive/,
            );
        });
    });
});
