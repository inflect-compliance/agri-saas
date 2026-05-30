/**
 * Epic 47.3 — pure helpers for the Sankey traceability view.
 *
 * Reuses the existing `TraceabilityGraph` payload (no new
 * endpoint, no refetch) and projects it onto Sankey columns. The
 * shape this view tells:
 *
 *   Assets   →   Risks   →   Controls
 *   "exposes"    "mitigates" (reversed direction)
 *
 * Why this orientation: it follows the operator's mental model —
 * "an asset exposes us to a risk; that risk is mitigated by
 * controls." Reading left-to-right reads the same as the audit
 * narrative.
 *
 * Cross-framework requirement-mapping is a richer Sankey we may
 * want later (Source-framework requirements → Controls →
 * Target-framework requirements). The contract here was designed
 * with that future in mind: the column model is a first-class
 * concept, not hard-coded to three tiers.
 *
 * Renderer-agnostic: returns a pure dataset. The
 * `<SankeyChart>` SVG component owns layout (column-x, node-y,
 * cubic-bezier paths). Renderers can swap (recharts, d3-sankey,
 * a custom one) without touching the contract.
 */

import { computeSearchHighlight } from './search';
import type {
    TraceabilityGraph,
    TraceabilityNodeKind,
} from './types';

// ─── Public types ──────────────────────────────────────────────────────

export interface SankeyNode {
    /** Stable id — matches the underlying entity's id. */
    id: string;
    /** Display label (truncated by the renderer). */
    label: string;
    /** 0-based column index — the renderer maps these to x positions. */
    columnIndex: number;
    /** Entity kind for color cue (sourced from the original graph payload). */
    kind: TraceabilityNodeKind;
    /** Sum of incoming + outgoing link values; used for node bar height. */
    weight: number;
    /** Detail-page href for click-through. */
    href: string | null;
}

export interface SankeyLink {
    id: string;
    source: string;
    target: string;
    /** Flow magnitude — for the simple count Sankey, always 1; future
     * builders may aggregate. */
    value: number;
    /**
     * The original edge's relation tag (`mitigates`, `exposes`, etc.).
     * Used for tooltip / legend grouping.
     */
    relation: string;
}

export interface SankeyColumn {
    index: number;
    label: string;
    /** `kind` whose nodes fill this column (single-kind columns only for now). */
    kind: TraceabilityNodeKind;
    /** Number of nodes the column actually carries (for the legend). */
    count: number;
}

export interface SankeyDataset {
    columns: SankeyColumn[];
    nodes: SankeyNode[];
    links: SankeyLink[];
    /**
     * True when the underlying graph carried at least one node, but
     * after column projection / search filtering the Sankey ended
     * up empty. Lets the renderer pick a smarter empty-state copy.
     */
    emptyAfterFilter: boolean;
}

// ─── Builder options ───────────────────────────────────────────────────

export interface BuildSankeyOptions {
    /**
     * Optional search query — when set, only nodes that match OR
     * are adjacent to a match end up in the Sankey. Mirrors the
     * graph + table view filtering for state-preservation parity.
     */
    searchQuery?: string;
}

// ─── Column projection ─────────────────────────────────────────────────

/**
 * The column layout for the asset → risk → control flow.
 * Stable ordering means the renderer never has to think about
 * direction.
 */
const COLUMN_LAYOUT: ReadonlyArray<{ index: number; kind: TraceabilityNodeKind; label: string }> = [
    { index: 0, kind: 'asset', label: 'Assets' },
    { index: 1, kind: 'risk', label: 'Risks' },
    { index: 2, kind: 'control', label: 'Controls' },
];

/**
 * Builds the Sankey dataset from a `TraceabilityGraph`.
 *
 * Algorithm:
 *   1. Optionally narrow the graph via `computeSearchHighlight` —
 *      keep nodes that are matched OR adjacent.
 *   2. Place every surviving node into its column based on `kind`.
 *      Drop kinds outside the column layout (today: `requirement`,
 *      `policy` — they're rendered in graph view but not in this
 *      Sankey orientation).
 *   3. Project edges: for each edge whose endpoints both survive,
 *      flip direction if needed so source.column < target.column,
 *      then write a link.
 *   4. Compute per-node weight (sum of incident link values) for
 *      the renderer's bar-height calculation.
 *
 * Pure / deterministic.
 */
