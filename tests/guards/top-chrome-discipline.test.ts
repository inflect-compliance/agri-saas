/**
 * Roadmap-2 PR-2 — top-chrome discipline.
 *
 * The chrome is the load-bearing premium-feel surface added in this
 * roadmap pass. Three things must remain true for the affordance
 * to keep working as the codebase evolves:
 *
 *   1. The shell mounts the chrome AND wraps its children in the
 *      breadcrumbs provider. Without the provider the
 *      `useBreadcrumbs` hook falls back to a silent no-op and the
 *      chrome renders an empty trail forever.
 *   2. The chrome itself mounts the three canonical regions:
 *      breadcrumbs, search anchor, identity pill. A future PR that
 *      removes any of them is collapsing the chrome's contract —
 *      ratchet fails so the diff is loud.
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

    it('TopChrome renders breadcrumbs + search anchor + identity pill', () => {
        const src = read('src/components/layout/TopChrome.tsx');
        // Each region is owned by a named component or a direct
        // `<Breadcrumbs>` mount. The ratchet binds to the names
        // not the layout, so a future visual refactor can move
        // them around without breaking the contract.
        expect(src).toMatch(/<Breadcrumbs\b/);
        expect(src).toMatch(/<SearchAnchor\b/);
        // Either pill must be possible — TopChrome picks one based
        // on variant. The ratchet asserts both names appear in
        // the import list so a future PR can't silently drop one.
        expect(src).toMatch(/TenantIdentityPill/);
        expect(src).toMatch(/OrgIdentityPill/);
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

    it('SearchAnchor opens the existing command palette', () => {
        // Wiring through `useCommandPalette` keeps the chrome from
        // owning a second palette — there is one canonical palette
        // and one anchor that opens it.
        const src = read('src/components/layout/SearchAnchor.tsx');
        expect(src).toMatch(
            /from\s+['"]@\/components\/command-palette\/command-palette-provider['"]/,
        );
        expect(src).toMatch(/useCommandPalette/);
    });

    it('TopChrome is hidden on mobile (avoids two-bar pile-up)', () => {
        // The chrome is the desktop affordance; mobile already has
        // the in-shell mobile top bar. Stacking both eats vertical
        // space the mobile UX cannot spare.
        const src = read('src/components/layout/TopChrome.tsx');
        expect(src).toMatch(/hidden\s+md:flex/);
    });
});
