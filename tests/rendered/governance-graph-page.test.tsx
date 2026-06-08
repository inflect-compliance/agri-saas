/**
 * VR-10 — governance graph page renders the meta-graph (nodes + edges).
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';

const mockSWR = jest.fn();
jest.mock('@/lib/hooks/use-tenant-swr', () => ({
    useTenantSWR: (...a: unknown[]) => mockSWR(...a),
}));
jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantHref: () => (p: string) => p,
}));
jest.mock('@/components/layout/PageBreadcrumbs', () => ({
    PageBreadcrumbs: () => null,
}));

import GovernanceGraphPage from '@/app/t/[tenantSlug]/(app)/processes/governance/page';

const GRAPH = {
    nodes: [
        { id: 'm1', name: 'Onboarding', canvasMode: 'AUTOMATION', ruleCount: 4, size: 2, successRate: 0.95, health: 'green' },
        { id: 'm2', name: 'Incident', canvasMode: 'AUTOMATION', ruleCount: 1, size: 1, successRate: 0.5, health: 'red' },
    ],
    edges: [{ id: 'subflow-call:m1->m2', source: 'm1', target: 'm2', kind: 'subflow-call' }],
};

describe('GovernanceGraphPage', () => {
    it('renders a health-ringed node per map + the sub-flow edges', () => {
        mockSWR.mockReturnValue({ data: GRAPH, isLoading: false });
        render(<GovernanceGraphPage />);
        expect(screen.getByTestId('governance-graph-page')).toBeInTheDocument();
        expect(screen.getByText('Onboarding')).toBeInTheDocument();
        expect(screen.getByText('Incident')).toBeInTheDocument();
        // health data-attr surfaced for the ring
        const { container } = render(<GovernanceGraphPage />);
        expect(container.querySelector('[data-governance-node="m1"][data-health="green"]')).toBeTruthy();
        expect(container.querySelector('[data-governance-node="m2"][data-health="red"]')).toBeTruthy();
        // edge rendered
        expect(screen.getAllByTestId('governance-edges').length).toBeGreaterThan(0);
    });

    it('shows an empty hint when there are no maps', () => {
        mockSWR.mockReturnValue({ data: { nodes: [], edges: [] }, isLoading: false });
        render(<GovernanceGraphPage />);
        expect(screen.getByText(/create an automation workflow/)).toBeInTheDocument();
    });
});