export function buildSankeyDataset(
    graph: TraceabilityGraph,
    options: BuildSankeyOptions = {},
): SankeyDataset {
    const highlight = computeSearchHighlight(
        graph.nodes,
        graph.edges,
        options.searchQuery ?? '',
    );

    const inScope = (id: string): boolean => {
        if (!highlight.hasQuery) return true;
        return highlight.matched.has(id) || highlight.adjacent.has(id);
    };

    // Column lookup keyed on kind.
    const colByKind = new Map(COLUMN_LAYOUT.map((c) => [c.kind, c]));

    // 1+2. Filter + place nodes.
    const placedNodes = new Map<string, SankeyNode>();
    for (const node of graph.nodes) {
        if (!inScope(node.id)) continue;
        const col = colByKind.get(node.kind);
        if (!col) continue; // kinds outside the layout are dropped
        placedNodes.set(node.id, {
            id: node.id,
            label: node.label,
            columnIndex: col.index,
            kind: node.kind,
            weight: 0, // accumulated below
            href: node.href,
        });
    }

    // 3. Project edges. We care about edges that connect two
    // distinct columns; intra-column edges aren't representable in
    // a Sankey and would self-loop.
    const links: SankeyLink[] = [];
    for (const edge of graph.edges) {
        const src = placedNodes.get(edge.source);
        const tgt = placedNodes.get(edge.target);
        if (!src || !tgt) continue;
        if (src.columnIndex === tgt.columnIndex) continue;
        // Flip so source column < target column. Sankey flows are
        // directional in layout terms even when the underlying
        // relation is conceptually symmetric.
        const [from, to] =
            src.columnIndex < tgt.columnIndex ? [src, tgt] : [tgt, src];
        links.push({
            id: edge.id,
            source: from.id,
            target: to.id,
            value: 1,
            relation: edge.relation,
        });
    }

    // 4. Aggregate weights. A node with high weight gets a tall
    // bar, which is the visual anchor of the Sankey.
    for (const link of links) {
        const src = placedNodes.get(link.source);
        const tgt = placedNodes.get(link.target);
        if (src) src.weight += link.value;
        if (tgt) tgt.weight += link.value;
    }

    // 5. Build column metadata, dropping any column that ended up
    // empty after the filter — keeps the renderer simple and
    // avoids painting a header for an empty band.
    const columns: SankeyColumn[] = [];
    for (const layout of COLUMN_LAYOUT) {
        const count = [...placedNodes.values()].filter(
            (n) => n.columnIndex === layout.index,
        ).length;
        if (count === 0) continue;
        columns.push({ ...layout, count });
    }

    const nodes = [...placedNodes.values()];
    return {
        columns,
        nodes,
        links,
        emptyAfterFilter: highlight.hasQuery && nodes.length === 0 && graph.nodes.length > 0,
    };
}

// ─── Layout helper ─────────────────────────────────────────────────────

/**
 * Compute SVG node + link coordinates for the Sankey renderer.
 *
 * Pure: same input → same coords. Pulled out of the React
 * component so layout decisions are unit-testable without a DOM.
 *
 * Layout strategy (intentionally simple, not d3-sankey-grade):
 *   - Columns are evenly spaced along width.
 *   - Within a column, nodes stack top→bottom in input order.
 *     Each node's height is proportional to its weight (clamped
 *     to a minimum so 1-link nodes don't disappear).
 *   - Total stack height per column is normalised to fit the
 *     vertical viewport with a small gap between nodes.
 *   - Links use cubic-bezier paths with control points at column
 *     midpoint x.
 *
 * For very large datasets the lack of crossing-minimisation will
 * read as "spaghetti". Acceptable for the MVP where most tenants
 * have under ~50 nodes per column. Swap with d3-sankey later if
 * needed — the contract here is the only thing the renderer reads.
 */
