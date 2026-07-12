'use client';

/**
 * Route view-transitions (mobile-native-feel PR-3).
 *
 * A progressive-enhancement wrapper over the browser View Transitions
 * API that gives client-side navigations a fast crossfade + slight
 * horizontal slide — the "the screen moved" cue every native app
 * ships. ZERO new dependencies: it stands entirely on
 * `document.startViewTransition` + the paired CSS in `globals.css`.
 *
 * Design — why link interception + a template signal:
 *
 *   The View Transitions API must wrap the DOM mutation: it snapshots
 *   the OLD page, runs a callback that swaps the DOM, then snapshots
 *   the NEW page and cross-fades between them. In the App Router the
 *   DOM swap is React's async re-render after `router.push`, so we:
 *     1. intercept an eligible `<a>` click in the CAPTURE phase (before
 *        Next's own Link handler), and
 *     2. call `startViewTransition(() => new Promise(resolve => { … }))`
 *        where the promise resolves only once the NEW route has
 *        committed — signalled by `src/app/template.tsx` (which
 *        re-mounts on every navigation) calling
 *        `signalNavigationComplete()` from its post-render effect.
 *   A safety timeout resolves the promise regardless, so a missed
 *   signal can never hang the page.
 *
 * Safety — enhancement never breaks navigation:
 *   - We attach nothing unless the browser supports the API AND the
 *     device is a coarse pointer (mobile) AND motion is enabled — so
 *     desktop, and anyone with `prefers-reduced-motion`, get the plain
 *     hard-cut Link behaviour untouched (`canEnhance()` is re-checked
 *     live on every click).
 *   - We only `preventDefault` for a click we are CERTAIN we can
 *     handle (plain left-click, same-origin, internal, real path
 *     change). Anything unusual — modifier keys, `target`, `download`,
 *     `rel=external`, cross-origin, hash-only — bails out and the
 *     browser/Link navigates normally.
 *   - `stopImmediatePropagation` in the capture phase prevents Next's
 *     Link handler (and row-click handlers) from ALSO navigating, so
 *     there is never a double push.
 */

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// `Document.startViewTransition` is typed by TS's lib.dom (optional —
// still absent in some engines), so no ambient declaration is needed;
// the runtime feature-checks below gate every call.

/** How long to wait for the route commit signal before force-resolving. */
const TRANSITION_TIMEOUT_MS = 600;

// ─── Route-commit signal (module scope) ───────────────────────────────
// `template.tsx` calls `signalNavigationComplete` from a post-render
// effect; the pending transition's DOM-swap promise resolves there.
let pendingResolve: (() => void) | null = null;

/** Called by `template.tsx` after the new route has committed to the DOM. */
export function signalNavigationComplete(): void {
    if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve();
    }
}

// ─── Live capability check ─────────────────────────────────────────────

/**
 * True when a view transition should be used for this navigation:
 * the API exists, the pointer is coarse (mobile), and the user has
 * not asked for reduced motion. Re-evaluated on every click so a
 * device rotating between docked/tablet modes or a live OS
 * motion-preference change is honoured without a reload.
 */
export function canEnhance(): boolean {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return false;
    }
    if (typeof document.startViewTransition !== 'function') return false;
    if (typeof window.matchMedia !== 'function') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false;
    }
    if (!window.matchMedia('(pointer: coarse)').matches) return false;
    return true;
}

// ─── Pure click-eligibility predicate (unit-tested) ────────────────────

export interface NavClickFlags {
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
}

export interface CurrentLocation {
    origin: string;
    pathname: string;
    search: string;
}

/**
 * Given the clicked anchor, the click's modifier flags, and the current
 * location, return the internal destination (`pathname + search + hash`)
 * that should be navigated via a view transition, or `null` if this
 * click must fall through to default browser/Link handling.
 *
 * Pure + DOM-light so it is unit-testable without dispatching real
 * events. All the "never break navigation" bail-outs live here.
 */
export function resolveNavTarget(
    anchor: HTMLAnchorElement | null,
    flags: NavClickFlags,
    current: CurrentLocation,
): string | null {
    if (flags.defaultPrevented) return null;
    if (flags.button !== 0) return null;
    if (flags.metaKey || flags.ctrlKey || flags.shiftKey || flags.altKey) {
        return null;
    }
    if (!anchor) return null;

    const target = anchor.getAttribute('target');
    if (target && target !== '_self') return null;
    if (anchor.hasAttribute('download')) return null;
    const rel = anchor.getAttribute('rel');
    if (rel && rel.split(/\s+/).includes('external')) return null;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return null;

    let url: URL;
    try {
        url = new URL(anchor.href, current.origin);
    } catch {
        return null;
    }
    if (url.origin !== current.origin) return null;
    // No real navigation (hash-only / identical path+query) → let default.
    if (url.pathname === current.pathname && url.search === current.search) {
        return null;
    }
    return url.pathname + url.search + url.hash;
}

// ─── Provider ──────────────────────────────────────────────────────────

/**
 * Mounts the document-level capture-phase click interceptor. Renders
 * its children untouched (pass-through) — the enhancement is entirely
 * a side effect, so it composes anywhere in the tree.
 */
export function ViewTransitions({ children }: { children: ReactNode }) {
    const router = useRouter();

    useEffect(() => {
        if (typeof document === 'undefined') return;
        // Cheap module-load gate: if the API is entirely absent we never
        // even attach the listener (desktop Firefox/Safari today).
        if (typeof document.startViewTransition !== 'function') return;

        const onClick = (event: MouseEvent) => {
            // Live re-check (motion pref / pointer type may have changed).
            if (!canEnhance()) return;

            const el = event.target;
            const anchor =
                el instanceof Element
                    ? (el.closest('a') as HTMLAnchorElement | null)
                    : null;

            const dest = resolveNavTarget(
                anchor,
                {
                    defaultPrevented: event.defaultPrevented,
                    button: event.button,
                    metaKey: event.metaKey,
                    ctrlKey: event.ctrlKey,
                    shiftKey: event.shiftKey,
                    altKey: event.altKey,
                },
                {
                    origin: window.location.origin,
                    pathname: window.location.pathname,
                    search: window.location.search,
                },
            );
            if (dest === null) return;

            // We are certain we can handle this click: stop the browser
            // AND Next's Link handler from ALSO navigating.
            event.preventDefault();
            event.stopImmediatePropagation();

            document.startViewTransition!(
                () =>
                    new Promise<void>((resolve) => {
                        pendingResolve = resolve;
                        // Safety net — never hang if the commit signal is missed.
                        window.setTimeout(() => {
                            if (pendingResolve === resolve) {
                                pendingResolve = null;
                                resolve();
                            }
                        }, TRANSITION_TIMEOUT_MS);
                        router.push(dest);
                    }),
            );
        };

        // Capture phase: runs before React's root listener, so
        // stopImmediatePropagation reliably suppresses Link's onClick.
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [router]);

    return <>{children}</>;
}
