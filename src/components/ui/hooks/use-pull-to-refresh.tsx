'use client';

/**
 * usePullToRefresh — native-feeling pull-to-refresh for the mobile
 * field surfaces (mobile-native-feel PR-2).
 *
 * A field operator on a phone expects to drag a list down to refresh
 * it — the gesture every native app ships. This hook wires that
 * gesture to the page's OWN SWR `mutate()` (the page owns its keys;
 * it threads its refresh callback in via `onRefresh`).
 *
 * Contract:
 *   - **Touch-only.** Listeners attach only on a coarse pointer
 *     (`(pointer: coarse)`), so desktop mouse users never see it.
 *   - **Triggers only at the top of the page scroll.** A pull that
 *     begins while the document is scrolled down does nothing — the
 *     user is scrolling, not refreshing. On mobile the DOCUMENT
 *     scrolls (the app-shell `<main>`'s `overflow-auto` is inert
 *     below md — see `AppShell`), so `document.scrollingElement`
 *     is the authoritative scroll position.
 *   - **Standard spinner affordance.** A fixed pill at the top-centre
 *     grows in as the user pulls, then spins while the refresh runs.
 *   - **Haptic on trigger.** `haptic('tap')` fires once when the pull
 *     crosses the trigger threshold (itself capability- +
 *     reduced-motion-gated inside `@/lib/haptics`).
 *   - **Reduced-motion-aware.** Under `prefers-reduced-motion` the
 *     spinner does not rotate (a static ring) and the minimum
 *     spin-hold collapses to zero.
 *
 * PWA standalone note: `overscroll-behavior-y: contain` on the
 * document (globals.css, mobile block) stops the browser's OWN
 * pull-to-refresh from also firing, so our custom gesture never
 * fights a native reload. In an installed (standalone) PWA the
 * browser chrome — and its native pull-to-refresh — is absent
 * entirely, so this hook is the only pull affordance there; the
 * `contain` rule simply makes browser + standalone behave the same.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/haptics';
import { useReducedMotion } from './use-reduced-motion';

/** Pixels pulled (post-damping) past the top before a release fires. */
const TRIGGER_THRESHOLD = 64;
/** Visual clamp on how far the indicator travels. */
const MAX_PULL = 96;
/** Finger travel → indicator travel ratio (rubber-band feel). */
const DAMPING = 0.5;
/** Minimum spin hold so a sub-100ms refresh still reads as "it worked". */
const MIN_SPIN_MS = 500;

export interface UsePullToRefreshOptions {
    /**
     * The page's refresh action — almost always its SWR `mutate()`.
     * May return a promise; the spinner holds until it settles.
     */
    onRefresh: () => void | Promise<unknown>;
    /** Escape hatch to disable the gesture (default enabled). */
    enabled?: boolean;
}

export interface UsePullToRefreshResult {
    /** The fixed spinner affordance — render it anywhere in the page. */
    indicator: ReactNode;
    /** True while a refresh is in flight (for optional page-level UI). */
    refreshing: boolean;
}

