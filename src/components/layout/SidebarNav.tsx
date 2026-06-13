'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenantContext, useTenantHref, usePermissions } from '@/lib/tenant-context-provider';
import { Tooltip } from '@/components/ui/tooltip';
import { useKeyboardShortcut } from '@/lib/hooks/use-keyboard-shortcut';
import { StartTourButton } from '@/components/ui/OnboardingTour';
import { useCommandPalette } from '@/components/command-palette/command-palette-provider';
import {
    X,
    LayoutDashboard,
    Building2,
    AlertTriangle,
    ShieldCheck,
    Paperclip,
    FileText,
    ClipboardList,
    ClipboardCheck,
    FlaskConical,
    Truck,
    BarChart3,
    Settings,
    LogOut,
    Calendar as CalendarIcon,
    Workflow,
    PanelLeftClose,
    PanelLeftOpen,
    MapPin,
    Boxes,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCalendarBadge } from './use-calendar-badge';
import { NavItem } from './nav-item';
import { NavSection } from './nav-section';
import { useSidebarCollapsed } from './sidebar-collapse-context';

// ─── Types ───

interface NavItemDef {
    href: string;
    label: string;
    icon: LucideIcon;
    badge?: string | number;
    /** If set, item is only shown when this returns true */
    visible?: boolean;
}

interface NavSectionDef {
    title?: string;
    items: NavItemDef[];
}

// ─── Navigation configuration ───

export function useNavSections(): NavSectionDef[] {
    const tenantHref = useTenantHref();
    const perms = usePermissions();
    const tenant = useTenantContext();
    // Live badge — fetched lazily; undefined when count is 0 or load fails.
    const calendarBadge = useCalendarBadge(tenant.tenantSlug);

    // R13-PR7 — tenant sidebar restructure.
    //
    //   Board (standalone, no eyebrow)   home/dashboard
    //   Workspace                        core entities: Asset / Risk / Control
    //   Comply                           daily-cadence work: Plan / Schedule / Review / Docs
    //   Manage                           governance + reporting
    //
    // Renames carry forward to labels only — hrefs (and therefore
    // `data-testid="nav-<slug>"`) stay stable so existing E2E,
    // onboarding-tour, and analytics selectors keep working.
    return [
        {
            // Board is the home link. No eyebrow — it reads as a
            // single anchor above the grouped nav, mirroring the
            // "home" item pattern in Linear / Stripe / Vercel
            // sidebars.
            items: [
                { href: tenantHref('/dashboard'), label: 'Board', icon: LayoutDashboard },
            ],
        },
        {
            // R13-PR11 — renamed from "Workspace" to "Govern" to
            // better describe the three core entities (assets,
            // risks, controls) as the surfaces compliance teams
            // govern day-to-day, distinct from the daily-cadence
            // work that sits under "Comply".
            title: 'Govern',
            items: [
                { href: tenantHref('/assets'), label: 'Asset', icon: Building2 },
                { href: tenantHref('/locations'), label: 'Location', icon: MapPin },
                { href: tenantHref('/inventory'), label: 'Inventory', icon: Boxes },
                { href: tenantHref('/risks'), label: 'Risk', icon: AlertTriangle },
                { href: tenantHref('/controls'), label: 'Control', icon: ShieldCheck },
            ],
        },
        {
            title: 'Comply',
            items: [
                // R13-PR16 — Audit moved from "Manage" to the top of
                // "Comply" because audits are a daily-cadence
                // workflow (Plan / Schedule / Review / Docs), not
                // ongoing governance configuration.
                { href: tenantHref('/audits'), label: 'Audit', icon: ClipboardCheck },
                { href: tenantHref('/tasks'), label: 'Plan', icon: ClipboardList },
                {
                    href: tenantHref('/calendar'),
                    label: 'Schedule',
                    icon: CalendarIcon,
                    badge: calendarBadge,
                },
                { href: tenantHref('/tests'), label: 'Review', icon: FlaskConical },
                { href: tenantHref('/evidence'), label: 'Docs', icon: Paperclip },
            ],
        },
        {
            title: 'Manage',
            items: [
                // R13-PR12 — Frameworks dropped from the sidebar.
                // The page stays reachable via the Frameworks pill on
                // the Audits page header (R13-PR9) and via the command
                // palette (⌘K → "Frameworks").
                // R13-PR16 — Audit moved up to Comply (see above).
                { href: tenantHref('/policies'), label: 'Policy', icon: FileText },
                { href: tenantHref('/vendors'), label: 'Vendor', icon: Truck },
                // R25-PR-A — Processes canvas. Visual mapping of
                // business + IT processes with controls placed on
                // the connections between steps. Sits under Manage
                // alongside Policy + Vendor — same governance-tool
                // tier.
                { href: tenantHref('/processes'), label: 'Process', icon: Workflow },
                { href: tenantHref('/reports'), label: 'Report', icon: BarChart3, visible: perms.reports.view },
            ].filter(item => {
                // DEFENSE-IN-DEPTH (Layer 2 of 2):
                // Layer 1: Server layout uses noStore() to ensure fresh permissions per request.
                // Layer 2: This client-side filter removes gated items based on the resolved permissions.
                // Fail-closed: if `visible` is explicitly set, only include when strictly `true`.
                if (item.visible === undefined) return true; // no gate — always visible
                return item.visible === true;               // gated — only if permission is true
            }),
        },
    ];
}

