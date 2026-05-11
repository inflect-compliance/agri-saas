/**
 * Roadmap-12 PR-5 — NavItem brand-gradient band discipline.
 *
 * Hover/active rows are signalled by a 3-px wide, capsule-shaped
 * brand-gradient band pinned to the LEFT of the row — not by a
 * full-row hover tint. The band is a `::before` pseudo-element on
 * the `<Link>`, fading from opacity 0 (default) to opacity 100
 * (hover or active).
 *
 * Five invariants matter:
 *
 *   1. The `::before` pseudo is positioned absolute, pinned to
 *      `left-0`, inset `top-1.5 bottom-1.5` from the edges
 *      (giving it the capsule shape — jewellery, not ruler).
 *
 *   2. Width is exactly `3px` — narrow enough to feel like
 *      decoration, wide enough for the gradient to read.
 *
 *   3. Right edge is `rounded-r-full` — the capsule's tail.
 *      Without it the band would feel like a square stamp.
 *
 *   4. The gradient runs vertical (`to-b`) from `--brand-default`
 *      (top) to `--brand-emphasis` (bottom). Two stops, same hue
 *      family — fluid deepening, not a rainbow.
 *
 *   5. The transition is opacity-only at 200ms ease-out. The
 *      motion-language ratchet bans transform / scale / translate
 *      product-wide; this ratchet locks opacity + duration at the
 *      primitive level too.
 *
 * What this ratchet does NOT police
 *
 *   - The exact pixel width or inset values. R12 future PRs can
 *     tune (3→4px, 1.5→2 inset) — but the SHAPE of the recipe is
 *     locked.
 *   - Where the band is consumed (hover vs active). Those live in
 *     `NAV_ITEM_DEFAULT` / `NAV_ITEM_ACTIVE` and are covered by
 *     the default-state + (eventually) active-state ratchets.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);

describe('Roadmap-12 PR-5 — NavItem brand-gradient band discipline', () => {
    it('positions the `::before` band capsule on the left edge', () => {
        // Absolute positioning + left-0 + inset top/bottom.
        expect(SRC).toMatch(/before:absolute/);
        expect(SRC).toMatch(/before:left-0/);
        // `top-1.5 bottom-1.5` = 6px inset top/bottom. Future PRs
        // can tune the inset; for now the recipe is locked.
        expect(SRC).toMatch(/before:top-1\.5/);
        expect(SRC).toMatch(/before:bottom-1\.5/);
    });

    it('uses exactly 3px width', () => {
        // Narrow enough to feel like decoration, wide enough for
        // the gradient to read. Pre-R12-PR5 the recipe was 2px
        // (a hard `border-l-2`). 3 is the sweet spot for a
        // gradient that needs to "glow".
        expect(SRC).toMatch(/before:w-\[3px\]/);
    });

    it('has a rounded right edge (capsule tail)', () => {
        // `rounded-r-full` gives the band its capsule shape.
        // Without it the band feels like a square stamp.
        expect(SRC).toMatch(/before:rounded-r-full/);
    });

    it('paints a vertical brand-gradient (default → emphasis)', () => {
        // Two stops, same hue family, vertical (`to-b`). The
        // gradient deepens top → bottom — reads as quiet fluid
        // intensification.
        expect(SRC).toMatch(/before:bg-gradient-to-b/);
        expect(SRC).toMatch(
            /before:from-\[var\(--brand-default\)\]/,
        );
        expect(SRC).toMatch(
            /before:to-\[var\(--brand-emphasis\)\]/,
        );
    });

    it('defaults to opacity 0 and transitions opacity only', () => {
        // The band is invisible until hover/active triggers it.
        // Transition is opacity (not transform), 200ms ease-out
        // — one rung slower than the 150ms text-colour transition
        // so the band wakes JUST after the label brightens.
        expect(SRC).toMatch(/before:opacity-0\b/);
        expect(SRC).toMatch(/before:transition-opacity/);
        expect(SRC).toMatch(/before:duration-200/);
        expect(SRC).toMatch(/before:ease-out/);
    });

    it('NAV_ITEM_BASE includes `relative` to anchor the `::before` pseudo', () => {
        // Without `position: relative` on the parent, the
        // `::before absolute` would escape to the next positioned
        // ancestor. The band has to anchor to the row.
        const baseRegion = SRC.match(
            /export\s+const\s+NAV_ITEM_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
        );
        expect(baseRegion).not.toBeNull();
        expect(baseRegion![0]).toMatch(/['"]relative\s+flex/);
    });

    it('hover state fades the band in (opacity 0 → 100)', () => {
        // The default state recipe applies `hover:before:opacity-100`.
        // This is how the band becomes visible on hover.
        const defaultRecipe = SRC.match(
            /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
        );
        expect(defaultRecipe).not.toBeNull();
        expect(defaultRecipe![1]).toMatch(/hover:before:opacity-100/);
    });

    it('active state holds the band visible (opacity 100)', () => {
        // The active state recipe sets `before:opacity-100`
        // unconditionally. This is the "always lit" state for the
        // current page.
        const activeRecipe = SRC.match(
            /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
        );
        expect(activeRecipe).not.toBeNull();
        // Match `before:opacity-100` but NOT `hover:before:opacity-100`
        // (that's the default-state mechanism).
        expect(activeRecipe![1]).toMatch(/(?<!hover:)\bbefore:opacity-100\b/);
    });

    it('the retired pre-R12-PR5 left-border slot is gone', () => {
        // The old mechanism was `border-l-2 border-l-transparent`
        // on BASE + `border-l-[var(--brand-default)]` on ACTIVE.
        // R12-PR5 replaced this with the band. The old tokens
        // must not co-exist (would double-render the left edge).
        const baseRegion = SRC.match(
            /export\s+const\s+NAV_ITEM_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
        );
        expect(baseRegion).not.toBeNull();
        expect(baseRegion![0]).not.toMatch(/border-l-2/);
        // ACTIVE no longer references the brand-default border.
        const activeRecipe = SRC.match(
            /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
        );
        expect(activeRecipe).not.toBeNull();
        expect(activeRecipe![1]).not.toMatch(
            /border-l-\[var\(--brand-default\)\]/,
        );
    });
});
