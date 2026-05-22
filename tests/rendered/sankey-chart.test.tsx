/**
 * Roadmap-7 P2 — SankeyChart rendered behavioural test.
 *
 * SankeyChart was the one high-risk chart primitive with zero
 * rendered coverage — structural ratchets
 * (`r21-prb-sankey-rebuild.test.ts`) scan its source, and a unit
 * test (`traceability-sankey.test.ts`) covers the pure layout
 * helpers, but nothing rendered the component and asserted what it
 * actually paints or how it responds to interaction.
 *
 * This is a Tier-2 test (see docs/frontend-assurance-model.md): it
 * renders the real component and asserts COMPUTED / RENDERED
 * outcomes — the graph projected into nodes + links, the empty
 * branches, and the click-to-pin interaction — not class strings.
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SankeyChart } from '@/components/ui/SankeyChart';
import type {
    TraceabilityEdge,
    TraceabilityGraph,
    TraceabilityNode,
} from '@/lib/traceability-graph/types';

function node(
    id: string,
    kind: TraceabilityNode['kind'],
    label = id,
): TraceabilityNode {
    return { id, kind, label, secondary: null, badge: null, href: `/x/${id}` };
}

function edge(
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

/** A graph with a real cross-tier flow: asset → risk ← control. */
function flowGraph(): TraceabilityGraph {
    return graph(
        [node('a1', 'asset'), node('r1', 'risk'), node('c1', 'control')],
        [edge('e1', 'a1', 'r1', 'exposes'), edge('e2', 'c1', 'r1', 'mitigates')],
    );
}

describe('SankeyChart — rendered behaviour', () => {
    it('renders the empty branch when the graph has no nodes', () => {
        const { container } = render(<SankeyChart graph={graph([], [])} />);
        const root = container.querySelector('[data-sankey-chart]');
        expect(root).toHaveAttribute('data-sankey-empty', 'true');
        expect(screen.getByText('No mapping flows to display.')).toBeInTheDocument();
    });

    it('renders the no-links branch when nodes exist but nothing connects them', () => {
        const g = graph([node('a1', 'asset'), node('r1', 'risk')], []);
        const { container } = render(<SankeyChart graph={g} />);
        const root = container.querySelector('[data-sankey-chart]');
        expect(root).toHaveAttribute('data-sankey-no-links', 'true');
    });

    it('projects the graph into rendered nodes and links', () => {
        const { container } = render(<SankeyChart graph={flowGraph()} />);
        const root = container.querySelector('[data-sankey-chart]')!;
        // The dataset builder + layout helper actually ran: three
        // nodes projected, and the two cross-tier edges produced
        // link paths. These are computed counts, not markup presence.
        expect(root).toHaveAttribute('data-sankey-node-count', '3');
        const linkCount = Number(root.getAttribute('data-sankey-link-count'));
        expect(linkCount).toBeGreaterThan(0);
        expect(container.querySelectorAll('[data-sankey-node-id]')).toHaveLength(3);
        expect(container.querySelectorAll('[data-sankey-link-id]').length).toBe(linkCount);
        // The SVG is exposed to assistive tech.
        expect(screen.getByRole('img', { name: /traceability flow/i })).toBeInTheDocument();
    });

    it('renders a legend entry for each node kind present in the graph', () => {
        render(<SankeyChart graph={flowGraph()} />);
        expect(screen.getByText('Asset')).toBeInTheDocument();
        expect(screen.getByText('Risk')).toBeInTheDocument();
        expect(screen.getByText('Control')).toBeInTheDocument();
    });

    it('pins a node on click and unpins it on a second click', () => {
        const { container } = render(<SankeyChart graph={flowGraph()} />);
        const root = container.querySelector('[data-sankey-chart]')!;
        const riskNode = container.querySelector('[data-sankey-node-id="r1"]')!;

        // Not pinned initially.
        expect(root).not.toHaveAttribute('data-sankey-pinned-id');
        expect(riskNode).not.toHaveAttribute('data-sankey-node-pinned');

        // Click pins.
        fireEvent.click(riskNode);
        expect(root).toHaveAttribute('data-sankey-pinned-id', 'r1');
        expect(riskNode).toHaveAttribute('data-sankey-node-pinned', 'true');

        // Click again unpins.
        fireEvent.click(riskNode);
        expect(root).not.toHaveAttribute('data-sankey-pinned-id');
        expect(riskNode).not.toHaveAttribute('data-sankey-node-pinned');
    });
});
