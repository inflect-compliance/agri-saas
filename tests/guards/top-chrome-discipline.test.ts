/**
 * Roadmap-2 PR-2 — top-chrome discipline (PR-11 simplification).
 *
 * The chrome is the load-bearing premium-feel surface added in
 * this roadmap pass. Three things must remain true for the
 * affordance to keep working as the codebase evolves:
 *
 *   1. The shell mounts the chrome AND wraps its children in the
 *      breadcrumbs provider. Without the provider the
 *      `useBreadcrumbs` hook falls back to a silent no-op and the
 *      chrome renders an empty trail forever.
 *   2. The chrome mounts both canonical regions: breadcrumbs
 *      (left) + identity pill (right). The center search-anchor
 *      was retired in PR-11 — the sidebar's inline command opener
 *      (PR-3) is the canonical search affordance. A future PR
 *      that removes EITHER remaining region collapses the
 *      chrome's contract — ratchet fails so the diff is loud.
 *   3. `<PageHeader>` pushes its breadcrumbs into the context.
 *      Removing this call (e.g. "let pages call useBreadcrumbs
 *      directly") would silently break every existing page that
 *      passes breadcrumbs to the page header.
 *
 * What this ratchet does NOT police
 *   The unauth/print surfaces (login, error, no-tenant, not-found,
 *   SoAPrintView) intentionally render outside `<AppShell>` and
 *   therefore have no chrome. They never call `useBreadcrumbs`
 *   either, so the context's silent no-op is the desired
 *   behaviour there.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('Top-chrome discipline (Roadmap-2 PR-2)', () => {
    it('AppShell mounts <TopChrome> and wraps children in <BreadcrumbsProvider>', () => {
        const src = read('src/components/layout/AppShell.tsx');
        expect(src).toMatch(/from\s+['"]\.\/breadcrumbs-store['"]/);
        expect(src).toMatch(/from\s+['"]\.\/TopChrome['"]/);
        expect(src).toMatch(/<BreadcrumbsProvider>/);
        expect(src).toMatch(/<TopChrome\b/);
    });

    it('TopChrome renders breadcrumbs + identity pill', () => {
        const src = read('src/components/layout/TopChrome.tsx');
        // Each region is owned by a named component or a direct
        // `<Breadcrumbs>` mount. The ratchet binds to the names
        // not the layout, so a future visual refactor can move
        // them around without breaking the contract.
        expect(src).toMatch(/<Breadcrumbs\b/);
        // Either pill must be possible — TopChrome picks one based
        // on variant. The ratchet asserts both names appear in
        // the import list so a future PR can't silently drop one.
        expect(src).toMatch(/TenantIdentityPill/);
        expect(src).toMatch(/OrgIdentityPill/);
    });

    it('TopChrome no longer mounts the search anchor', () => {
        // Roadmap-2 PR-11 retired the center search-anchor. The
        // sidebar's inline command opener (PR-3) is the canonical
        // search affordance now. Re-introducing the chrome anchor
        // would re-create the visual noise that PR-11 deliberately
        // removed.
        const src = read('src/components/layout/TopChrome.tsx');
        expect(src).not.toMatch(/<SearchAnchor\b/);
        expect(src).not.toMatch(/from\s+['"]\.\/SearchAnchor['"]/);
    });

    it('breadcrumbs-store exports the provider + hook + reader', () => {
        const src = read('src/components/layout/breadcrumbs-store.tsx');
        expect(src).toMatch(/export function BreadcrumbsProvider/);
        expect(src).toMatch(/export function useBreadcrumbs/);
        expect(src).toMatch(/export function useCurrentBreadcrumbs/);
    });

    it('PageHeader pushes breadcrumbs into the chrome context', () => {
        const src = read('src/components/layout/PageHeader.tsx');
        expect(src).toMatch(
            /from\s+['"]@\/components\/layout\/breadcrumbs-store['"]/,
        );
        // The hook must be called inside the component body —
        // exact-call match instead of a string scan keeps "import
        // but never call" from passing.
        expect(src).toMatch(/useBreadcrumbs\s*\(/);
    });

    it('TopChrome is hidden on mobile (avoids two-bar pile-up)', () => {
        // The chrome is the desktop affordance; mobile already has
        // the in-shell mobile top bar. Stacking both eats vertical
        // space the mobile UX cannot spare.
        //
        // R14-PR1 extracted the shell into `<NavBar>` — the
        // `hidden md:flex` responsibility moved with it. The
        // assertion follows: it now checks `nav-bar.tsx`'s
        // SHELL recipe, not `TopChrome.tsx`. R14-PR12 will unify
        // mobile + desktop and retire this assertion entirely.
        const src = read('src/components/layout/nav-bar.tsx');
        expect(src).toMatch(/hidden\s+md:flex/);
    });
});
