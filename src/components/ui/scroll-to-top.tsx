'use client';

/**
 * ScrollToTop — long-list "back to top" affordance (mobile-native-feel PR-4c).
 *
 * On a long field list a thumb can be two-plus screens deep; getting
 * back to the top by scrolling is a chore. This mobile-only button
 * appears once the document has scrolled past ~2 viewport heights and
 * jumps back to the top on tap.
 *
 * Contract:
 *   - **Mobile-only** (`md:hidden`) — on desktop the list-page shell
 *     clamps to the viewport and the table body scrolls internally, so
 *     the document itself barely scrolls. On mobile the DOCUMENT scrolls
 *     (see `AppShell`), which is what this tracks.
 *   - **Appears after ~2 screens** of scroll (`2 × innerHeight`).
 *   - **Sits above the bottom-tab bar** + the device safe area, mirroring
 *     the Fab's offset — anchored bottom-LEFT so it never collides with
 *     the bottom-right Fab.
 *   - **≥44px touch target** (Apple HIG / WCAG 2.5.5).
 *   - **Reduced-motion-aware** — smooth scroll normally, instant jump
 *     under `prefers-reduced-motion`.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { ChevronUp } from '@/components/ui/icons/nucleo';
import { useReducedMotion } from '@/components/ui/hooks';

export interface ScrollToTopProps {
    /** Extra classes (rarely needed — the default placement is canonical). */
    className?: string;
}

export function ScrollToTop({ className }: ScrollToTopProps) {
    const t = useTranslations('mobile');
    const reduced = useReducedMotion();
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const read = () => {
            // ~2 screens deep — dynamic so it tracks the live viewport.
            setVisible(window.scrollY > window.innerHeight * 2);
        };
        window.addEventListener('scroll', read, { passive: true });
        read();
        return () => window.removeEventListener('scroll', read);
    }, []);

    if (!visible) return null;

    return (
        <button
            type="button"
            data-testid="scroll-to-top"
            aria-label={t('scrollTop')}
            onClick={() =>
                window.scrollTo({
                    top: 0,
                    behavior: reduced ? 'auto' : 'smooth',
                })
            }
            className={cn(
                // Mobile-only, anchored bottom-LEFT above the tab bar + safe
                // area (mirrors the Fab's bottom offset; opposite corner so
                // the two never overlap). z-30 = same tier as Fab / tab bar.
                'md:hidden fixed left-4 z-30',
                'bottom-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)]',
                // 44px circular target (WCAG 2.5.5 floor).
                'inline-flex h-11 w-11 items-center justify-center rounded-full',
                'border border-border-default bg-bg-default text-content-default shadow-lg',
                'transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:translate-y-px motion-reduce:active:translate-y-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
                className,
            )}
        >
            <ChevronUp className="h-5 w-5" aria-hidden />
        </button>
    );
}

export default ScrollToTop;
