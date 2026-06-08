/**
 * VR-4 — Automation inspector panel renders the right per-kind form and the
 * unsynced hint when the node has no linked rule.
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';

const mockSWR = jest.fn();
jest.mock('@/lib/hooks/use-tenant-swr', () => ({
    useTenantSWR: (...args: unknown[]) => mockSWR(...args),
}));
jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl: () => (p: string) => p,
}));

import { AutomationInspectorPanel } from '@/components/processes/AutomationInspectorPanel';

const RULE = {
    id: 'r1',
    name: 'My rule',
    description: null,
    triggerEvent: 'RISK_CREATED',
    triggerFilterJson: null,
    actionType: 'NOTIFY_USER',
    actionConfigJson: {},
    status: 'ENABLED',
    slaWindowMinutes: null,
};

beforeEach(() => {
    mockSWR.mockReturnValue({ data: RULE, mutate: jest.fn() });
});

describe('AutomationInspectorPanel', () => {
    it('shows the unsynced hint when there is no ruleId', () => {
        mockSWR.mockReturnValue({ data: undefined, mutate: jest.fn() });
        render(<AutomationInspectorPanel kind="action" ruleId={null} />);
        expect(screen.getByTestId('automation-inspector-unsynced')).toBeInTheDocument();
    });

    it('renders the trigger-event field for a trigger node', () => {
        render(<AutomationInspectorPanel kind="trigger" ruleId="r1" />);
        expect(screen.getByTestId('automation-inspector')).toBeInTheDocument();
        expect(screen.getByText('Trigger event')).toBeInTheDocument();
    });

    it('renders the action-type field for an action node', () => {
        render(<AutomationInspectorPanel kind="action" ruleId="r1" />);
        expect(screen.getByText('Action type')).toBeInTheDocument();
    });

    it('renders the SLA window field for an slaGate node', () => {
        render(<AutomationInspectorPanel kind="slaGate" ruleId="r1" />);
        expect(screen.getByText('SLA window (minutes)')).toBeInTheDocument();
    });
});
