'use client';

/**
 * Root template (mobile-native-feel PR-3).
 *
 * A `template.tsx` re-mounts on every client-side navigation (unlike a
 * `layout.tsx`, which persists). We use that lifecycle as the "the new
 * route has committed to the DOM" signal for the View Transitions API:
 * once this component's post-render effect fires, the incoming page is
 * painted, so the pending `startViewTransition` DOM-swap promise can
 * resolve and the browser captures the NEW snapshot to cross-fade into.
 *
 * When no transition is in flight (`pendingResolve` is null, e.g. on
 * desktop / reduced-motion / first load) `signalNavigationComplete()`
 * is a cheap no-op — this template stays a transparent pass-through.
 */

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { signalNavigationComplete } from '@/lib/view-transitions';

export default function Template({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    useEffect(() => {
        signalNavigationComplete();
    }, [pathname]);
    return <>{children}</>;
}
