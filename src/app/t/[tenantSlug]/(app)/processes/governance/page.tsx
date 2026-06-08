'use client';

/**
 * Governance graph page (Visual Rule Editor VR-10).
 *
 * The cross-map, system-of-record view of the tenant's automation topology:
 * every automation map as a node (sized by rule volume, ringed by execution
 * health) and the sub-flow-call relationships between them. This focused v1
 * renders the meta-graph as a health-ringed card grid + a relationships list;
 * the full xyflow meta-canvas (draggable nodes, embedded previews) is the
 * remaining UI enhancement — the builder + API already return xyflow-ready
 * `{ nodes, edges }`.
 */
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { Heading } from '@/components/ui/typography';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';

type Health = 'green' | 'amber' | 'red' | 'unknown';

interface GovernanceNode {
    id: string;
    name: string;
    canvasMode: string;
    ruleCount: number;
    size: number;
    successRate: number | null;
    health: Health;
}
interface GovernanceEdge {
    id: string;
    source: string;
    target: string;
    kind: 'subflow-call' | 'shared-rule';
}

const HEALTH_RING: Record<Health, string> = {
    green: 'ring-content-success',
    amber: 'ring-content-warning',
    red: 'ring-content-error',
    unknown: 'ring-border-subtle',
};

export default function GovernanceGraphPage() {
    const { data, isLoading } = useTenantSWR<{
        nodes: GovernanceNode[];
        edges: GovernanceEdge[];
    }>(CACHE_KEYS.processes.governanceGraph());

    const tenantHref = useTenantHref();
    const nodes = data?.nodes ?? [];
    const edges = data?.edges ?? [];
    const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;

    return (
        <div className="space-y-section p-default" data-testid="governance-graph-page">
            <PageBreadcrumbs
                items={[
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: 'Processes', href: tenantHref('/processes') },
                    { label: 'Governance graph' },
                ]}
            />
            <div>
                <Heading level={1}>Governance graph</Heading>
                <p className="text-sm text-content-muted">
                    Every automation map, sized by rule volume and ringed by 30-day
                    execution health, with the sub-flow calls between them.
                </p>
            </div>

            {isLoading && <p className="text-sm text-content-subtle">Building the topology…</p>}

            {!isLoading && nodes.length === 0 && (
                <p className="text-sm text-content-subtle">
                    No process maps yet — create an automation workflow to populate the graph.
                </p>
            )}

            <div className="grid grid-cols-1 gap-default sm:grid-cols-2 lg:grid-cols-3">
                {nodes.map((n) => (
                    <div
                        key={n.id}
                        data-governance-node={n.id}
                        data-health={n.health}
                        className={`rounded-lg border border-border-subtle bg-bg-subtle/40 p-default ring-2 ${HEALTH_RING[n.health]}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="font-medium text-content-emphasis">{n.name}</span>
                            <StatusBadge variant={n.canvasMode === 'AUTOMATION' ? 'info' : 'neutral'}>
                                {n.canvasMode}
                            </StatusBadge>
                        </div>
                        <div className="mt-2 flex items-center gap-default text-xs text-content-muted tabular-nums">
                            <span>{n.ruleCount} rule{n.ruleCount === 1 ? '' : 's'}</span>
                            <span>
                                {n.successRate === null
                                    ? 'no runs'
                                    : `${Math.round(n.successRate * 100)}% success`}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {edges.length > 0 && (
                <div className="space-y-default">
                    <Heading level={3}>Sub-flow calls</Heading>
                    <ul className="space-y-tight text-sm text-content-muted" data-testid="governance-edges">
                        {edges.map((e) => (
                            <li key={e.id} data-governance-edge={e.id}>
                                {nameOf(e.source)} → {nameOf(e.target)}{' '}
                                <span className="text-content-subtle">({e.kind})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
