/**
 * DashboardClient — composition test.
 *
 * The dashboard client is a thin composition of just the "your farm today"
 * ag strip (the onboarding banner and the recent-activity feed were both
 * removed). It does NO SWR reads of its own (the KPI/trend/hero surfaces were
 * removed) and never reaches for `useRouter().refresh()`. This test pins the
 * surviving contract:
 *
 *   1. The ag strip renders and the retired onboarding banner does NOT.
 *   2. The client never invokes `router.refresh()`.
 */

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { TooltipProvider } from '@/components/ui/tooltip';

jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl:
        () => (path: string) =>
            `/api/t/acme${path.startsWith('/') ? path : `/${path}`}`,
    useTenantHref: () => (path: string) => `/t/acme${path}`,
}));

// next/link calls into next/navigation. Stub the router so we can
// also assert that `refresh()` is NEVER invoked by the component.
const refreshSpy = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: refreshSpy,
        prefetch: jest.fn(),
    }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

// The child cards own their own SWR reads — stub them to markers so the
// composition test stays focused on the shell contract.
jest.mock('@/app/t/[tenantSlug]/(app)/dashboard/AgDashboardStrip', () => {
    const Stub = () => <div data-testid="ag-strip-stub" />;
    Stub.displayName = 'AgDashboardStripStub';
    return { __esModule: true, default: Stub };
});
jest.mock('@/app/t/[tenantSlug]/(app)/dashboard/TasksTrendCard', () => {
    const Stub = () => <div data-testid="tasks-trend-stub" />;
    Stub.displayName = 'TasksTrendCardStub';
    return { __esModule: true, default: Stub };
});

import DashboardClient from '@/app/t/[tenantSlug]/(app)/dashboard/DashboardClient';

// ── fetch mock — every endpoint (the module-gated ag strip) resolves
//    to null so the strip renders nothing and stays out of the way. ──
const fetchMock = jest.fn();
beforeEach(() => {
    fetchMock.mockReset();
    refreshSpy.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => null });
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

function makeWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return (
            <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
                <TooltipProvider>{children}</TooltipProvider>
            </SWRConfig>
        );
    };
}

describe('DashboardClient — composition', () => {
    it('renders the tasks trend + ag strip and NOT the retired onboarding banner', () => {
        render(<DashboardClient />, { wrapper: makeWrapper() });
        expect(screen.getByTestId('tasks-trend-stub')).toBeInTheDocument();
        expect(screen.getByTestId('ag-strip-stub')).toBeInTheDocument();
        expect(screen.queryByTestId('onboarding-banner-stub')).not.toBeInTheDocument();
    });

    it('never invokes router.refresh()', () => {
        render(<DashboardClient />, { wrapper: makeWrapper() });
        expect(refreshSpy).not.toHaveBeenCalled();
    });
});
