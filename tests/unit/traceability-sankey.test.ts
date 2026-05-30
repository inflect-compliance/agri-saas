/**
 * Epic 47.3 — pure helpers behind the Sankey traceability view.
 *
 * Covers the dataset projection (column placement, edge direction
 * flipping, weight aggregation, search-aware filtering) and the
 * layout helper (column-x positions, node-y stacking, link path
 * generation).
 */

import {
    buildSankeyDataset,
    computeSankeyLayout,
} from '@/lib/traceability-graph/sankey';
import type {
    TraceabilityEdge,
    TraceabilityGraph,
    TraceabilityNode,
} from '@/lib/traceability-graph/types';

function n(
    id: string,
    kind: TraceabilityNode['kind'],
    label = id,
): TraceabilityNode {
    return {
        id,
        kind,
        label,
        secondary: null,
        badge: null,
        href: `/x/${id}`,
    };
}

function e(
    id: string,
    source: string,
    target: string,
    relation: TraceabilityEdge['relation'] = 'mitigates',
): TraceabilityEdge {
    return { id, source, target, relation, qualifier: null };
}

function graph(
    nodes: TraceabilityNode[],
    edges: TraceabilityEdge[],
): TraceabilityGraph {
    return {
        nodes,
        edges,
        categories: [],
        meta: { truncated: false, droppedNodeCount: 0, nodeCap: null, appliedFilters: {} },
    };
}

// ─── Builder — column projection ───────────────────────────────────────

describe('buildSankeyDataset — column placement', () => {
    it('places every node into its kind column with stable layout indices', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk'), n('c1', 'control')],
            [],
        );
        const ds = buildSankeyDataset(g);
        const byId = Object.fromEntries(ds.nodes.map((x) => [x.id, x.columnIndex]));
        expect(byId.a1).toBe(0); // asset → col 0
        expect(byId.r1).toBe(1); // risk  → col 1
        expect(byId.c1).toBe(2); // control → col 2
    });

    it('drops kinds outside the column layout (requirement, policy)', () => {
        const g = graph(
            [
                n('a1', 'asset'),
                n('q1', 'requirement'),
                n('p1', 'policy'),
            ],
            [],
        );
        const ds = buildSankeyDataset(g);
        expect(ds.nodes.map((x) => x.id).sort()).toEqual(['a1']);
    });

    it('reports per-column counts and skips empty columns', () => {
        const g = graph([n('a1', 'asset'), n('a2', 'asset')], []);
        const ds = buildSankeyDataset(g);
        expect(ds.columns).toHaveLength(1);
        expect(ds.columns[0]).toMatchObject({ kind: 'asset', count: 2 });
    });
});

// ─── Builder — edge projection ─────────────────────────────────────────

describe('buildSankeyDataset — edge projection', () => {
    it('keeps cross-column edges and flips direction so source.col < target.col', () => {
        // Underlying graph: control "mitigates" risk (control → risk).
        // In sankey columns risk(1) < control(2), so the link should
        // be flipped to risk → control for left-to-right rendering.
        const g = graph(
            [n('c1', 'control'), n('r1', 'risk')],
            [e('e1', 'c1', 'r1', 'mitigates')],
        );
        const ds = buildSankeyDataset(g);
        expect(ds.links).toHaveLength(1);
        expect(ds.links[0]).toMatchObject({ source: 'r1', target: 'c1' });
    });

    it('drops intra-column edges (no Sankey self-loops)', () => {
        const g = graph(
            [n('a1', 'asset'), n('a2', 'asset')],
            [e('e1', 'a1', 'a2')],
        );
        const ds = buildSankeyDataset(g);
        expect(ds.links).toHaveLength(0);
    });

    it('aggregates per-node weight from incident links', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk'), n('r2', 'risk'), n('c1', 'control')],
            [
                e('l1', 'a1', 'r1', 'exposes'),
                e('l2', 'a1', 'r2', 'exposes'),
                e('l3', 'c1', 'r1', 'mitigates'),
            ],
        );
        const ds = buildSankeyDataset(g);
        const weight = (id: string) => ds.nodes.find((x) => x.id === id)?.weight;
        expect(weight('a1')).toBe(2); // two outgoing
        expect(weight('r1')).toBe(2); // one in (asset), one in (control after flip)
        expect(weight('r2')).toBe(1);
        expect(weight('c1')).toBe(1);
    });
});

// ─── Builder — search-aware filtering ──────────────────────────────────

describe('buildSankeyDataset — search filtering', () => {
    it('passes through the full graph when no query is set', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk')],
            [e('e1', 'a1', 'r1', 'exposes')],
        );
        const ds = buildSankeyDataset(g);
        expect(ds.nodes).toHaveLength(2);
        expect(ds.emptyAfterFilter).toBe(false);
    });

    it('keeps matched + adjacent nodes only', () => {
        const g = graph(
            [
                n('a1', 'asset', 'Prod DB'),
                n('a2', 'asset', 'Other'),
                n('r1', 'risk', 'Phishing'),
            ],
            [e('e1', 'a1', 'r1', 'exposes')],
        );
        const ds = buildSankeyDataset(g, { searchQuery: 'phish' });
        // Match: r1 (label). Adjacent: a1 (linked). Dropped: a2.
        expect(ds.nodes.map((x) => x.id).sort()).toEqual(['a1', 'r1']);
    });

    it('flags emptyAfterFilter when query yields no nodes but graph has data', () => {
        const g = graph([n('a1', 'asset', 'Prod DB')], []);
        const ds = buildSankeyDataset(g, { searchQuery: 'no-such-thing' });
        expect(ds.nodes).toHaveLength(0);
        expect(ds.emptyAfterFilter).toBe(true);
    });
});

