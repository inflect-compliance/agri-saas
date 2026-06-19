'use client';

/**
 * useReducedMotion — public hook for JS-driven motion (map flyTo easing,
 * haptics, RAF loops) to honour `prefers-reduced-motion`. CSS animations
 * already degrade globally (tokens.css flattens animation-duration under the
 * media query); this hook is for the cases CSS can't reach.
 *
 * SSR-safe: defaults to `false` (motion on) so the server markup matches the
 * first client render, then resolves on mount and stays live via the
 * matchMedia change event.
 */
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(QUERY);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount sync (SSR starts false)
        setReduced(mq.matches);
        const onChange = () => setReduced(mq.matches);
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, []);

    return reduced;
}

/** Imperative one-shot check (for non-React modules like haptics). */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
}
