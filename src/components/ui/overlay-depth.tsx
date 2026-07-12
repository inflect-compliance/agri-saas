"use client";

/**
 * P3.2 — Overlay nesting depth.
 *
 * A single React context that tracks how deeply the current subtree is
 * nested inside stacked overlays (Modal / Sheet / Popover). Each overlay
 * root wraps its own children in `<OverlayDepthProvider>`, which reads the
 * ambient depth and provides `depth + 1`.
 *
 * Why it exists: on mobile, a `<Popover>` (or a `<Combobox>` built on one)
 * that opens WHILE a Sheet/Modal is already on screen would otherwise mount
 * a SECOND Vaul bottom-sheet stacked on the first — janky, and it steals the
 * drag/focus model from the parent drawer. Reading the depth lets the
 * Popover auto-render as a portalled dropdown (the desktop-style surface)
 * whenever it's already inside an overlay (`depth > 0`), even on a phone.
 *
 * This retires the manual `forceDropdown` nesting opt-in: nesting is now
 * detected automatically. `forceDropdown` survives only as an EXPLICIT
 * always-dropdown override for on-page pickers (e.g. a map prescription
 * picker where a bottom-sheet would cover the map) — the Popover ORs the two
 * signals (`forceDropdown || overlayDepth > 0`).
 *
 * SSR-safe: it's plain context with a numeric default of 0, so the server
 * render and first client render agree.
 */

import { createContext, useContext, useMemo, type PropsWithChildren } from "react";

/** Ambient overlay nesting depth. 0 = not inside any overlay. */
const OverlayDepthContext = createContext(0);

/**
 * Read the current overlay nesting depth. `0` at the page root; `1` inside
 * a single Modal/Sheet/Popover; higher when overlays stack.
 */
export function useOverlayDepth(): number {
    return useContext(OverlayDepthContext);
}

/**
 * Wrap an overlay root's children so descendants read `depth + 1`. Mount
 * this exactly once per overlay surface (Modal, Sheet, Popover content) —
 * never around ordinary page content.
 */
export function OverlayDepthProvider({ children }: PropsWithChildren) {
    const parentDepth = useContext(OverlayDepthContext);
    const value = useMemo(() => parentDepth + 1, [parentDepth]);
    return (
        <OverlayDepthContext.Provider value={value}>
            {children}
        </OverlayDepthContext.Provider>
    );
}
