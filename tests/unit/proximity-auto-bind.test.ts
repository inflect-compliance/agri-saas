/**
 * R26-PR-C — Proximity auto-bind geometry tests.
 *
 * Exercises `findProximityCandidate` directly (the pure helper
 * the hook exposes for testing). The React surface that wires it
 * into xyflow is covered by the structural ratchet at
 * `tests/guards/r26-prc-proximity-auto-bind.test.ts`.
 */

import type { Edge, Node } from '@xyflow/react';
import {
    findProximityCandidate,
    DEFAULT_PROXIMITY_THRESHOLD_PX,
} from '@/lib/processes/use-proximity-auto-bind';

function makeNode(
    id: string,
    x: number,
    y: number,
    overrides: Partial<Node> = {},
): Node {
    return {
        id,
        type: 'processStep',
        position: { x, y },
        data: { label: id, kind: 'processStep' },
        width: 160,
        height: 60,
        ...overrides,
    } as Node;
}

describe('findProximityCandidate', () => {
    it('returns null when no node is within range', () => {
        const dragged = makeNode('A', 0, 0);
        const other = makeNode(
            'B',
            DEFAULT_PROXIMITY_THRESHOLD_PX * 4,
            0,
        );
        expect(
            findProximityCandidate(dragged, [dragged, other], []),
        ).toBeNull();
    });

    it('returns the closest node when one is in range', () => {
        const dragged = makeNode('A', 0, 0);
        const near = makeNode('B', 100, 0); // centre-to-centre ≈ 100, threshold default 80 → NOT in range
        const closer = makeNode('C', 60, 0);
        const result = findProximityCandidate(
            dragged,
            [dragged, near, closer],
            [],
        );
        expect(result).not.toBeNull();
        expect(result!.target).toBe('C');
    });

    it('skips pairs that already have an edge between them (forward direction)', () => {
        const a = makeNode('A', 0, 0);
        const b = makeNode('B', 60, 0);
        const edges: Edge[] = [
            { id: 'e1', source: 'A', target: 'B' },
        ];
        expect(findProximityCandidate(a, [a, b], edges)).toBeNull();
    });

    it('skips pairs that already have an edge between them (reverse direction)', () => {
        const a = makeNode('A', 0, 0);
        const b = makeNode('B', 60, 0);
        const edges: Edge[] = [
            { id: 'e1', source: 'B', target: 'A' },
        ];
        expect(findProximityCandidate(a, [a, b], edges)).toBeNull();
    });

    it('returns null when the dragged node is an annotation (no handles)', () => {
        const dragged = makeNode('A', 0, 0, {
            type: 'annotation',
            data: { label: 'note', kind: 'annotation' },
        });
        const other = makeNode('B', 60, 0);
        expect(
            findProximityCandidate(dragged, [dragged, other], []),
        ).toBeNull();
    });

    it('skips candidate annotation nodes (no handles)', () => {
        const dragged = makeNode('A', 0, 0);
        const annotation = makeNode('N', 60, 0, {
            type: 'annotation',
            data: { label: 'note', kind: 'annotation' },
        });
        const real = makeNode('B', 70, 0);
        const result = findProximityCandidate(
            dragged,
            [dragged, annotation, real],
            [],
        );
        expect(result).not.toBeNull();
        expect(result!.target).toBe('B');
    });

    it('infers direction: dragged-LEFT-of-target → dragged is source', () => {
        const dragged = makeNode('A', 0, 0);
        const right = makeNode('B', 70, 0);
        const result = findProximityCandidate(
            dragged,
            [dragged, right],
            [],
        );
        expect(result).toEqual(
            expect.objectContaining({ source: 'A', target: 'B' }),
        );
    });

    it('infers direction: dragged-RIGHT-of-target → dragged is target', () => {
        const dragged = makeNode('A', 100, 0);
        const left = makeNode('B', 50, 0);
        const result = findProximityCandidate(
            dragged,
            [dragged, left],
            [],
        );
        expect(result).toEqual(
            expect.objectContaining({ source: 'B', target: 'A' }),
        );
    });

    it('respects a custom threshold', () => {
        const dragged = makeNode('A', 0, 0);
        const other = makeNode('B', 200, 0);
        // Default threshold (80) is too small to bind these.
        expect(
            findProximityCandidate(dragged, [dragged, other], []),
        ).toBeNull();
        // A custom 300px threshold catches it.
        const wide = findProximityCandidate(
            dragged,
            [dragged, other],
            [],
            300,
        );
        expect(wide).not.toBeNull();
        expect(wide!.target).toBe('B');
    });

    it('falls back gracefully when the kind is unknown (treat as has-handles)', () => {
        const dragged = makeNode('A', 0, 0, {
            data: { label: 'A', kind: 'unknown-kind' },
        });
        const other = makeNode('B', 60, 0);
        const result = findProximityCandidate(
            dragged,
            [dragged, other],
            [],
        );
        expect(result).not.toBeNull();
        expect(result!.target).toBe('B');
    });

    it('returns the candidate distance for the caller to inspect', () => {
        const dragged = makeNode('A', 0, 0);
        const other = makeNode('B', 60, 0);
        const result = findProximityCandidate(
            dragged,
            [dragged, other],
            [],
        );
        expect(result).not.toBeNull();
        // Centre-to-centre distance is just the X delta since both
        // centres sit on the same Y axis. Both nodes are 160 wide,
        // so centres are at (80, 30) and (140, 30) → 60px apart.
        expect(result!.distance).toBeCloseTo(60, 0);
    });
});
