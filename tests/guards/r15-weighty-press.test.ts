/**
 * Roadmap-15 PR-10 — Weighty press feedback (the click capstone).
 *
 * R13-PR8 added `active:translate-y-px` — a 1px drop on mousedown,
 * the canonical "you pressed something" tactile cue. Honest, but
 * the feedback was one-dimensional: only vertical movement, no
 * sense of the row's surface compressing under the click.
 *
 * R15-PR10 adds a SECOND active-state transform: a 1% scale-down
 * (`active:scale-[0.99]`) that fires concurrently with the
 * translate. The two transforms compose during mousedown:
 *
 *   transform: translateY(1px) scale(0.99);
 *
 * The eye reads the combination as a real physical button
 * compressing AND moving down — two dimensions of tactile
 * feedback in 75ms. Every premium product (Linear, Notion, Stripe
 * checkout) converges on this same shape: tiny translate + tiny
 * scale, fast spring back to baseline.
 *
 * Why 0.99 (not 0.95)?
 *
 *   - 0.95 visibly shrinks the row's text and icon. The label
 *     "runs away" from the cursor — the cue feels off.
 *   - 0.99 is just enough that the eye registers compression
 *     without the content changing perceivably.
 *   - The premium-product convention sits at 0.98–0.99 for
 *     row-level press feedback. 0.99 is the conservative side.
 *
 * Motion-reduce safety:
 *
 *   Both transforms need their own `motion-reduce:active:*`
 *   override. A user who's opted out of motion at the OS level
 *   gets a STATIC row at every state — no displacement, no
 *   compression. Without the scale override, the user would
 *   still see the 1% compression on mousedown.
 *
 *   `motion-reduce:active:translate-y-0` (R13-PR8 invariant)
 *   `motion-reduce:active:scale-100`     (R15-PR10 addition)
 *
 * Channel reaffirmation:
 *
 *   These two transforms are the ONLY transforms the sidebar
 *   allows. Hover lift, scale-on-hover, translate on focus —
 *   all still banned by the motion-language ratchet. The carve-
 *   out is mousedown-only.
 *
 * What this ratchet does NOT police:
 *
 *   - The exact scale value (0.99). Future tune to 0.98 stays
 *     within "subtle compression, no content shift" intent.
 *   - The exact transition duration (75ms). The R13-PR8
 *     ratchet locks duration; this ratchet only adds the scale
 *     dimension.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAV_ITEM_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);

describe('Roadmap-15 PR-10 — weighty press feedback', () => {
    /**
     * Capture the NAV_ITEM_BASE region from the source. The
     * geometry + state-base tokens live inside the
     * `[..].join(' ')` array, so we slice the whole block.
     */
    const baseRegion =
        NAV_ITEM_SRC.match(
            /export\s+const\s+NAV_ITEM_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
        )?.[0] ?? '';

    describe('active-state transforms (mousedown carve-out)', () => {
        it('preserves the R13-PR8 `active:translate-y-px` (1px drop)', () => {
            // The translate is the original press cue. R15-PR10
            // ADDS to it — does NOT replace it. A regression that
            // swaps translate for scale would lose the vertical
            // movement that signals "going down".
            expect(baseRegion).toMatch(/\bactive:translate-y-px\b/);
        });

        it('adds the R15-PR10 `active:scale-[0.99]` (1% compression)', () => {
            // The scale is the new compression cue. Combined with
            // the translate, the row reads as a real physical
            // button being pressed.
            expect(baseRegion).toMatch(/\bactive:scale-\[0\.99\]/);
        });

        it('both transforms appear in the SAME class string (composed shorthand)', () => {
            // CSS composes multiple `transform` values into a
            // single transform-function list. Both Tailwind
            // classes need to coexist on the same element so the
            // composed transform fires on a single state change.
            // A regression that splits them across BASE + DEFAULT
            // would break composition.
            //
            // Anchor the match on the literal `transition-transform`
            // opening of the press-feedback line so the regex
            // doesn't pick up an unintended `'...'` span across
            // doc-comment apostrophes.
            const transformLine = baseRegion.match(
                /'transition-transform\s+duration-75\s+ease-out[^']+'/,
            )?.[0];
            expect(transformLine).toBeDefined();
            expect(transformLine).toMatch(/active:translate-y-px/);
            expect(transformLine).toMatch(/active:scale-\[0\.99\]/);
        });
    });

    describe('motion-reduce safety net (per-transform override)', () => {
        it('preserves `motion-reduce:active:translate-y-0` (R13-PR8 invariant)', () => {
            // The translate's OS-preference override. Without
            // this, a motion-reduced user would still see the
            // 1px drop.
            expect(baseRegion).toMatch(/motion-reduce:active:translate-y-0/);
        });

        it('adds `motion-reduce:active:scale-100` for the new scale transform', () => {
            // The scale's OS-preference override. Snaps back to
            // identity on motion-reduced users. Load-bearing
            // because the `transform` shorthand composes both
            // values; an unbounded `scale-[0.99]` would still
            // fire even when the translate is `0`.
            expect(baseRegion).toMatch(/motion-reduce:active:scale-100/);
        });
    });

    describe('shared press transition still tempo-locked', () => {
        it('uses `transition-transform` (not transition-all)', () => {
            // The R12/R13 motion-language rule is "name the
            // property". `transition-transform` includes both
            // translate AND scale composition in one declaration.
            expect(baseRegion).toMatch(/\btransition-transform\b/);
        });

        it('preserves the R13-PR8 75ms duration', () => {
            // The press is snappy — 75ms gives the down-press the
            // feel of a real button click. Slower would feel
            // mushy; faster would not register as a press at all.
            expect(baseRegion).toMatch(/\bduration-75\b/);
        });

        it('preserves the ease-out curve (R13-PR8 invariant)', () => {
            // ease-out lands the press position softly rather
            // than slamming the row down. The release after
            // mouseup runs the same curve in reverse — the row
            // springs back smoothly.
            expect(baseRegion).toMatch(/\bease-out\b/);
        });
    });

    describe('no other transforms appear at non-active states', () => {
        it('NAV_ITEM_BASE does NOT contain `hover:scale-` (lift ban preserved)', () => {
            // R13-PR8's "ONE transform" rule was "active only".
            // R15-PR10 extends to "TWO transforms, both active
            // only". Hover-scale, hover-translate, focus-scale
            // remain banned at every level of the sidebar.
            expect(baseRegion).not.toMatch(/\bhover:scale-/);
            expect(baseRegion).not.toMatch(/\bhover:translate-/);
            expect(baseRegion).not.toMatch(/\bhover:-translate-/);
            expect(baseRegion).not.toMatch(/\bfocus-visible:scale-/);
            expect(baseRegion).not.toMatch(/\bfocus-visible:translate-/);
        });
    });
});
