'use client';

/**
 * Roadmap-12 PR-1 — `<NavItem>` primitive.
 *
 * The sidebar's only first-class element. Every later Roadmap-12 PR
 * (geometry lock, hover lick, active conviction, focus story, badge,
 * icon discipline) edits the tokens in this file and nowhere else.
 *
 * Why a separate file:
 *
 *   - Previously `NavItem` lived inline at the bottom of
 *     `SidebarNav.tsx`. The tenant sidebar mounts it; the org sidebar
 *     re-implements an almost-identical `OrgNavItem` in
 *     `OrgSidebarNav.tsx`. Two copies of the same recipe.
 *   - Hoisting the recipe into one primitive (and exporting the class
 *     strings as named consts) gives the rest of Roadmap-12 a single
 *     place to land changes. The ratchet
 *     `tests/guards/nav-item-import-discipline.test.ts` locks the
 *     contract: no hand-rolled `<Link>` with the load-bearing
 *     geometry (`min-h-[44px] rounded-lg`) outside this file.
 *
 * State vocabulary (locked by later PRs):
 *
 *   - default       muted text, transparent bg
 *   - hover         emphasis text, bg-muted/50 (R12-PR4 tightens)
 *   - active        emphasis text, brand-subtle bg, brand left-edge
 *   - focus-visible 2px ring at --ring (canonical yellow)
 *
 * The transition is `transition-colors` (motion-language ratchet —
 * duration MUST enumerate the property, never `transition-all`).
 */

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';

// ─── Geometry tokens (R12-PR2) ─────────────────────────────────────
//
// Five measurements drive the way a nav item feels in the hand. Each
// is a named constant so the rationale lives next to the value. A
// future "just bump padding by 2px" PR has to argue against both the
// doc-comment and the ratchet at
// `tests/guards/nav-item-geometry-discipline.test.ts`.

/**
 * **44px minimum row height.** WCAG 2.5.5 (Target Size) recommends a
 * 44×44 CSS-pixel minimum for touch targets. The number isn't a
 * suggestion — anything tighter feels mean on iPad and slows
 * desktop pointer-aim too. Pair with `py-2.5` (10px vertical
 * padding) to land the typical row at exactly 44px while leaving
 * room for badge ascenders.
 */
export const NAV_ITEM_HEIGHT_MIN = 'min-h-[44px]';

/**
 * **px-3 py-2.5** — 12px horizontal, 10px vertical.
 * Horizontal: the active state's 2px brand left-edge eats 2px of
 * left padding so the content still sits at the geometric 12px
 * — symmetry the eye reads as "settled". Vertical: 10px keeps
 * row baseline aligned with `min-h-[44px]` when a single line of
 * 14px text + an 18px icon is the content.
 */
export const NAV_ITEM_PADDING = 'px-3 py-2.5';

/**
 * **gap-compact** — 8px between icon and label.
 * Tighter (6px) makes the icon glue to the label; wider (12px)
 * floats them apart in a way that reads as carelessness. 8 is the
 * Goldilocks for an 18px icon + 14px label.
 */
export const NAV_ITEM_GAP = 'gap-compact';

/**
 * **rounded-lg** — 8px corner radius.
 * Parity with the `<Button>` primitive (`buttonVariants` rests at
 * rounded-lg). Mixing 8 / 6 / 12 across primary chrome reads as
 * un-decided. Pick one for the row family, hold it.
 */
export const NAV_ITEM_RADIUS = 'rounded-lg';

/**
 * **18×18 icon.** Lucide's stroke-1.5 vocabulary looks fragile at
 * 14/16 (the strokes start dropping anti-aliased pixels on
 * non-Retina screens) and oversized at 20+ (steals visual weight
 * from the label). 18 is the sweet spot every premium dense-nav
 * design ends up at — Linear, Notion, Vercel all converge here.
 */
export const NAV_ITEM_ICON_SIZE = 'w-[18px] h-[18px]';

