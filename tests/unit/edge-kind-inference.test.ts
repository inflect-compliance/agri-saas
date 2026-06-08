/**
 * VR-5 — automation edge-kind inference.
 */
import {
    inferEdgeKind,
    isBranchingSource,
    branchAlternatives,
    AUTOMATION_EDGE_KINDS,
} from '@/lib/processes/edge-kind-inference';

describe('inferEdgeKind', () => {
    it('infers the default kind per source', () => {
        expect(inferEdgeKind('trigger', 'condition')).toBe('trigger-flow');
        expect(inferEdgeKind('condition', 'action')).toBe('condition-pass');
        expect(inferEdgeKind('slaGate', 'action')).toBe('sla-pass');
        expect(inferEdgeKind('action', 'action')).toBe('chain-delay');
        expect(inferEdgeKind('action', 'condition')).toBe('trigger-flow');
        expect(inferEdgeKind('processStep', 'decision')).toBe('flow');
        expect(inferEdgeKind(undefined, undefined)).toBe('flow');
    });
});

describe('branching sources', () => {
    it('flags condition + slaGate as branching', () => {
        expect(isBranchingSource('condition')).toBe(true);
        expect(isBranchingSource('slaGate')).toBe(true);
        expect(isBranchingSource('trigger')).toBe(false);
        expect(isBranchingSource('action')).toBe(false);
    });

    it('returns pass/fail alternatives for branching sources', () => {
        expect(branchAlternatives('condition')).toEqual(['condition-pass', 'condition-fail']);
        expect(branchAlternatives('slaGate')).toEqual(['sla-pass', 'sla-breach']);
        expect(branchAlternatives('trigger')).toBeNull();
    });

    it('every inferred kind is in the canonical set (except generic flow)', () => {
        for (const src of ['trigger', 'condition', 'slaGate', 'action']) {
            const k = inferEdgeKind(src, 'action');
            expect(AUTOMATION_EDGE_KINDS).toContain(k);
        }
    });
});
