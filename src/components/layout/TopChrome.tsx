'use client';

/**
 * TopChrome — Roadmap-2 PR-2.
 *
 * The 56-px sticky bar that sits at the top of every authenticated
 * surface. Three regions:
 *
 *   • Left   — breadcrumbs (consumed from `useCurrentBreadcrumbs`).
 *   • Center — `<SearchAnchor>` opening the command palette.
 *   • Right  — context identity pill (tenant or org name).
 *
 * The chrome is mounted once by `<AppShell>` and reads page-scoped
 * data via two contexts:
 *   1. `BreadcrumbsContext` — pages push their trail via
 *      `useBreadcrumbs(items)`; `<PageHeader>` does this for them.
 *   2. The variant-specific identity context — `<TenantIdentityPill>`
 *      reads `useTenantContext`; `<OrgIdentityPill>` reads
 *      `useOrgContext`. AppShell renders the right pill based on
 *      its `variant` prop, so each pill calls its hook
 *      unconditionally and never throws.
 *
 * Mobile (<md): the chrome is hidden — the pre-existing mobile top
 * bar inside `<AppShell>` continues to handle nav-toggle + theme.
 * Adding a second chrome layer on mobile would steal vertical
 * space the mobile UX cannot spare.
 */
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { useCurrentBreadcrumbs } from './breadcrumbs-store';
import { SearchAnchor } from './SearchAnchor';
import { TenantIdentityPill, OrgIdentityPill } from './IdentityPill';
import type { AppShellVariant } from './AppShell';

interface TopChromeProps {
    variant: AppShellVariant;
}

/**
 * Sticky top chrome. Hidden on mobile to preserve vertical space —
 * the existing mobile top bar in `<AppShell>` is a load-bearing
 * surface there.
 */
export function TopChrome({ variant }: TopChromeProps) {
    const breadcrumbs = useCurrentBreadcrumbs();
    const Identity =
        variant === 'org' ? OrgIdentityPill : TenantIdentityPill;

    return (
        // Hidden below md — `<AppShell>`'s mobile top bar is the
        // mobile-equivalent. z-30 sits ABOVE row-sticky headers
        // (z-20) but BELOW modal overlays (z-50).
        <header
            className="hidden md:flex sticky top-0 z-30 h-14 items-center gap-default border-b border-border-subtle bg-bg-page/80 backdrop-blur-sm px-4 md:px-6"
            role="banner"
            data-testid="top-chrome"
        >
            {/* Left — breadcrumbs.
                The min-w-0 + flex-1 lets the label truncate when a
                deep trail collides with the center region. */}
            <div className="flex min-w-0 flex-1 items-center">
                {breadcrumbs.length > 0 ? (
                    <Breadcrumbs
                        items={breadcrumbs}
                        data-testid="top-chrome-breadcrumbs"
                    />
                ) : (
                    // No breadcrumbs pushed yet — render an empty
                    // sentinel for layout stability. Avoids the
                    // chrome's height jumping when a page resolves
                    // its breadcrumbs after first paint.
                    <span className="sr-only">No breadcrumbs</span>
                )}
            </div>

            {/* Center — search anchor.
                Sized to a fixed width so it stays centered under
                changing left/right region widths. */}
            <div className="flex w-72 shrink-0 items-center justify-center">
                <SearchAnchor />
            </div>

            {/* Right — identity pill. Width matches center for
                visual balance; flex-1 + justify-end pulls the pill
                to the far edge. */}
            <div className="flex flex-1 items-center justify-end">
                <Identity />
            </div>
        </header>
    );
}
