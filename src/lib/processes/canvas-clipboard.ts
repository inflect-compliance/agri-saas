"use client";

/**
 * Epic P4-PR-B — Canvas clipboard (Cmd+C / Cmd+V / Cmd+D).
 *
 * Closes the brief's #6 🟠 "Copy / Paste / Duplicate Nodes" gap.
 * Pre-P4 the only way to clone canvas content was the map-level
 * duplicate (the whole graph into a fresh map). Per-node clipboard
 * operations are how every drawing tool works.
 *
 * Why module-scope (not React state):
 *   - The clipboard outlives the component lifecycle. A user can
 *     copy from one map, switch to another, and paste. State
 *     scoped to <PersistedProcessCanvas> would clear on remount.
 *   - The browser's native clipboard isn't suitable: nodes carry
 *     non-string data (positions, dataJson, parent refs). A
 *     module-scoped JS object captures the full shape losslessly.
 *
 * Re-keying on paste:
 *   - Every node id is re-minted on paste so a pasted-twice
 *     selection produces TWO copies, not a clobber.
 *   - Internal edges (both endpoints in the copied selection)
 *     also re-key + remap to point at the new node ids.
 *   - External edges (one endpoint outside the selection) are
 *     dropped on paste — the new copies are floating until the
 *     user wires them.
 *
 * Offset on paste:
 *   - The pasted block is shifted by `PASTE_OFFSET` px so a
 *     pasted-on-top selection is visually distinguishable from
 *     the original.
 */

import type { Edge, Node } from "@xyflow/react";

const PASTE_OFFSET = 28;

interface ClipboardPayload {
    nodes: Node[];
    edges: Edge[];
}

let CLIPBOARD: ClipboardPayload | null = null;

/**
 * Capture the selected nodes + their INTERNAL edges (both
 * endpoints in the selection) into the module clipboard.
 */
export function copyToClipboard(
    selectedNodes: Node[],
    allEdges: Edge[],
): void {
    if (selectedNodes.length === 0) {
        CLIPBOARD = null;
        return;
    }
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const internalEdges = allEdges.filter(
        (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
    );
    // Shallow-clone so future mutations on the live nodes don't
    // bleed into the clipboard payload.
    CLIPBOARD = {
        nodes: selectedNodes.map((n) => ({ ...n, data: { ...n.data } })),
        edges: internalEdges.map((e) => ({ ...e, data: { ...e.data } })),
    };
}

/** True when something is in the clipboard. */
export function hasClipboard(): boolean {
    return CLIPBOARD !== null && CLIPBOARD.nodes.length > 0;
}

/**
 * Produce a fresh, re-keyed paste payload. The caller appends the
 * returned nodes + edges to the live canvas state.
 *
 * `idMint` lets the caller supply its own id-minter (sequential,
 * uuid, …). The default `idMint` returns a short timestamp+random
 * id that's stable enough for canvas use.
 */
export function pasteFromClipboard(opts?: {
    idMint?: () => string;
}): ClipboardPayload | null {
    if (!CLIPBOARD) return null;
    const mint = opts?.idMint ?? defaultIdMint;
    // Build the old-id → new-id map first so internal edges
    // can rewrite their endpoints.
    const idMap = new Map<string, string>();
    for (const n of CLIPBOARD.nodes) idMap.set(n.id, mint());
    const nodes: Node[] = CLIPBOARD.nodes.map((n) => ({
        ...n,
        id: idMap.get(n.id)!,
        // Re-map parentId if the parent was also copied; else drop.
        ...((n as { parentId?: string }).parentId &&
        idMap.has((n as { parentId?: string }).parentId!)
            ? {
                  parentId: idMap.get(
                      (n as { parentId?: string }).parentId!,
                  )!,
              }
            : { parentId: undefined }),
        position: {
            x: n.position.x + PASTE_OFFSET,
            y: n.position.y + PASTE_OFFSET,
        },
        // Clear any selection / dragging state from the source.
        selected: true,
    }));
    const edges: Edge[] = CLIPBOARD.edges.map((e) => ({
        ...e,
        id: `edge-${mint()}`,
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
        selected: false,
    }));
    return { nodes, edges };
}

/** Clear the clipboard. Exposed for tests + the no-op edge case. */
export function clearClipboard(): void {
    CLIPBOARD = null;
}

function defaultIdMint(): string {
    return `n-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

// Test-only: reset the module-scope clipboard between tests.
export function __resetClipboardForTests(): void {
    CLIPBOARD = null;
}
