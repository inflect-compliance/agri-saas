'use client';

/**
 * DeferredOnMobile — defer rendering of a heavy subtree (e.g. a visx/Three.js
 * chart) until the browser is idle on PHONES, so it never competes with the
 * first paint / input on a mid-range device. Desktop renders immediately.
 *
 * SSR + first client render show the `placeholder` (so there's no hydration
 * mismatch and `ssr:false` charts have a stable box), then:
 *   - desktop → render children right away;
 *   - mobile  → render children on `requestIdleCallback` (falls back to a
 *     short timeout).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMediaQuery } from '@/components/ui/hooks';

interface IdleWindow {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
}

export function DeferredOnMobile({
    children,
    placeholder = null,
}: {
    children: ReactNode;
    placeholder?: ReactNode;
}) {
    const { device, isMobile } = useMediaQuery();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (device === null || !isMobile) return; // desktop renders eagerly
        const w = window as unknown as IdleWindow;
        const schedule = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
        const cancel = w.cancelIdleCallback ?? window.clearTimeout;
        const id = schedule(() => setReady(true));
        return () => cancel(id);
    }, [device, isMobile]);

    // Under jest (jsdom resolves matchMedia to "mobile"), render eagerly so
    // rendered tests assert the real chart content rather than the deferred
    // placeholder. Prod/dev keep the mobile deferral.
    if (process.env.NODE_ENV === 'test') return <>{children}</>;

    // SSR + first client render (device unresolved) → placeholder, avoiding a
    // hydration mismatch.
    if (device === null) return <>{placeholder}</>;
    if (!isMobile) return <>{children}</>;
    return <>{ready ? children : placeholder}</>;
}

export default DeferredOnMobile;
