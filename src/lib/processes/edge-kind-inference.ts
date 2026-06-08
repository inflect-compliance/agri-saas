/**
 * Automation edge-kind inference (Visual Rule Editor VR-5).
 *
 * Maps an edge's (source kind → target kind) to a semantic automation edge
 * kind so the canvas graph is self-describing. The user only picks explicitly
 * on genuinely ambiguous branches (a `condition` source = pass vs fail; an
 * `slaGate` source = breach vs on-time); everything else is inferred.
 */

export type AutomationEdgeKind =
    | 'trigger-flow' // Trigger → Condition / Action (default automation flow)
    | 'condition-pass' // Condition → Action (filter matched)
    | 'condition-fail' // Condition → Action (filter did NOT match)
    | 'chain-delay' // Action → Action (chained rule, optional delay)
    | 'sla-breach' // SLA Gate → escalation Action (SLA expired)
    | 'sla-pass' // SLA Gate → next step (resolved in time)
    | 'flow'; // non-automation / unknown — the generic document edge

export const AUTOMATION_EDGE_KINDS: ReadonlyArray<AutomationEdgeKind> = [
    'trigger-flow',
    'condition-pass',
    'condition-fail',
    'chain-delay',
    'sla-breach',
    'sla-pass',
];

/** True for an explicitly-branching source kind that needs a user pick. */
export function isBranchingSource(sourceKind: string): boolean {
    return sourceKind === 'condition' || sourceKind === 'slaGate';
}

/**
 * Default edge kind for a (source → target) pair. For branching sources the
 * "positive" branch is the default (condition-pass / sla-pass); the UI lets
 * the user flip it to the negative branch.
 */
export function inferEdgeKind(
    sourceKind: string | undefined,
    targetKind: string | undefined,
): AutomationEdgeKind {
    switch (sourceKind) {
        case 'trigger':
            return 'trigger-flow';
        case 'condition':
            return 'condition-pass';
        case 'slaGate':
            return 'sla-pass';
        case 'action':
            // Action → Action is a chained rule; Action → anything else is
            // still a plain flow.
            return targetKind === 'action' ? 'chain-delay' : 'trigger-flow';
        default:
            return 'flow';
    }
}

/** The pass/fail (or breach/on-time) toggle for a branching source. */
export function branchAlternatives(sourceKind: string): [AutomationEdgeKind, AutomationEdgeKind] | null {
    if (sourceKind === 'condition') return ['condition-pass', 'condition-fail'];
    if (sourceKind === 'slaGate') return ['sla-pass', 'sla-breach'];
    return null;
}