// ─── Sidebar content (shared between desktop sidebar and mobile drawer) ───

interface SidebarContentProps {
    user: { name?: string | null };
    onLogout: () => void;
    onNavClick?: () => void;
    /** Desktop only — when provided, renders the collapse/expand toggle. */
    onToggleCollapse?: () => void;
}

export function SidebarContent({ user, onLogout, onNavClick, onToggleCollapse }: SidebarContentProps) {
    const pathname = usePathname();
    const tc = useTranslations('common');
    const tenant = useTenantContext();
    const tenantHref = useTenantHref();
    const perms = usePermissions();
    const sections = useNavSections();
    const { open: openPalette } = useCommandPalette();
    // Icon-rail mode (desktop). The mobile drawer's provider always reports
    // false, so this whole branch is desktop-only in practice.
    const collapsed = useSidebarCollapsed();

    return (
        <div className="flex flex-col h-full">
            {/* Logo */}
            <div className="p-4 border-b border-border-subtle">
                <div className={collapsed ? 'flex items-center justify-center' : 'flex items-center gap-tight'}>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--brand-emphasis)] to-[var(--brand-default)] flex items-center justify-center flex-shrink-0">
                        <span className="text-content-inverted text-sm font-bold">IC</span>
                    </div>
                    {!collapsed && (
                        <span className="text-sm font-semibold text-content-emphasis truncate">{tc('appName')}</span>
                    )}
                </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-2 overflow-y-auto" aria-label="Main navigation">
                {sections.map((section, idx) => (
                    <NavSection
                        key={idx}
                        title={section.title}
                        // R12-PR3 — suppress the top hairline on
                        // the first titled section (the very top
                        // of the sidebar). The solo Board section
                        // sits at idx 0 with no title; the first
                        // titled section is "Govern" at idx 1.
                        isFirst={idx === 0 || sections.findIndex((s) => s.title) === idx}
                    >
                        {section.items.map((item) => (
                            <NavItem
                                key={item.href}
                                href={item.href}
                                icon={item.icon}
                                label={item.label}
                                badge={item.badge}
                                active={pathname.startsWith(item.href)}
                                onClick={onNavClick}
                            />
                        ))}
                    </NavSection>
                ))}
            </nav>

            {/* Driver.js product tour — manual restart entry.
                Renders only when the OnboardingTourProvider is
                mounted (i.e. inside the authenticated tenant
                shell). The auto-trigger handles first-login;
                this button is for the "I want to see it again"
                case. Sits above the search bar so the role row
                in the user block below is the literal last line. */}
            {!collapsed && (
                <div className="mx-2">
                    <StartTourButton />
                </div>
            )}

            {/* Roadmap-2 PR-3 — inline command-palette opener.
                Sits below the scrolling nav and above the user
                block. The chrome's `<SearchAnchor>` is the
                primary affordance on desktop; this row is the
                mobile equivalent (chrome is hidden on <md) AND
                a discoverable secondary anchor on desktop. */}
            <button
                type="button"
                onClick={() => {
                    onNavClick?.();
                    openPalette();
                }}
                className={cn(
                    'mx-2 mb-2 flex items-center rounded-lg border border-border-subtle bg-bg-default px-3 py-2 text-xs text-content-muted transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    collapsed ? 'justify-center' : 'gap-tight',
                )}
                aria-label="Open command palette"
                data-testid="sidebar-search-anchor"
            >
                <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="7" cy="7" r="5" />
                    <path d="M11 11l3 3" />
                </svg>
                {!collapsed && <span className="flex-1 text-left">Search</span>}
                {!collapsed && (
                    <span
                        className="hidden items-center gap-[2px] rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-content-subtle md:flex"
                        aria-hidden="true"
                    >
                        <span>⌘</span>
                        <span>K</span>
                    </span>
                )}
            </button>

            {/* Collapse / expand the desktop sidebar to an icon rail.
                Desktop only — `onToggleCollapse` is undefined in the mobile
                drawer, so this row never renders there. */}
            {onToggleCollapse && (
                <div className="mx-2 mb-2">
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-pressed={collapsed}
                        data-testid="sidebar-collapse-toggle"
                        className={cn(
                            'flex w-full items-center rounded-lg border border-border-subtle bg-bg-default px-3 py-2 text-xs text-content-muted transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                            collapsed ? 'justify-center' : 'gap-tight',
                        )}
                    >
                        {collapsed ? (
                            <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                        ) : (
                            <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
                        )}
                        {!collapsed && <span className="flex-1 text-left">Collapse</span>}
                    </button>
                </div>
            )}

            {/* User. Admin + Sign-out sit on a single horizontal
                row, vertically centred against the three-line
                identity (name / tenant / role). The role row is
                the literal last line of the sidebar — the tour
                opener was moved above the search bar so nothing
                renders below the identity. Collapsed: identity text is
                dropped and the icons stack centred in the rail. */}
            <div className="p-3 border-t border-border-subtle">
                <div className={cn('flex gap-tight', collapsed ? 'flex-col items-center' : 'items-center justify-between')}>
                    {!collapsed && (
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-content-default truncate">{user.name}</p>
                            <p className="text-xs text-content-muted truncate">{tenant.tenantName}</p>
                            {/* GAP-CI-77: role uses content-muted (not brand-default).
                                The PwC-orange brand colour on light cream is only
                                4.25:1 — below WCAG AA's 4.5:1 for small text — and
                                the role line is informational, not a brand
                                accent. */}
                            <p className="text-xs text-content-muted">{tenant.role}</p>
                        </div>
                    )}
                    <div className={cn('flex gap-tight', collapsed ? 'flex-col items-center' : 'items-center')}>
                        {perms.admin.view && (
                            <Tooltip content="Admin" side={collapsed ? 'right' : 'top'}>
                                <Link
                                    href={tenantHref('/admin')}
                                    aria-label="Admin"
                                    id="admin-icon-link-desktop"
                                    data-testid="nav-admin-icon"
                                    className="icon-btn icon-btn-sm"
                                >
                                    <Settings className="size-4" aria-hidden="true" />
                                </Link>
                            </Tooltip>
                        )}
                        <Tooltip content={tc('signOut')} side={collapsed ? 'right' : 'top'}>
                            <button
                                type="button"
                                onClick={onLogout}
                                aria-label={tc('signOut')}
                                data-testid="nav-logout"
                                className="icon-btn icon-btn-sm"
                            >
                                <LogOut className="size-4" aria-hidden="true" />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Mobile Drawer ───

