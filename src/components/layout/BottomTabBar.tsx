'use client';

/**
 * BottomTabBar — one-thumb mobile navigation (mobile-shell PR-1).
 *
 * A sticky bottom-tab bar (`md:hidden`) giving field users
 * single-tap reach to the most-used surfaces WITHOUT opening the
 * hamburger drawer. The drawer (`MobileDrawer`) stays as the long
 * tail; this bar is the fast path for the five field surfaces.
 *
 * The tabs are NOT a second hard-coded nav list — they are resolved
 * against the live, permission-/module-gated `useNavSections()` (the
 * same source the sidebar + drawer render from). A surface the tenant
 * cannot see (gated out of `useNavSections`) is simply absent from the
 * bar too, so the bar is permission-gated for free and can never show
 * a tab the sidebar wouldn't. Matching by href SUFFIX keeps it robust
 * to the `/t/<slug>` prefix that `tenantHref()` bakes into each href.
 *
 * Only mounted for the `tenant` AppShell variant — `useNavSections`
 * reads tenant context, and these are tenant field surfaces.
 *
 * a11y: each tab is a ≥44px touch target (Apple HIG / WCAG 2.5.5),
 * carries `aria-current="page"` when active (non-visual cue), and the
 * active tab also shows a top accent bar (a position/shape cue, so the
 * active state is never colour-only — WCAG 1.4.1). Honors the device
 * safe-area via the shared `.safe-area-bottom` utility.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useNavSections } from './SidebarNav';

/**
 * One resolved nav item, derived from the nav source's return type so the
 * lucide icon TYPE never has to be imported here directly — the no-lucide
 * ratchet (`tests/guards/no-lucide.test.ts`) keeps new `lucide-react`
 * import sites off the tree. The icon VALUES still flow transparently from
 * the nav data; only the type reference is kept local.
 */
type NavItem = ReturnType<typeof useNavSections>[number]['items'][number];

/**
 * The tenant-relative href suffixes of the primary field surfaces, in
 * display order. Resolved against `useNavSections()` at render time so
 * permission/module gating is inherited (a gated-out surface drops from
 * the bar automatically).
 */
const BOTTOM_TAB_SUFFIXES = [
    '/dashboard',
    '/farm-tasks',
    '/locations',
    '/journal',
    '/tasks',
] as const;

export function BottomTabBar() {
    const pathname = usePathname();
    const sections = useNavSections();

    // Flatten the live gated nav, then pick our target surfaces in
    // display order. An item missing from `useNavSections()` (permission
    // /module-gated) is simply skipped — the bar never out-runs the
    // sidebar's visibility.
    const items = sections.flatMap((s) => s.items);
    const tabs: NavItem[] = [];
    for (const suffix of BOTTOM_TAB_SUFFIXES) {
        const match = items.find((it) => it.href.endsWith(suffix));
        if (match) tabs.push(match);
    }

    // Defensive: a tenant with every target surface gated out renders no
    // bar at all rather than an empty strip.
    if (tabs.length === 0) return null;

    return (
        <nav
            aria-label="Primary"
            data-testid="bottom-tab-bar"
            className={cn(
                // Mobile-only, pinned to the viewport bottom, below modals
                // (z-50) and the drawer (z-40/50) but above page content.
                'md:hidden fixed inset-x-0 bottom-0 z-30',
                'flex items-stretch justify-around',
                'border-t border-border-subtle bg-bg-default',
                // Notched-device home-indicator clearance.
                'safe-area-bottom',
            )}
        >
            {tabs.map((tab) => {
                const active = pathname.startsWith(tab.href);
                const Icon = tab.icon;
                // The last path segment is a stable, slug-free test/analytics
                // hook (e.g. "dashboard", "farm-tasks").
                const slug = tab.href.split('/').filter(Boolean).pop() ?? tab.href;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        aria-current={active ? 'page' : undefined}
                        data-testid={`bottom-tab-${slug}`}
                        data-active={active ? 'true' : 'false'}
                        className={cn(
                            'relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5',
                            'text-[10px] font-medium leading-none transition-colors duration-150',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset',
                            active
                                ? 'text-content-emphasis'
                                : 'text-content-muted hover:text-content-default',
                        )}
                    >
                        {/* Non-colour active cue (WCAG 1.4.1): a top accent
                            bar in addition to the emphasis text + aria-current. */}
                        {active && (
                            <span
                                aria-hidden="true"
                                className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--brand-default)]"
                            />
                        )}
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                        <span className="max-w-full truncate">{tab.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}

export default BottomTabBar;