// ─── Layout — column positions ─────────────────────────────────────────

describe('computeSankeyLayout — column positions', () => {
    it('assigns each column a unique x within the canvas', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk'), n('c1', 'control')],
            [e('e1', 'a1', 'r1', 'exposes'), e('e2', 'r1', 'c1', 'mitigates')],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 900, height: 400 });
        expect(lay.columns).toHaveLength(3);
        const xs = lay.columns.map((c) => c.x);
        expect(new Set(xs).size).toBe(3); // all distinct
        expect(xs[0]).toBe(0);
        expect(xs[2]).toBeGreaterThan(xs[1]);
    });

    it('centers a single column on the canvas', () => {
        const g = graph([n('a1', 'asset')], []);
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 400 });
        expect(lay.columns).toHaveLength(1);
        // Single-column layout centers (canvas_width - node_width) / 2.
        expect(lay.columns[0].x).toBe((800 - 16) / 2);
    });
});

// ─── Layout — node sizing ──────────────────────────────────────────────

describe('computeSankeyLayout — node sizing', () => {
    it('gives every node a non-zero height (clamps below the min)', () => {
        const g = graph(
            [n('a1', 'asset'), n('a2', 'asset'), n('a3', 'asset')],
            [],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 200 });
        for (const node of lay.nodes) {
            expect(node.height).toBeGreaterThanOrEqual(8);
        }
    });

    it('stacks nodes within a column non-overlappingly', () => {
        const g = graph(
            [n('a1', 'asset'), n('a2', 'asset')],
            [],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 400 });
        const col0 = lay.nodes
            .filter((n) => n.columnIndex === 0)
            .sort((a, b) => a.y - b.y);
        expect(col0[1].y).toBeGreaterThan(col0[0].y + col0[0].height);
    });

    it('node weight scales the bar height — heavier node is taller', () => {
        const g = graph(
            [n('a1', 'asset'), n('a2', 'asset'), n('r1', 'risk')],
            [
                e('e1', 'a1', 'r1', 'exposes'),
                e('e2', 'a1', 'r1', 'exposes'),
                e('e3', 'a2', 'r1', 'exposes'),
            ],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 400 });
        const a1 = lay.nodes.find((n) => n.id === 'a1');
        const a2 = lay.nodes.find((n) => n.id === 'a2');
        // a1 has weight 2, a2 has weight 1 → a1 is taller (or
        // tied at the floor in degenerate canvases). With a 400px
        // canvas the difference is comfortable.
        expect(a1!.height).toBeGreaterThan(a2!.height);
    });

    it('grows the canvas height to fit a busy column (fit-to-content, no clip)', () => {
        // 40 assets all flowing into one risk. At the 8px node floor +
        // 8px gaps the column stacks well past a 480px canvas; the
        // layout must report a height tall enough to contain it so the
        // SVG viewBox does not silently clip the lower nodes.
        const assets = Array.from({ length: 40 }, (_, i) => n(`a${i}`, 'asset'));
        const edges = assets.map((a, i) => e(`e${i}`, a.id, 'r1', 'exposes'));
        const g = graph([...assets, n('r1', 'risk')], edges);
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 480 });

        // Canvas grew well beyond the requested 480.
        expect(lay.height).toBeGreaterThan(480);
        // Every node sits fully within the reported height (nothing
        // clipped below the canvas).
        for (const node of lay.nodes) {
            expect(node.y + node.height).toBeLessThanOrEqual(lay.height);
        }
    });

    it('keeps the requested height when everything already fits', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk')],
            [e('e1', 'a1', 'r1', 'exposes')],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 480 });
        expect(lay.height).toBe(480);
    });
});

// ─── Layout — links ────────────────────────────────────────────────────

describe('computeSankeyLayout — links', () => {
    it('emits a cubic-bezier path for each link', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk')],
            [e('e1', 'a1', 'r1', 'exposes')],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 400 });
        expect(lay.links).toHaveLength(1);
        // Cubic-bezier path: starts with M, contains exactly one C.
        expect(lay.links[0].pathD).toMatch(/^M\s+\d/);
        expect(lay.links[0].pathD).toMatch(/\bC\s+/);
    });

    it('clamps stroke width above 1px so 1-link flows still render', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk')],
            [e('e1', 'a1', 'r1', 'exposes')],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 400 });
        expect(lay.links[0].strokeWidth).toBeGreaterThanOrEqual(1);
    });

    it('stamps each link with its source kind for color cue', () => {
        const g = graph(
            [n('a1', 'asset'), n('r1', 'risk')],
            [e('e1', 'a1', 'r1', 'exposes')],
        );
        const ds = buildSankeyDataset(g);
        const lay = computeSankeyLayout(ds, { width: 800, height: 400 });
        expect(lay.links[0].sourceKind).toBe('asset');
    });
});
