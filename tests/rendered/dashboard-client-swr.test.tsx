/**
 * DashboardClient — composition test.
 *
 * After the farm-UI trim the dashboard client is a thin composition:
 * onboarding banner + the "your farm today" ag strip + the recent-
 * activity feed (passed as `children`). It does NO SWR reads of its
 * own anymore (the KPI/trend/hero surfaces were removed) and it no
 * longer mounts the "Compliance Dashboard" masthead header. This test
 * pins the surviving contract:
 *
 *   1. `children` (the server-rendered RecentActivityCard) pass
 *      through unchanged — the server boundary is preserved.
 *   2. The client never reaches for `useRouter().refresh()`.
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

// Onboarding banner queries its own state — stub it out so the
// dashboard test stays focused on the composition contract.
jest.mock('@/components/onboarding/OnboardingBanner', () => {
    const Stub = () => <div data-testid="onboarding-banner-stub" />;
    Stub.displayName = 'OnboardingBannerStub';
    return Stub;
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
    it('passes RecentActivityCard children through unchanged (server-boundary preservation)', () => {
        render(
            <DashboardClient>
                <div data-testid="recent-activity-card">recent activity</div>
            </DashboardClient>,
            { wrapper: makeWrapper() },
        );

        expect(screen.getByTestId('recent-activity-card')).toBeInTheDocument();
        expect(screen.getByTestId('onboarding-banner-stub')).toBeInTheDocument();
    });

    it('never invokes router.refresh()', () => {
        render(
            <DashboardClient>
                <div data-testid="recent-activity-card">recent activity</div>
            </DashboardClient>,
            { wrapper: makeWrapper() },
        );
        expect(refreshSpy).not.toHaveBeenCalled();
    });
});
