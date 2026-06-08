/**
 * VR-10 — governance meta-graph assembler (pure core).
 */
import {
    buildGovernanceGraph,
    healthFor,
    type MapStat,
    type GraphLink,
} from '@/app-layer/services/governance-graph-builder';

const map = (id: string, over: Partial<MapStat> = {}): MapStat => ({
    id,
    name: `Map ${id}`,
    canvasMode: 'AUTOMATION',
    ruleCount: 1,
    successRate: 1,
    ...over,
});

describe('healthFor', () => {
    it('maps success rate to a ring colour by threshold', () => {
        expect(healthFor(0.95)).toBe('green');
        expect(healthFor(0.9)).toBe('green');
        expect(healthFor(0.8)).toBe('amber');
        expect(healthFor(0.7)).toBe('amber');
        expect(healthFor(0.5)).toBe('red');
        expect(healthFor(null)).toBe('unknown');
    });
});

describe('buildGovernanceGraph', () => {
    it('emits one node per map with size scaled by rule count', () => {
        const { nodes } = buildGovernanceGraph(
            [map('a', { ruleCount: 1 }), map('b', { ruleCount: 5 }), map('c', { ruleCount: 12 })],
            [],
        );
        expect(nodes).toHaveLength(3);
        expect(nodes.find((n) => n.id === 'a')!.size).toBe(1);
        expect(nodes.find((n) => n.id === 'b')!.size).toBe(2);
        expect(nodes.find((n) => n.id === 'c')!.size).toBe(3);
    });

    it('keeps valid cross-map links + drops self-loops, unknowns, and duplicates', () => {
        const maps = [map('a'), map('b')];
        const links: GraphLink[] = [
            { sourceMapId: 'a', targetMapId: 'b', kind: 'subflow-call' },
            { sourceMapId: 'a', targetMapId: 'b', kind: 'subflow-call' }, // dup
            { sourceMapId: 'a', targetMapId: 'a', kind: 'subflow-call' }, // self-loop
            { sourceMapId: 'a', targetMapId: 'zzz', kind: 'subflow-call' }, // unknown target
        ];
        const { edges } = buildGovernanceGraph(maps, links);
        expect(edges).toHaveLength(1);
        expect(edges[0]).toMatchObject({ source: 'a', target: 'b', kind: 'subflow-call' });
    });

    it('reflects health on each node', () => {
        const { nodes } = buildGovernanceGraph(
            [map('a', { successRate: 0.95 }), map('b', { successRate: 0.5 }), map('c', { successRate: null })],
            [],
        );
        expect(nodes.find((n) => n.id === 'a')!.health).toBe('green');
        expect(nodes.find((n) => n.id === 'b')!.health).toBe('red');
        expect(nodes.find((n) => n.id === 'c')!.health).toBe('unknown');
    });
});