export function usePullToRefresh({
    onRefresh,
    enabled = true,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
    const t = useTranslations('mobile');
    const reduced = useReducedMotion();

    const [distance, setDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    // Refs mirror the state so the touch handlers (bound once) read the
    // live values without re-binding on every move.
    const distanceRef = useRef(0);
    const refreshingRef = useRef(false);
    const startYRef = useRef<number | null>(null);
    const pullingRef = useRef(false);

    const setPull = useCallback((d: number) => {
        distanceRef.current = d;
        setDistance(d);
    }, []);

    // Keep the latest onRefresh without re-binding listeners on each render.
    const onRefreshRef = useRef(onRefresh);
    useEffect(() => {
        onRefreshRef.current = onRefresh;
    }, [onRefresh]);

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined') return;
        // Touch-only: never attach on a fine (mouse) pointer.
        if (!window.matchMedia?.('(pointer: coarse)').matches) return;

        const atTop = () =>
            (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

        const reset = () => {
            startYRef.current = null;
            pullingRef.current = false;
            setPull(0);
        };

        const onTouchStart = (e: TouchEvent) => {
            if (refreshingRef.current || e.touches.length !== 1) return;
            if (!atTop()) {
                startYRef.current = null;
                return;
            }
            startYRef.current = e.touches[0].clientY;
            pullingRef.current = false;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (startYRef.current == null || refreshingRef.current) return;
            const dy = e.touches[0].clientY - startYRef.current;
            if (dy <= 0) {
                if (pullingRef.current) {
                    pullingRef.current = false;
                    setPull(0);
                }
                return;
            }
            // A pull only counts while still pinned to the top.
            if (!atTop()) {
                reset();
                return;
            }
            pullingRef.current = true;
            setPull(Math.min(MAX_PULL, dy * DAMPING));
        };

        const onTouchEnd = () => {
            if (startYRef.current == null) return;
            const shouldFire =
                pullingRef.current && distanceRef.current >= TRIGGER_THRESHOLD;
            startYRef.current = null;
            pullingRef.current = false;

            if (!shouldFire) {
                setPull(0);
                return;
            }

            haptic('tap');
            refreshingRef.current = true;
            setRefreshing(true);
            setPull(TRIGGER_THRESHOLD); // hold at the threshold while spinning
            const startedAt = Date.now();
            const minHold = reduced ? 0 : MIN_SPIN_MS;
            Promise.resolve()
                .then(() => onRefreshRef.current())
                .catch(() => {
                    /* refresh failures surface through the page's own error UI */
                })
                .finally(() => {
                    const wait = Math.max(0, minHold - (Date.now() - startedAt));
                    window.setTimeout(() => {
                        refreshingRef.current = false;
                        setRefreshing(false);
                        setPull(0);
                    }, wait);
                });
        };

        // Passive: we never call preventDefault — `overscroll-behavior-y:
        // contain` already suppresses the browser's native pull-to-refresh,
        // so there's nothing to cancel and the listeners stay scroll-perf
        // friendly.
        const opts: AddEventListenerOptions = { passive: true };
        window.addEventListener('touchstart', onTouchStart, opts);
        window.addEventListener('touchmove', onTouchMove, opts);
        window.addEventListener('touchend', onTouchEnd, opts);
        window.addEventListener('touchcancel', reset, opts);
        return () => {
            window.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            window.removeEventListener('touchcancel', reset);
        };
    }, [enabled, reduced, setPull]);

    const visible = distance > 0 || refreshing;
    const progress = Math.min(1, distance / TRIGGER_THRESHOLD);

    const indicator: ReactNode = visible ? (
        <div
            data-testid="pull-to-refresh-indicator"
            aria-hidden={!refreshing}
            className="md:hidden pointer-events-none fixed left-1/2 top-0 z-40"
            style={{
                transform: `translate(-50%, ${Math.max(0, distance - 12)}px)`,
                opacity: refreshing ? 1 : progress,
            }}
        >
            <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full border border-border-default bg-bg-default shadow-md">
                <span
                    className={cn(
                        'block h-5 w-5 rounded-full border-2 border-border-subtle border-t-[var(--brand-default)]',
                        refreshing && !reduced && 'animate-spin',
                    )}
                    style={
                        refreshing
                            ? undefined
                            : { transform: `rotate(${progress * 270}deg)` }
                    }
                />
            </div>
            {refreshing && (
                <span role="status" className="sr-only">
                    {t('refreshing')}
                </span>
            )}
        </div>
    ) : null;

    return { indicator, refreshing };
}

/**
 * `<PullToRefresh>` — one-line ergonomic wrapper over the hook for the
 * Fab list pages. Mounts the gesture + renders the fixed indicator with
 * no layout footprint of its own.
 *
 * ```tsx
 * <PullToRefresh onRefresh={() => mutate()} />
 * ```
 */
export function PullToRefresh(props: UsePullToRefreshOptions): ReactNode {
    const { indicator } = usePullToRefresh(props);
    return indicator;
}
