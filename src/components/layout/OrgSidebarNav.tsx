'use client';

import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    Building2,
    ShieldCheck,
    AlertTriangle,
    Paperclip,
    Users,
    Settings,
    ScrollText,
    LogOut,
    type LucideIcon,
} from 'lucide-react';
import { useOrgContext, useOrgHref, useOrgPermissions } from '@/lib/org-context-provider';
import { Button } from '@/components/ui/button';
import { OrgSwitcher } from '@/components/org-switcher';
// PR-2 — port the org sidebar to the canonical Roadmap-12 nav
// primitives that the tenant sidebar already uses. The legacy
// `nav-link` CSS approach (an `<a>` + class string) loses the
// active-state band, hover gloss, and keyboard-focus polish the
// shared <NavItem> bakes in.
import { NavItem } from './nav-item';
import { NavSection } from './nav-section';

// ─── Nav configuration ───────────────────────────────────────────────
//
// Seven entries per Epic O-4 spec, in the order the spec lists them:
//   1. Portfolio Overview
//   2. All Tenants
//   3. Non-Performing Controls   ← drill-down
//   4. Critical Risks            ← drill-down
//   5. Overdue Evidence          ← drill-down
//   6. Members
//   7. Settings
//
// `requiresDrillDown` flags the three drill-down entries — they're
// hidden in the sidebar when the user lacks the permission (ORG_READER
// case). Server-side authorization remains the load-bearing gate; the
// hidden item is a UX cleanup, not a security control.

interface OrgNavItemDef {
    href: string;
    label: string;
    icon: LucideIcon;
    requiresDrillDown?: boolean;
    requiresManageMembers?: boolean;
    requiresManageTenants?: boolean;
}

interface OrgNavSectionDef {
    title?: string;
    items: OrgNavItemDef[];
}

export function useOrgNavSections(): OrgNavSectionDef[] {
    const orgHref = useOrgHref();
    const perms = useOrgPermissions();

    const sections: OrgNavSectionDef[] = [
        {
            // Roadmap-2 PR-3 — quiet eyebrow on the primary org
            // group (mirrors "Manage" below + "Govern" on the
            // tenant sidebar). Gives the org sidebar the same
            // visual hierarchy the tenant sidebar carries.
            title: 'Portfolio',
            items: [
                { href: orgHref('/'), label: 'Portfolio Overview', icon: LayoutDashboard },
                { href: orgHref('/tenants'), label: 'All Tenants', icon: Building2 },
                {
                    href: orgHref('/controls'),
                    label: 'Non-Performing Controls',
                    icon: ShieldCheck,
                    requiresDrillDown: true,
                },
                {
                    href: orgHref('/risks'),
                    label: 'Critical Risks',
                    icon: AlertTriangle,
                    requiresDrillDown: true,
                },
                {
                    href: orgHref('/evidence'),
                    label: 'Overdue Evidence',
                    icon: Paperclip,
                    requiresDrillDown: true,
                },
            ],
        },
        {
            title: 'Manage',
            items: [
                {
                    href: orgHref('/members'),
                    label: 'Members',
                    icon: Users,
                    requiresManageMembers: true,
                },
                {
                    href: orgHref('/audit'),
                    label: 'Audit Log',
                    icon: ScrollText,
                    // Epic B — immutable per-org privilege ledger.
                    // Same gate as Members: ORG_ADMIN can review who
                    // was added/removed/role-changed and when.
                    requiresManageMembers: true,
                },
                {
                    href: orgHref('/settings'),
                    label: 'Settings',
                    icon: Settings,
                    // Settings UI is ORG_ADMIN-only because the spec
                    // gates org config changes (rename, delete, etc.)
                    // behind canManageTenants.
                    requiresManageTenants: true,
                },
            ],
        },
    ];

    // Defense-in-depth client filter — fail-closed.
    return sections.map((section) => ({
        ...section,
        items: section.items.filter((item) => {
            if (item.requiresDrillDown && !perms.canDrillDown) return false;
            if (item.requiresManageMembers && !perms.canManageMembers) return false;
            if (item.requiresManageTenants && !perms.canManageTenants) return false;
            return true;
        }),
    }));
}

// PR-2 — `OrgNavItem` / `OrgNavSection` retired in favour of the
// canonical `<NavItem>` / `<NavSection>` primitives (used by the
// tenant sidebar). The shared primitives carry the Roadmap-12
// active-state band, the R13 brand-gradient glow + shimmer, the
// liquid hover sweep, and the keyboard-focus polish — none of
// which the legacy `nav-link` CSS class provided.

// ─── Sidebar content (shared between desktop sidebar + mobile drawer) ─

interface OrgSidebarContentProps {
    user: { name?: string | null };
    onLogout: () => void;
    onNavClick?: () => void;
}

export function OrgSidebarContent({ user, onLogout, onNavClick }: OrgSidebarContentProps) {
    const pathname = usePathname();
    const org = useOrgContext();
    const sections = useOrgNavSections();

    return (
        <div className="flex flex-col h-full">
            {/* Org branding doubles as the context switcher (Epic O-4). */}
            <div className="p-3 border-b border-border-subtle">
                <OrgSwitcher
                    orgSlug={org.orgSlug}
                    orgName={org.orgName}
                    currentKind="org"
                />
            </div>

            {/* Nav */}
            <nav className="flex-1 p-2 overflow-y-auto" aria-label="Organization navigation">
                {sections.map((section, idx) => (
                    <NavSection
                        key={idx}
                        title={section.title}
                        isFirst={idx === 0}
                    >
                        {section.items.map((item) => {
                            // Active when the current path is exactly the item's href
                            // OR a sub-path. Special-case "/" so the overview tab
                            // doesn't light up for every other nav item.
                            const isOverview = item.href === `/org/${org.orgSlug}/`;
                            const active = isOverview
                                ? pathname === item.href.replace(/\/$/, '') ||
                                  pathname === item.href
                                : pathname.startsWith(item.href);
                            return (
                                <NavItem
                                    key={item.href}
                                    href={item.href}
                                    icon={item.icon}
                                    label={item.label}
                                    active={active}
                                    onClick={onNavClick}
                                />
                            );
                        })}
                    </NavSection>
                ))}
            </nav>

            {/* User. The theme toggle was removed in step with
                SidebarNav; theme is still toggleable from the
                command palette. */}
            <div className="p-3 border-t border-border-subtle">
                <div className="mb-2 min-w-0">
                    <p className="text-xs font-medium text-content-default truncate">{user.name}</p>
                    <p className="text-xs text-content-muted truncate">{org.orgName}</p>
                    {/* GAP-CI-77: see SidebarNav for the same fix
                        rationale — brand orange on cream is below AA for
                        small text. */}
                    <p className="text-xs text-content-muted">{org.role}</p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onLogout}
                    className="w-full text-xs"
                    data-testid="org-nav-logout"
                >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    Sign out
                </Button>
            </div>
        </div>
    );
}
