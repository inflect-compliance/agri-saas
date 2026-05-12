'use client';

/**
 * TopChrome — Roadmap-2 PR-2 (PR-11 simplification, R14-PR1
 * primitive extraction).
 *
 * Thin consumer of the `<NavBar>` primitive. Reads page-scoped
 * data via two contexts and fills the structural slots:
 *
 *   • Left slot   — breadcrumbs (from `useCurrentBreadcrumbs`).
 *     R14-PR3 adds the brand mark before breadcrumbs.
 *     R14-PR9 adds the env badge between brand + breadcrumbs.
 *
 *   • Centre slot — empty in PR-1.
 *     R14-PR6 fills with the ⌘K search anchor.
 *
 *   • Right slot  — context identity pill (tenant or org name).
 *     R14-PR4 replaces this with the workspace switcher.
 *     R14-PR5 adds the user menu.
 *     R14-PR7 adds the notifications bell.
 *
 * The chrome is mounted once by `<AppShell>` and routes through
 * the variant-specific identity context. R14-PR4 evolved the
 * tenant variant from the passive R2 identity pill to a
 * `<TenantSwitcher>` popover; the org variant continues to mount
 * the passive `<OrgIdentityPill>` until a future PR extends. Each
 * affordance calls its own context hook (`useTenantContext` /
 * `useOrgContext`) unconditionally and never throws — AppShell's
 * `variant` prop picks the right one for the route.
 *
 * Mobile (<md): the chrome is hidden — the pre-existing mobile top
 * bar inside `<AppShell>` continues to handle nav-toggle + theme.
 * R14-PR12 unifies the two; until then the mobile bar is the
 * authoritative mobile surface.
 */
import { useParams } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { useCurrentBreadcrumbs } from './breadcrumbs-store';
import { OrgIdentityPill } from './IdentityPill';
import { TenantSwitcher } from './tenant-switcher';
import { UserMenu } from './user-menu';
import type { AppShellVariant } from './AppShell';
import { NavBar, NavBarBrand } from './nav-bar';

interface TopChromeProps {
    variant: AppShellVariant;
}

/**
 * Sticky top chrome. Hidden on mobile to preserve vertical space —
 * the existing mobile top bar in `<AppShell>` is a load-bearing
 * surface there.
 *
 * R14-PR3 adds the animated brand mark before breadcrumbs in the
 * left slot. The mark's destination href is computed from the
 * variant + URL params: tenant → `/t/<slug>/dashboard`,
 * org → `/org/<slug>` (org root).
 */
export function TopChrome({ variant }: TopChromeProps) {
    const breadcrumbs = useCurrentBreadcrumbs();
    const params = useParams();
    // R14-PR4 — tenant variant now mounts the workspace switcher
    // (popover-driven). Org variant continues to mount the passive
    // identity pill until a future PR extends the switcher pattern
    // to organizations.
    const Identity =
        variant === 'org' ? OrgIdentityPill : TenantSwitcher;

    // The brand mark's destination is the current variant's root.
    // Tenant pages: dashboard is the canonical landing surface.
    // Org pages: the org's root index (no `/dashboard` route).
    // Fallback to `/` if params haven't resolved yet — first paint
    // in App Router can run before `useParams()` populates.
    const brandHref =
        variant === 'org'
            ? params?.orgSlug
                ? `/org/${params.orgSlug}`
                : '/'
            : params?.tenantSlug
              ? `/t/${params.tenantSlug}/dashboard`
              : '/';

    return (
        <NavBar
            left={
                <>
                    <NavBarBrand href={brandHref} />
                    {breadcrumbs.length > 0 ? (
                        <Breadcrumbs
                            items={breadcrumbs}
                            data-testid="top-chrome-breadcrumbs"
                        />
                    ) : (
                        // No breadcrumbs pushed yet — empty sentinel
                        // for layout stability so the chrome's
                        // height doesn't jump when a page resolves
                        // its breadcrumbs after first paint.
                        <span className="sr-only">No breadcrumbs</span>
                    )}
                </>
            }
            right={
                <>
                    <Identity />
                    <UserMenu />
                </>
            }
        />
    );
}
