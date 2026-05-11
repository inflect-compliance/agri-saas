/**
 * Elevation PR-3 — sidebar state-language ratchet.
 *
 * Locks two invariants on the sidebar:
 *
 *   1. SidebarNav.tsx does NOT reference the legacy `nav-link` /
 *      `nav-link-label` CSS classes. The state language (default /
 *      hover / active / focus-visible) lives inline as Tailwind
 *      tokens so it participates in the design-system ratchets
 *      (Polish PR-8 hover-state, Polish PR-9 motion-language).
 *
 *   2. globals.css does NOT redefine `.nav-link`. The CSS rule was
 *      retired by Elevation PR-3 — re-introducing it would silently
 *      pull a sidebar consumer back into the un-ratcheted CSS layer.
 *
 *   3. The mobile drawer close button has a focus ring
 *      (`focus-visible:ring-2`). Keyboard accessibility on a
 *      load-bearing UI affordance.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SIDEBAR = 'src/components/layout/SidebarNav.tsx';
const GLOBALS = 'src/app/globals.css';

describe('Sidebar state-language ratchet (Elevation PR-3)', () => {
    it('SidebarNav.tsx does not reference the retired nav-link / nav-link-label CSS classes', () => {
        const abs = path.resolve(ROOT, SIDEBAR);
        expect(fs.existsSync(abs)).toBe(true);
        const content = fs.readFileSync(abs, 'utf8');
        // Allow `nav-link` to appear in JSDoc comments; ban only
        // className attribute uses.
        const usagePatterns = [
            /className=[`"][^`"]*\bnav-link\b/,
            /className=[`"][^`"]*\bnav-link-label\b/,
        ];
        for (const re of usagePatterns) {
            expect(content).not.toMatch(re);
        }
    });

    it('globals.css does not redefine `.nav-link`', () => {
        const abs = path.resolve(ROOT, GLOBALS);
        const content = fs.readFileSync(abs, 'utf8');
        // The retired ruleset shape: `.nav-link {` or `.nav-link.active {`.
        expect(content).not.toMatch(/^\s*\.nav-link\b[^*]/m);
    });

    it('the mobile drawer close button has a focus-visible ring', () => {
        const abs = path.resolve(ROOT, SIDEBAR);
        const content = fs.readFileSync(abs, 'utf8');
        // Find the close button block by its data-testid.
        const closeBlockMatch = content.match(
            /data-testid="nav-drawer-close"[\s\S]{0,400}/,
        );
        expect(closeBlockMatch).not.toBeNull();
        // The block (or surrounding className) must reference a
        // focus-visible ring token.
        const closeContext = closeBlockMatch?.[0] ?? '';
        const surroundingMatch = content.match(
            /<button[^>]*className=[`"][^`"]*[\s\S]{0,400}data-testid="nav-drawer-close"/,
        );
        const region = `${surroundingMatch?.[0] ?? ''}\n${closeContext}`;
        expect(region).toMatch(/focus-visible:ring-2/);
    });

    it('the NavItem primitive uses the canonical hover/active state shape', () => {
        // R12-PR1 extracted the state recipe from `SidebarNav.tsx`
        // into `nav-item.tsx`.
        // R12-PR4 dropped the `/50` alpha on the hover bg.
        // R12-PR5 retired the full-row hover bg entirely —
        //   the hover signal is now a 3px brand-gradient capsule
        //   band on the left, faded in via opacity transition on
        //   a `::before` pseudo-element. Both hover AND active
        //   states reveal the band; active adds the bg-brand-
        //   subtle wash for "settled in" conviction.
        const navItem = fs.readFileSync(
            path.resolve(ROOT, 'src/components/layout/nav-item.tsx'),
            'utf8',
        );
        // The brand-gradient band recipe (the `::before` element).
        expect(navItem).toMatch(
            /before:bg-gradient-to-b\s+before:from-\[var\(--brand-default\)\]\s+before:to-\[var\(--brand-emphasis\)\]/,
        );
        // Hover: band fades in via opacity 100 on `::before`.
        expect(navItem).toMatch(/hover:before:opacity-100/);
        // Active: band stays visible + brand-subtle background.
        expect(navItem).toMatch(/\bbefore:opacity-100\b/);
        expect(navItem).toMatch(/bg-\[var\(--brand-subtle\)\]/);
        // Motion: transition-colors duration-150 (motion-language).
        expect(navItem).toMatch(/transition-colors\s+duration-150/);
    });
});
