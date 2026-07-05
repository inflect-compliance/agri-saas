/**
 * Roadmap-14 PR-4 — `<TenantSwitcher>` discipline.
 *
 * Replaces the pre-R14 passive `<TenantIdentityPill>` (a `<Link>`
 * to `/tenants`) with an inline popover-driven switcher. The trigger
 * pill stays visually identical (continuity); a click now opens a
 * dropdown listing every tenant the user belongs to, with the
 * active one marked, and the choice is one keystroke away.
 *
 * Six load-bearing invariants:
 *
 *   1. The component exports `TenantSwitcher` as a named export
 *      from `src/components/layout/tenant-switcher.tsx`.
 *
 *   2. The trigger is a `<button type="button">` (not a `<Link>`)
 *      with the canonical ARIA popover attributes (`aria-haspopup`,
 *      `aria-expanded`). Pre-R14 mounted a `<Link>` which conflicted
 *      with the `<Popover>` trigger semantics.
 *
 *   3. The popover lists memberships from `session.user.memberships`
 *      (the same source the `/tenants` picker uses). Lazy — no
 *      fetch on first paint; the JWT cookie already carries the
 *      data by the time the switcher mounts.
 *
 *   4. The active tenant row is marked with `aria-current="page"`
 *      AND a visible check icon. Both pieces are required: aria-
 *      current is the assistive-tech signal, the check is the
 *      sighted-user signal.
 *
 *   5. The popover carries a footer "Manage workspaces" link to
 *      `/tenants` (the unified picker page). Belt-and-braces with
 *      the inline switcher — a user with permission issues or
 *      stale JWT data can still reach the picker.
 *
 *   6. `<TopChrome>` mounts `TenantSwitcher` in the tenant variant
 *      (replacing `TenantIdentityPill`). Org variant continues to
 *      mount `OrgIdentityPill` (out of scope for PR-4).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SWITCHER_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/tenant-switcher.tsx'),
    'utf8',
);
const TOP_CHROME_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/TopChrome.tsx'),
    'utf8',
);

describe('Roadmap-14 PR-4 — TenantSwitcher discipline', () => {
    describe('component', () => {
        it('exports `TenantSwitcher` as a named export', () => {
            expect(SWITCHER_SRC).toMatch(
                /export\s+function\s+TenantSwitcher\b/,
            );
        });

        it('accepts memberships as a prop (NOT via useSession)', () => {
            // The codebase deliberately does NOT mount a
            // <SessionProvider> client-side (see the rationale in
            // src/app/providers.tsx). The R14-PR4 original called
            // useSession() — the hotfix threads memberships in as
            // a prop from the server-side layout via AppShell →
            // TopChrome → here.
            //
            // useSession imports are explicitly banned in this
            // file (regression class: re-adding the provider-
            // dependent call).
            expect(SWITCHER_SRC).not.toMatch(
                /import\s+\{[^}]*\buseSession\b[^}]*\}\s+from\s+['"]next-auth\/react['"]/,
            );
            expect(SWITCHER_SRC).toMatch(
                /export\s+interface\s+TenantSwitcherProps\s*\{[\s\S]+?memberships:/,
            );
        });

        it('reads the active tenant from `useTenantContext`', () => {
            // The active tenant slug + name come from the route's
            // tenant context (server-resolved, threaded through
            // TenantProvider). NOT from the membership list — the
            // current tenant is whichever URL slug the user is
            // viewing, not whichever JWT entry happens to be first.
            expect(SWITCHER_SRC).toMatch(
                /from\s+['"]@\/lib\/tenant-context-provider['"]/,
            );
            expect(SWITCHER_SRC).toMatch(/useTenantContext\(\)/);
        });
    });

    describe('trigger button', () => {
        it('uses `<button type="button">` (not `<Link>`)', () => {
            // The trigger must be a button — `<Popover>` attaches
            // its open-on-click handler to the trigger child. A
            // `<Link>` here would navigate on click instead of
            // opening the popover (the R2 pill behaviour we are
            // explicitly replacing).
            expect(SWITCHER_SRC).toMatch(
                /<button[\s\S]+?type="button"/,
            );
        });

        it('carries `aria-haspopup="menu"` + `aria-expanded={open}`', () => {
            // Canonical ARIA popover semantics. Without `haspopup`
            // screen readers announce the trigger as a plain button;
            // without `aria-expanded` keyboard users can't tell
            // whether the menu is open.
            expect(SWITCHER_SRC).toMatch(/aria-haspopup="menu"/);
            expect(SWITCHER_SRC).toMatch(/aria-expanded=\{open\}/);
        });

        it('carries `data-testid="top-chrome-tenant-switcher"`', () => {
            // Playwright + structural tests bind to this. The
            // pre-R14 selector was `top-chrome-tenant-pill`; PR-4
            // renames as the contract changed.
            expect(SWITCHER_SRC).toMatch(
                /data-testid="top-chrome-tenant-switcher"/,
            );
        });
    });

    describe('membership list', () => {
        it('marks the active row with `aria-current="page"`', () => {
            // Assistive-tech signal — the active tenant is where
            // the user is RIGHT NOW. `aria-current` is the
            // canonical attribute for the current location in a
            // navigation list.
            expect(SWITCHER_SRC).toMatch(
                /aria-current=\{isActive\s*\?\s*['"]page['"]\s*:\s*undefined\}/,
            );
        });

        it('shows a visible check icon on the active row', () => {
            // Sighted-user signal. `aria-current` is invisible; the
            // check is the visible marker.
            expect(SWITCHER_SRC).toMatch(/<Check\b/);
            // The check is brand-coloured so the active row reads
            // as "this is the highlighted one" without competing
            // with the brand-subtle row bg.
            expect(SWITCHER_SRC).toMatch(
                /text-\[var\(--brand-default\)\]/,
            );
        });

        it('each row has a deterministic test-id `tenant-switcher-row-<slug>`', () => {
            expect(SWITCHER_SRC).toMatch(
                /data-testid=\{?`tenant-switcher-row-\$\{m\.slug\}`/,
            );
        });
    });

    describe('footer', () => {
        it('renders a `Manage workspaces` link to `/tenants`', () => {
            // Belt-and-braces. A user whose JWT memberships are
            // stale can still reach the canonical picker page.
            // i18n (T04): the footer copy routes through next-intl
            // (switcher.manageWorkspaces).
            expect(SWITCHER_SRC).toMatch(
                /href="\/tenants"[\s\S]+?t\(['"]manageWorkspaces['"]\)/,
            );
        });

        it('renders a `Popover.Separator` above the footer', () => {
            // Visual separation between the membership list and the
            // footer link. The Separator primitive enforces token-
            // aligned styling — a hand-rolled `<hr>` here would
            // drift from the rest of the popover vocabulary.
            expect(SWITCHER_SRC).toMatch(/<Popover\.Separator\b/);
        });
    });

    describe('TopChrome wiring', () => {
        it('imports TenantSwitcher from `./tenant-switcher`', () => {
            expect(TOP_CHROME_SRC).toMatch(
                /import\s+\{\s*TenantSwitcher\s*\}\s+from\s+['"]\.\/tenant-switcher['"]/,
            );
        });

        it('mounts TenantSwitcher in the tenant variant', () => {
            // The variant picks: tenant → <TenantSwitcher>,
            // org → <OrgIdentityPill>. After the R14 hotfix the
            // selection moved from a ternary on a Component
            // variable to a `renderIdentity()` helper (so the
            // memberships prop could be threaded only to the
            // tenant branch). Both names are required to appear;
            // the relative order is enforced separately.
            expect(TOP_CHROME_SRC).toMatch(/<TenantSwitcher\b/);
            expect(TOP_CHROME_SRC).toMatch(/<OrgIdentityPill\b/);
        });

        it('no longer imports the retired `TenantIdentityPill`', () => {
            // The R2 pill is dead on the tenant side. A future
            // regression that re-imports it would re-mount the
            // passive affordance alongside the switcher and confuse
            // every user.
            expect(TOP_CHROME_SRC).not.toMatch(
                /\bTenantIdentityPill\b/,
            );
        });
    });
});