interface MobileDrawerProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

export function MobileDrawer({ open, onClose, children }: MobileDrawerProps) {
    const pathname = usePathname();

    // Close on route change (always close to avoid stale open state)
    useEffect(() => {
        onClose();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    // Close on Escape — routed through the shared shortcut system so
    // it respects precedence against any other Escape binding that
    // might happen to be active, and so a contributor grepping for
    // shortcut sources finds it via `useKeyboardShortcut` like every
    // other binding in the app.
    //
    // `scope: 'overlay'` + priority 5 means:
    //   - Fires only while the drawer is mounted (via the
    //     `data-sheet-overlay` marker on the backdrop below).
    //   - Beats selection-clear (priority 2) and filter-clear
    //     (priority 1) if both are somehow simultaneously active.
    //   - Loses to any modal stacking above the drawer (those
    //     override via Radix's native Escape inside their portal).
    useKeyboardShortcut('Escape', onClose, {
        enabled: open,
        scope: 'overlay',
        priority: 5,
        description: 'Close navigation drawer',
    });

    // Lock body scroll when open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    return (
        <>
            {/* Backdrop.
                `data-sheet-overlay` is picked up by the shortcut
                registry's overlay selector, so while the drawer is
                open any `scope: 'global'` shortcut (filter clear,
                selection clear, etc.) stands down automatically. */}
            <div
                className={`
                    fixed inset-0 z-40 bg-black/60 backdrop-blur-sm
                    transition-opacity duration-300
                    ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
                `}
                onClick={onClose}
                aria-hidden="true"
                data-testid="nav-drawer-backdrop"
                data-sheet-overlay={open ? 'true' : undefined}
            />

            {/* Drawer */}
            <div
                className={`
                    fixed inset-y-0 left-0 z-50 w-64 bg-bg-default border-r border-border-subtle
                    transform transition-transform duration-300 ease-in-out
                    ${open ? 'translate-x-0' : '-translate-x-full'}
                `}
                role="dialog"
                aria-modal="true"
                aria-label="Navigation menu"
                data-testid="nav-drawer"
                data-open={open ? 'true' : 'false'}
            >
                {/* Close button — 44px touch target.
                    Elevation PR-3 — adds canonical focus ring + uses
                    transition-colors (motion-language compliant). */}
                <button
                    type="button"
                    className="absolute top-3 right-3 p-2 rounded-lg text-content-muted hover:text-content-emphasis hover:bg-bg-muted transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onClick={onClose}
                    aria-label="Close navigation"
                    data-testid="nav-drawer-close"
                >
                    <X className="w-5 h-5" />
                </button>

                {children}
            </div>
        </>
    );
}
