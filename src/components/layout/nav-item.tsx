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
 * **The brand-gradient band** — R12-PR5.
 *
 * A 3-px wide capsule-shaped pseudo-element pinned to the left of
 * the row. Vertical gradient from `--brand-default` (top) to
 * `--brand-emphasis` (bottom) — both are the SAME hue family
 * (yellow→yellow or orange→orange depending on theme), so the
 * gradient reads as a quiet fluid deepening rather than a
 * rainbow stunt.
 *
 * Why a pseudo-element, not a border-left?
 *   - `border-image: linear-gradient(...)` works but doesn't
 *     animate opacity cleanly across browsers.
 *   - A real `<span>` adds DOM weight + a tab-stop edge case.
 *   - Pseudo-element is the canonical CSS recipe for decorative
 *     state signals (no DOM, no a11y noise, full transition
 *     control).
 *
 * Why 6px inset top/bottom (`top-1.5 bottom-1.5`)?
 *   - Full-height rules feel architectural (a divider). A
 *     CAPSULE feels like jewellery. The band reads as a piece of
 *     deliberate ornament, not row chrome.
 *
 * Why opacity 0 → 1 transition?
 *   - The motion-language ratchet bans transform / scale /
 *     translate. Opacity is the canonical "fade in/out" motion
 *     for tone-only design systems. 200ms ease-out is one rung
 *     slower than the row's colour transition (150ms) so the
 *     band feels like it lights up just AFTER the text wakes —
 *     a tiny choreography the eye doesn't consciously notice but
 *     reads as deliberate.
 *
 * The DEFAULT state holds the band at opacity 0 — invisible.
 * The HOVER state fades it to opacity 100 — visible.
 * The ACTIVE state holds it at opacity 100 + adds a brand-subtle
 * background for conviction (see NAV_ITEM_ACTIVE).
 */
const NAV_ITEM_BAND_BASE = [
    'before:absolute before:left-0 before:top-1.5 before:bottom-1.5',
    'before:w-[3px] before:rounded-r-full',
    'before:bg-gradient-to-b before:from-[var(--brand-default)] before:to-[var(--brand-emphasis)]',
    'before:opacity-0 before:transition-opacity before:duration-200 before:ease-out',
].join(' ');

/**
 * Geometry + structural-state base — shared by every state. The
 * five geometry tokens above compose into this string; the
 * remaining tokens are structural (flex / text size / motion /
 * focus ring / brand-gradient band pseudo-element).
 */
export const NAV_ITEM_BASE = [
    // `relative` anchors the brand-gradient `::before` band.
    'relative flex items-center',
    NAV_ITEM_GAP,
    NAV_ITEM_PADDING,
    NAV_ITEM_HEIGHT_MIN,
    NAV_ITEM_RADIUS,
    'text-sm transition-colors duration-150 ease-out',
    NAV_ITEM_BAND_BASE,
    // Focus-visible — keyboard story. R12-PR7 will tighten the
    // ring + offset.
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
].join(' ');

/**
 * Default state — humble, ready, quiet. (R12-PR5 evolution.)
 *
 * R12-PR4 had `hover:bg-bg-muted` as the hover signal — a solid
 * full-row tint. R12-PR5 retires that. The hover signal is now
 * the brand-gradient band on the left (see `NAV_ITEM_BAND_BASE`),
 * which appears via the `::before` opacity-0 → opacity-100
 * transition.
 *
 * What hover STILL changes:
 *   - text: `text-content-muted` → `text-content-emphasis`
 *     (one rung brighter — the label wakes up).
 *   - band: opacity 0 → 100 (the brand-gradient ornament).
 *
 * What hover NO LONGER changes:
 *   - background: stays transparent. The full-row bg felt
 *     "claimed" — like the row was being asserted on. The band
 *     is a quieter "noticed" — the row is acknowledged, not
 *     conquered.
 *
 * No `transform`, no `scale`, no `translate`. Motion is opacity +
 * colour only — locked by the motion-language ratchet.
 */
export const NAV_ITEM_DEFAULT =
    'text-content-muted hover:text-content-emphasis hover:before:opacity-100';

/**
 * Active state — conviction. (R12-PR5 evolution.)
 *
 *   - Band: opacity 100 (the brand-gradient capsule from
 *     `NAV_ITEM_BAND_BASE`). Replaces the pre-R12-PR5 solid 2px
 *     `border-l-[var(--brand-default)]` — same visual function,
 *     unified mechanism with hover.
 *   - Background: `bg-brand-subtle` (the canonical brand-tinted
 *     surface, ~9-18% brand tone over the page bg depending on
 *     theme). This is what distinguishes ACTIVE from HOVER —
 *     hover shows just the band; active commits with the wash.
 *   - Text: `text-content-emphasis` (one rung up from muted) +
 *     `font-medium` (one weight up from regular).
 *
 * Visual progression — default → hover → active:
 *   default  no band, muted text, no bg
 *   hover    band fades in, text brightens, NO bg
 *   active   band stays, text + weight stay, brand-subtle bg
 *            arrives (the "settled in" surface)
 */
export const NAV_ITEM_ACTIVE =
    'text-content-emphasis bg-[var(--brand-subtle)] before:opacity-100 font-medium';

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
