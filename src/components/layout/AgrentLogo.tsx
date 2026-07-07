/**
 * Agrent brand mark — the seedling glyph that replaces the placeholder "AG" /
 * legacy "IC" initials (#16).
 *
 * A single, self-contained SVG that inherits its colour from `currentColor`,
 * so it reads correctly in every context it's dropped into:
 *   - inside the top-chrome brand box (`NAV_BAR_BRAND_CLASS`) and the sidebar
 *     header box, both of which paint the gold brand gradient as the BACKGROUND
 *     and set `text-content-inverted` (deep navy) as the foreground — the mark
 *     picks up that navy automatically, in light AND dark themes;
 *   - it carries no colour of its own, so it never fights the brand tokens.
 *
 * Decorative by default (`aria-hidden`): the accessible name lives on the
 * wrapping `<Link aria-label>` (top chrome) or the adjacent word-mark
 * (`tc('appName')`) in the sidebar. Pass a `title` only for a standalone use
 * that needs its own accessible name.
 *
 * This is a clean, on-brand placeholder mark (a seedling — growth /
 * agriculture); a bespoke wordmark logo can replace the paths later without
 * touching any call site.
 */

export interface AgrentMarkProps {
    /** Sizing / positioning classes (e.g. `h-4 w-4`). */
    className?: string;
    /** When set, the mark becomes a labelled image instead of decorative. */
    title?: string;
}

export function AgrentMark({ className, title }: AgrentMarkProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            fill="none"
            focusable="false"
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : undefined}
        >
            {title ? <title>{title}</title> : null}
            {/* stem */}
            <path
                d="M12 21.5V11.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
            />
            {/* left leaf (lower) */}
            <path
                d="M11.6 13.4C11.2 10 8.4 7.9 4.6 8.2c.1 3.4 2.9 5.5 7 5.2Z"
                fill="currentColor"
            />
            {/* right leaf (upper) */}
            <path
                d="M12.4 11.6C12.1 7.7 15 5.4 19.4 5.2c.2 3.9-2.6 6.2-7 6.4Z"
                fill="currentColor"
            />
        </svg>
    );
}
