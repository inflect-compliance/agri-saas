"use client";

/**
 * R26-PR-F — Canvas help strip.
 *
 * Dismissible single-line strip below the toolbar that teaches
 * the four canonical interactions a first-time user wouldn't
 * discover on their own:
 *
 *   1. Drag from the palette to add a node.
 *   2. Connect handles to draw an edge manually.
 *   3. Drop a node near another to auto-bind.
 *   4. Click an edge → "Add control" to mount a governance object.
 *
 * Disciplines applied (per the R26-PR-F brief):
 *   • Visible only when needed — auto-hides once the user
 *     dismisses it OR once the canvas has both nodes AND edges
 *     (signals "I've figured it out"). Affordances must not
 *     linger past the moment of need.
 *   • Persistent dismiss — localStorage key + version stamp so
 *     a returning user sees the strip exactly once. Bumping the
 *     stamp resets the dismissal (the few times we'd want to
 *     re-show: when the four interactions evolve).
 *   • Calm tone — single sentence per interaction, separated by
 *     middle dots. No icons (they'd compete with the palette's
 *     icons for attention). No "Got it" button per row.
 */

import { useEffect, useState } from "react";

/**
 * localStorage key + version stamp. Bump the suffix if the
 * canonical four interactions change (e.g. drag-from-edge,
 * dismissed users will re-see the new copy once).
 */
const DISMISS_KEY = "ic.processes-canvas-help.v2";

interface CanvasHelpStripProps {
    /**
     * Treat the canvas as "in-use" — once both nodes AND edges
     * exist, the strip self-hides without needing the user to
     * dismiss. Keeps long-time users from seeing a tutorial
     * permanently pinned to their workspace.
     */
    nodeCount: number;
    edgeCount: number;
}

export function CanvasHelpStrip({
    nodeCount,
    edgeCount,
}: CanvasHelpStripProps) {
    const [dismissed, setDismissed] = useState<boolean | null>(null);

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(DISMISS_KEY);
            setDismissed(stored === "1");
        } catch {
            // localStorage access can fail in private-mode / SSR
            // — fail open (show the strip) rather than crash the
            // canvas.
            setDismissed(false);
        }
    }, []);

    // While we're resolving the localStorage state, render
    // nothing so the strip doesn't flash before the first paint.
    if (dismissed === null) return null;
    if (dismissed) return null;
    if (nodeCount > 0 && edgeCount > 0) return null;

    const handleDismiss = () => {
        try {
            window.localStorage.setItem(DISMISS_KEY, "1");
        } catch {
            // Ignore — the user just won't see it dismissed on
            // the next visit. Acceptable degradation.
        }
        setDismissed(true);
    };

    return (
        <div
            className="flex items-center gap-default border-b border-canvas-border px-default py-1.5 text-[11px] text-content-subtle"
            data-canvas-help-strip="true"
            role="note"
            aria-label="Canvas usage hints"
        >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">
                Tips
            </span>
            <span aria-hidden="true">·</span>
            <span>Drag from the palette to add a node.</span>
            <span aria-hidden="true">·</span>
            <span>Connect handles to draw an edge.</span>
            <span aria-hidden="true">·</span>
            <span>Drop a node near another to auto-bind.</span>
            <span aria-hidden="true">·</span>
            <span>Select an edge to set its style or add a control.</span>
            <button
                type="button"
                onClick={handleDismiss}
                className="ml-auto rounded-[6px] border border-transparent px-2 py-0.5 text-content-subtle transition-colors hover:border-canvas-border hover:text-content-emphasis"
                aria-label="Dismiss canvas hints"
                data-testid="canvas-help-dismiss"
            >
                Got it
            </button>
        </div>
    );
}