export interface LaidOutNode extends SankeyNode {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LaidOutLink {
    id: string;
    source: string;
    target: string;
    value: number;
    relation: string;
    /** Pre-computed SVG path `d` attribute. */
    pathD: string;
    /** Stroke width — proportional to value; clamped above 1px. */
    strokeWidth: number;
    /** Source kind, for color cue. */
    sourceKind: TraceabilityNodeKind;
}

export interface SankeyLayout {
    width: number;
    height: number;
    nodes: LaidOutNode[];
    links: LaidOutLink[];
    columns: ReadonlyArray<SankeyColumn & { x: number }>;
}

const NODE_WIDTH = 16;
const NODE_GAP = 8;
const NODE_MIN_HEIGHT = 8;
const COLUMN_PADDING_TOP = 32;
const COLUMN_PADDING_BOTTOM = 16;

export function computeSankeyLayout(
    dataset: SankeyDataset,
    canvas: { width: number; height: number },
): SankeyLayout {
    const { width, height } = canvas;
    const usableHeight = Math.max(
        height - COLUMN_PADDING_TOP - COLUMN_PADDING_BOTTOM,
        100,
    );

    // Column x-positions: evenly spaced.
    const colCount = dataset.columns.length;
    const colXs: number[] = [];
    if (colCount === 1) {
        colXs.push((width - NODE_WIDTH) / 2);
    } else if (colCount > 1) {
        const stride = (width - NODE_WIDTH) / (colCount - 1);
        for (let i = 0; i < colCount; i++) colXs.push(i * stride);
    }

    // Group nodes by column for vertical layout.
    const colIndexToCanvasIndex = new Map<number, number>();
    dataset.columns.forEach((c, i) => colIndexToCanvasIndex.set(c.index, i));

    const nodesByCol = new Map<number, SankeyNode[]>();
    for (const n of dataset.nodes) {
        const list = nodesByCol.get(n.columnIndex) ?? [];
        list.push(n);
        nodesByCol.set(n.columnIndex, list);
    }

    const laidNodes: LaidOutNode[] = [];
    // Track the lowest point any column reaches so the canvas can grow
    // to fit ALL nodes (fit-to-content). Pre-fix, a busy column stacked
    // past the fixed `height` and the SVG viewBox silently clipped the
    // overflow — you literally could not see the lower controls/risks.
    let maxStackY = COLUMN_PADDING_TOP;
    for (const [colIndex, nodes] of nodesByCol) {
        const canvasIdx = colIndexToCanvasIndex.get(colIndex);
        if (canvasIdx === undefined) continue;
        const x = colXs[canvasIdx];
        const totalWeight = nodes.reduce((s, n) => s + Math.max(n.weight, 1), 0);
        const totalGap = NODE_GAP * Math.max(nodes.length - 1, 0);
        const heightForBars = Math.max(usableHeight - totalGap, NODE_MIN_HEIGHT * nodes.length);
        let y = COLUMN_PADDING_TOP;
        for (const n of nodes) {
            const w = Math.max(n.weight, 1);
            const h = Math.max(NODE_MIN_HEIGHT, (w / totalWeight) * heightForBars);
            laidNodes.push({ ...n, x, y, width: NODE_WIDTH, height: h });
            y += h + NODE_GAP;
        }
        // `y` overshoots by one trailing gap; the real bottom is the
        // last node's end.
        maxStackY = Math.max(maxStackY, y - NODE_GAP);
    }

    // Fit-to-content: the canvas is at least the requested height, but
    // grows taller when a column's stack needs more room. Consumers
    // render the SVG at this height (vertical scroll) or scale it to
    // fit the viewport (zoom-out) — either way nothing clips.
    const contentHeight = Math.max(height, maxStackY + COLUMN_PADDING_BOTTOM);

    // Build a quick lookup for link endpoints.
    const nodeById = new Map(laidNodes.map((n) => [n.id, n]));

    // Track each link's vertical offset within its source / target
    // node. Without this, multiple links share the same y on the
    // node bar and overlap visually.
    const linkSrcOffsets = new Map<string, number>();
    const linkTgtOffsets = new Map<string, number>();

    const laidLinks: LaidOutLink[] = [];
    for (const link of dataset.links) {
        const src = nodeById.get(link.source);
        const tgt = nodeById.get(link.target);
        if (!src || !tgt) continue;
        const srcOffset = linkSrcOffsets.get(src.id) ?? 0;
        const tgtOffset = linkTgtOffsets.get(tgt.id) ?? 0;
        const stroke = Math.max(1, Math.min(8, link.value * 2));
        const sx = src.x + src.width;
        const sy = src.y + Math.min(srcOffset + stroke / 2, src.height);
        const tx = tgt.x;
        const ty = tgt.y + Math.min(tgtOffset + stroke / 2, tgt.height);
        const midX = (sx + tx) / 2;
        const pathD = `M ${sx},${sy} C ${midX},${sy} ${midX},${ty} ${tx},${ty}`;
        laidLinks.push({
            id: link.id,
            source: link.source,
            target: link.target,
            value: link.value,
            relation: link.relation,
            pathD,
            strokeWidth: stroke,
            sourceKind: src.kind,
        });
        linkSrcOffsets.set(src.id, srcOffset + stroke);
        linkTgtOffsets.set(tgt.id, tgtOffset + stroke);
    }

    return {
        width,
        height: contentHeight,
        nodes: laidNodes,
        links: laidLinks,
        columns: dataset.columns.map((c, i) => ({ ...c, x: colXs[i] })),
    };
}
