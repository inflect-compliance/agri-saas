/**
 * Roadmap-2 PR-5 — right-rail master-detail discipline.
 *
 * Detail pages used to scroll: hero, tabs, full-bleed body. On
 * desktop the right 25-30% of the viewport was empty. After PR-5,
 * `<EntityDetailLayout>` carries an opt-in `rail` slot that splits
 * the body into main + rail at xl (1280px+) viewports.
 *
 * What this ratchet locks in
 *   1. The shell carries the `rail` prop in its public props
 *      type — the slot is stable, not implicit.
 *   2. The shell renders an `<aside>` with the canonical
 *      `data-testid="entity-detail-rail"` when a rail is provided.
 *      A future "simplify" PR that drops the aside is silently
 *      losing the master-detail composition; the ratchet shouts.
 *   3. The proof-of-pattern adoption — the risks detail page —
 *      still passes a `rail` prop. Removing it returns the page
 *      to single-column flow.
 *
 * What this ratchet does NOT police
 *   The exact rail content (linked tasks, activity, quick actions)
 *   stays under the page's editorial control. The ratchet only
 *   asserts the rail SLOT is filled, not what fills it.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const SHELL_PATH = 'src/components/layout/EntityDetailLayout.tsx';
const RISKS_DETAIL_PATH =
    'src/app/t/[tenantSlug]/(app)/risks/[riskId]/page.tsx';

describe('Right-rail master-detail discipline (Roadmap-2 PR-5)', () => {
    it('EntityDetailLayout exposes a `rail` prop in its public type', () => {
        const src = read(SHELL_PATH);
        // The slot must be in the exported props interface — not
        // an internal-only field. Future call sites compile-check
        // against the union; a silent removal is a TypeScript
        // error at the call site.
        expect(src).toMatch(/rail\?:\s*ReactNode/);
    });

    it('EntityDetailLayout renders the rail aside with the canonical test-id', () => {
        const src = read(SHELL_PATH);
        // The aside MUST be a real <aside aria-label="Context"> so
        // screen readers announce the column distinctly. Removing
        // the role/label would degrade a11y silently.
        expect(src).toMatch(
            /<aside[\s\S]*?aria-label=["']Context["'][\s\S]*?data-testid=["']entity-detail-rail["']/,
        );
    });

    it('the rail layout activates at the xl breakpoint, not at md/lg', () => {
        // xl = 1280px in Tailwind's default scale. Activating
        // master-detail at md (768px) would crowd a tablet
        // viewport; lg (1024px) is the minimum to host a 320px
        // rail comfortably; xl is the editorial choice — it gives
        // the main column the room to breathe at common
        // 1440px laptop widths AND leaves laptops at 1280px with
        // a workable layout.
        //
        // Right-rail Phase 1: the body became a flex row at xl+
        // (was a fixed `grid-cols-[minmax(0,1fr)_320px]` track).
        // `<AsidePanel>` now owns the rail's own width — 320px
        // expanded, 44px collapsed-to-spine — so a fixed grid
        // track would fight the panel's collapse state. The
        // breakpoint stays xl.
        const src = read(SHELL_PATH);
        expect(src).toMatch(/xl:flex-row/);
        expect(src).not.toMatch(
            /md:grid-cols|lg:grid-cols|md:flex-row|lg:flex-row/,
        );
    });

    it('risks detail page passes a rail (proof-of-pattern adoption)', () => {
        // The risks detail page is the canonical adopter — see
        // commit message + docs. Future PRs may add more pages
        // to the rail; removing risks is a regression.
        const src = read(RISKS_DETAIL_PATH);
        expect(src).toMatch(/<EntityDetailLayout[\s\S]*?\brail=\{/);
    });
});