export interface NavItemProps {
    /** Tenant-prefixed href. */
    href: string;
    /** Lucide icon component (rendered at 18×18). */
    icon: LucideIcon;
    /** Visible label. Truncates on overflow. */
    label: string;
    /** Whether this item is the current page. Drives the active state. */
    active: boolean;
    /** Optional count chip (e.g. calendar upcoming-event count). */
    badge?: string | number;
    /** Optional click handler — used by the mobile drawer to close itself. */
    onClick?: () => void;
}

/**
 * Geometry + structural-state base — shared by every state. The
 * five geometry tokens above compose into this string; the
 * remaining tokens are structural (flex / text size / motion /
 * focus ring / active-state left-border slot).
 */
export const NAV_ITEM_BASE = [
    'flex items-center',
    NAV_ITEM_GAP,
    NAV_ITEM_PADDING,
    NAV_ITEM_HEIGHT_MIN,
    NAV_ITEM_RADIUS,
    'text-sm transition-colors duration-150 ease-out',
    // Active-state slot: 2px left-border, transparent by default,
    // brand-default when active (filled in NAV_ITEM_ACTIVE below).
    'border-l-2 border-l-transparent',
    // Focus-visible — keyboard story. R12-PR7 will tighten the
    // ring + offset.
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
].join(' ');

/**
 * Default state — humble, ready, quiet. (R12-PR4 lock.)
 *
 * Two tokens drive what default → hover feels like:
 *
 *   `text-content-muted` → `text-content-emphasis`
 *       The label brightens by one rung on hover. Sub-perceptual
 *       on light theme, clearly readable on dark theme. Done via
 *       the `transition-colors duration-150 ease-out` in
 *       `NAV_ITEM_BASE` — never via a hard step.
 *
 *   transparent bg → `bg-bg-muted` (solid, no alpha)
 *       PRE-R12-PR4 this was `bg-bg-muted/50` (50% alpha). Alpha
 *       on hover backgrounds is what makes UIs look unsure of
 *       themselves — the colour shifts AND blends with whatever
 *       is behind, so two adjacent rows can hover-paint slightly
 *       differently if the page bg has any noise. Solid token,
 *       no alpha, deliberate.
 *
 * No `transform`, no `scale`, no `translate`. Motion language is
 * colour-only — locked by the motion-language ratchet.
 */
export const NAV_ITEM_DEFAULT =
    'text-content-muted hover:text-content-emphasis hover:bg-bg-muted';

/**
 * Active state — conviction. (R12-PR6 will tighten further.)
 *
 *   - Background: `bg-brand-subtle` (the canonical brand-tinted
 *     surface, ~10% brand tone over the page bg).
 *   - Left edge: 2px brand-default, painted into the
 *     `border-l-transparent` slot from `NAV_ITEM_BASE`.
 *   - Text: `text-content-emphasis` (one rung up from muted) +
 *     `font-medium` (one weight up from regular).
 */
export const NAV_ITEM_ACTIVE =
    'text-content-emphasis bg-[var(--brand-subtle)] border-l-[var(--brand-default)] font-medium';

export function NavItem({ href, icon: Icon, label, active, badge, onClick }: NavItemProps) {
    const slug = href.split('/').pop() ?? '';

    return (
        <Link
            href={href}
            onClick={onClick}
            className={`${NAV_ITEM_BASE} ${active ? NAV_ITEM_ACTIVE : NAV_ITEM_DEFAULT}`}
            data-testid={`nav-${slug}`}
        >
            <Icon className={`${NAV_ITEM_ICON_SIZE} flex-shrink-0`} aria-hidden="true" />
            <span className="truncate">{label}</span>
            {badge != null && (
                <StatusBadge variant="info" size="sm" className="ml-auto tabular-nums">
                    {badge}
                </StatusBadge>
            )}
        </Link>
    );
}
