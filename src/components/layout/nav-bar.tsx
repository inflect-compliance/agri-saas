'use client';

/**
 * Roadmap-14 PR-1 — `<NavBar>` primitive.
 *
 * The top-bar's only first-class structural element. Every later
 * R14 PR (geometry lock, brand mark, env badge, switcher, search,
 * notifications, user menu, living-chrome polish, mobile parity)
 * edits this file and the slot-children it accepts — never adds
 * a parallel `<header>` elsewhere.
 *
 * Why a separate file:
 *
 *   - Previously `<TopChrome>` (in `TopChrome.tsx`) hand-rolled the
 *     entire `<header>` element + its child layout. It worked, but
 *     it locked the shell shape inside the file that ALSO composes
 *     the breadcrumbs + identity pill. Mixing "what the bar looks
 *     like" with "what the bar shows today" makes every later PR
 *     touch a complex file.
 *
 *   - Hoisting the recipe into one primitive (and exporting the
 *     class strings as named consts) gives R14 a single place to
 *     land every slot. The ratchet
 *     `tests/guards/nav-bar-import-discipline.test.ts` locks the
 *     contract: no parallel `<header role="banner">` with the
 *     load-bearing chrome geometry outside this file.
 *
 * Slot architecture (locked by PR-1, filled by PR-3 onwards):
 *
 *   left      brand mark · env badge · breadcrumbs
 *             (PR-3 adds brand · PR-9 adds env badge ·
 *              breadcrumbs already there in PR-1)
 *
 *   center    global search anchor (⌘K)
 *             (PR-6 adds the search pill)
 *
 *   right     notifications · context · account
 *             (PR-4 swaps identity pill → workspace switcher ·
 *              PR-5 adds user menu · PR-7 adds notifications)
 *
 * Each slot is a discrete React node consumed by the structural
 * shell. The shell is responsible for SPACING and ALIGNMENT only;
 * the slots own their own content + state.
 *
 * Why slot props (not compound components like `<NavBar.Brand/>`)?
 *
 *   - Type-safety: a `left?: ReactNode` prop is just JSX-validated.
 *     A compound-component pattern (`NavBar.Brand = ...`) requires
 *     React.Children sniffing or context plumbing to enforce slot
 *     placement, which adds runtime overhead for zero ergonomic
 *     benefit at this scale.
 *
 *   - Matches the codebase: `<EntityListPage>` and
 *     `<EntityDetailLayout>` (Epic 52 / R13 era) both use slot
 *     props, not compound components. Consistency over fashion.
 *
 *   - SSR-safe: slot props serialize cleanly across the RSC
 *     boundary. Compound components with `displayName` checks can
 *     hit edge cases in production builds.
 */

import type { ReactNode } from 'react';

// ─── Slot recipes (R14-PR2 will extract to named geometry tokens) ──

/**
 * Shell recipe — the `<header>`'s class string.
 *
 * PR-1 preserves R12-era inline values verbatim (h-14, gap-default,
 * px-4 md:px-6, sticky top-0 z-30, border + glass blur). R14-PR2
 * extracts these into named geometry consts; PR-10 adds the R13
 * living-chrome polish (gloss `::after` + fading bottom border +
 * brand-radial wash).
 *
 * `hidden md:flex` is the dual-chrome compromise of today — the
 * desktop bar hides below md while AppShell renders a mobile-only
 * bar. PR-12 unifies the two; PR-1 only LOCKS THE PRIMITIVE
 * BOUNDARY, it doesn't yet rewrite mobile.
 */
export const NAV_BAR_SHELL =
    'hidden md:flex sticky top-0 z-30 h-14 items-center justify-between gap-default border-b border-border-subtle bg-bg-page/80 backdrop-blur-sm px-4 md:px-6';

/**
 * Left-slot recipe — flex row that hugs left, truncates gracefully.
 *
 * `min-w-0` is load-bearing: without it the breadcrumbs slot would
 * push the centre + right slots off the right edge instead of
 * truncating itself.
 */
export const NAV_BAR_SLOT_LEFT =
    'flex min-w-0 flex-1 items-center gap-default';

/**
 * Centre-slot recipe — fixed width, never grows past the search
 * pill's natural size.
 *
 * PR-1 leaves this empty (the centre slot is unused today). PR-6
 * fills it with the ⌘K search anchor. The slot's geometry stays
 * stable across centre-filled / centre-empty states so the layout
 * doesn't shift when search lands.
 */
export const NAV_BAR_SLOT_CENTER =
    'flex shrink-0 items-center justify-center';

/**
 * Right-slot recipe — flex row that hugs right.
 *
 * The mirror of the left slot. Together with the centre slot they
 * form a 3-region grid that the eye reads as "anchor — verb —
 * identity".
 */
export const NAV_BAR_SLOT_RIGHT =
    'flex shrink-0 items-center justify-end gap-default';

// ─── Component ───

export interface NavBarProps {
    /**
     * Left slot — brand · env badge · breadcrumbs.
     * Truncates gracefully when wide content (long breadcrumb
     * trails) collides with the centre slot.
     */
    left?: ReactNode;
    /**
     * Centre slot — global search anchor (filled by R14-PR6).
     * Stays empty in PR-1; the slot exists for layout stability.
     */
    center?: ReactNode;
    /**
     * Right slot — notifications · context · account.
     * Anchored to the right edge; never grows.
     */
    right?: ReactNode;
}

/**
 * The structural shell for the top-bar. Three named slots; the
 * shell owns spacing + alignment, slots own their content + state.
 *
 * Mounted once by `<TopChrome>`. Future R14 PRs add slot content;
 * the shell's geometry stays locked.
 */
export function NavBar({ left, center, right }: NavBarProps) {
    return (
        <header
            className={NAV_BAR_SHELL}
            role="banner"
            data-testid="nav-bar"
        >
            <div className={NAV_BAR_SLOT_LEFT} data-slot="left">
                {left}
            </div>
            <div className={NAV_BAR_SLOT_CENTER} data-slot="center">
                {center}
            </div>
            <div className={NAV_BAR_SLOT_RIGHT} data-slot="right">
                {right}
            </div>
        </header>
    );
}
