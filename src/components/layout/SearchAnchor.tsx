'use client';

/**
 * SearchAnchor — Roadmap-2 PR-2.
 *
 * The clickable button that anchors the global search affordance
 * in the top chrome's center region. Two responsibilities:
 *
 *   1. Open the existing command palette via
 *      `useCommandPalette().open()`. Hover/focus state matches the
 *      design system's "input-shaped" treatment.
 *   2. Display the keyboard shortcut (`⌘K` / `Ctrl K`) in a small
 *      pill on the right edge so power users learn it without
 *      having to discover it from the help menu.
 */
import { useEffect, useState } from 'react';
import { useCommandPalette } from '@/components/command-palette/command-palette-provider';

export function SearchAnchor() {
    const { open } = useCommandPalette();
    const [isMac, setIsMac] = useState(false);

    // Detect platform on mount — server-rendered output stays the
    // same across platforms; the keyboard pill only changes after
    // hydration to avoid a hydration mismatch.
    useEffect(() => {
        if (typeof navigator === 'undefined') return;
        setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
    }, []);

    return (
        <button
            type="button"
            onClick={open}
            className="group flex w-full items-center gap-tight rounded-lg border border-border-subtle bg-bg-default px-3 py-1.5 text-sm text-content-muted transition-colors hover:bg-bg-muted/40 hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-label="Open command palette to search"
            data-testid="top-chrome-search-anchor"
        >
            {/* Search-glyph — drawn inline so the button has zero
                additional dependencies (no icon library reach). */}
            <svg
                aria-hidden="true"
                className="h-4 w-4 shrink-0"
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
            <span className="flex-1 text-left">Search anything</span>
            {/* Keystroke pill — uses tabular-nums so the two glyphs
                don't kern unevenly across system fonts. */}
            <span
                className="hidden items-center gap-[2px] rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-content-subtle sm:flex"
                aria-hidden="true"
            >
                <span>{isMac ? '⌘' : 'Ctrl'}</span>
                <span>K</span>
            </span>
        </button>
    );
}
