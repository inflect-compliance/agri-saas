/**
 * Sidebar collapse (icon-rail) ratchet.
 *
 * The desktop sidebar collapses to a 56px icon rail via a persisted toggle.
 * Locks the wiring so a refactor can't silently drop it:
 *   - a collapse context broadcasts the flag to the nav primitives,
 *   - NavItem hides its label + tooltips it when collapsed,
 *   - AppShell persists the state, drives the aside width, and provides the
 *     context (false for the mobile drawer),
 *   - both sidebars render the toggle.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

describe('sidebar collapse / icon rail', () => {
    it('the collapse context exists', () => {
        expect(exists('src/components/layout/sidebar-collapse-context.tsx')).toBe(true);
        const ctx = read('src/components/layout/sidebar-collapse-context.tsx');
        expect(ctx).toMatch(/export function SidebarCollapseProvider/);
        expect(ctx).toMatch(/export function useSidebarCollapsed/);
    });

    it('NavItem collapses to an icon + tooltip', () => {
        const src = read('src/components/layout/nav-item.tsx');
        expect(src).toMatch(/useSidebarCollapsed/);
        // label is conditional on NOT collapsed; collapsed wraps in a Tooltip.
        expect(src).toMatch(/!collapsed &&[\s\S]*?\{label\}/);
        expect(src).toMatch(/<Tooltip content=\{label\} side="right">/);
    });

    it('AppShell persists the state, drives the aside width, + provides the context', () => {
        const src = read('src/components/layout/AppShell.tsx');
        expect(src).toMatch(/useLocalStorage\(\s*['"]inflect:sidebar-collapsed['"]/);
        expect(src).toMatch(/SidebarCollapseProvider/);
        // collapsed → narrow rail (w-14), expanded → thinner sidebar (w-52).
        expect(src).toMatch(/md:w-14/);
        expect(src).toMatch(/md:w-52/);
        // mobile drawer is never collapsed.
        expect(src).toMatch(/SidebarCollapseProvider collapsed=\{false\}/);
    });

    it('both sidebars render the collapse toggle', () => {
        for (const f of ['SidebarNav.tsx', 'OrgSidebarNav.tsx']) {
            const src = read(`src/components/layout/${f}`);
            expect(src).toMatch(/onToggleCollapse/);
            expect(src).toMatch(/data-testid="sidebar-collapse-toggle"/);
            expect(src).toMatch(/PanelLeftOpen|PanelLeftClose/);
        }
    });
});
