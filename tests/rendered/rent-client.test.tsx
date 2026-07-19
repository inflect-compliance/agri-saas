/**
 * Rendered — RentClient (lease register) behaviour lock.
 *
 *   1. the create modal opens from the header action;
 *   2. the row status badge is driven by the shared lease-expiry clock
 *      (expiring within the window → "d left"; past end → "Expired");
 *   3. saving a lease revalidates the rent-roll KPI card's SWR key (not just
 *      the /leases key) — the fix for the stale-card / first-lease-vanish bug.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WARN_DAYS } from '@/lib/agro/lease-expiry';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/t/acme/rent',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));
jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl: () => (p: string) => `/api/t/acme${p}`,
    useTenantHref: () => (p: string) => `/t/acme${p}`,
    // RentRollCard's PDF link is wrapped in <UpgradeGate>, which reads the plan.
    useTenantContext: () => ({ plan: 'ENTERPRISE' }),
}));

const apiPatch = jest.fn(async (..._a: unknown[]) => ({}));
const apiPost = jest.fn(async (..._a: unknown[]) => ({}));
const apiDelete = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('@/lib/api-client', () => ({
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
    ApiClientError: class extends Error {},
}));

// Per-key SWR mock: distinct mutate spies for /leases vs /reports/rent-roll so
// we can assert the CARD key is revalidated on save.
const leasesMutate = jest.fn(async () => undefined);
const rentRollMutate = jest.fn(async () => undefined);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let leasesData: any = { leases: [] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rentRollData: any = { totalLeasedDca: 0, totals: [], activeLeaseCount: 0, lessorCount: 0, seasonYear: 2026, byLessor: [], expiringSoon: [] };
jest.mock('@/lib/hooks/use-tenant-swr', () => ({
    useTenantSWR: (key: string) => {
        if (key.startsWith('/leases/parcel-options')) {
            return { data: { parcels: [] }, isLoading: false, mutate: jest.fn() };
        }
        if (key.startsWith('/reports/rent-roll')) {
            return { data: rentRollData, isLoading: false, mutate: rentRollMutate };
        }
        if (key.startsWith('/leases')) {
            return { data: leasesData, isLoading: false, mutate: leasesMutate };
        }
        return { data: undefined, isLoading: false, mutate: jest.fn() };
    },
}));

import { RentClient } from '@/app/t/[tenantSlug]/(app)/rent/RentClient';

const YMD = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * 86_400_000);
    return d.toISOString().slice(0, 10);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lease(over: Record<string, any> = {}) {
    return {
        id: 'l1', parcelId: 'p1', lessorName: 'Иван Петров', lessorEik: null,
        kind: 'ARENDA', rentAmount: 60, rentUnit: 'лв/дка',
        startDate: YMD(-10), endDate: YMD(WARN_DAYS - 5), documentRef: null, notes: null,
        parcel: { id: 'p1', name: 'Нива 1', location: { id: 'loc-1', name: 'Стопанство 1' } },
        ...over,
    };
}

function renderClient() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <main><RentClient tenantSlug="acme" /></main>
            </TooltipProvider>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    leasesData = { leases: [] };
    rentRollData = { totalLeasedDca: 0, totals: [], activeLeaseCount: 0, lessorCount: 0, seasonYear: 2026, byLessor: [], expiringSoon: [] };
});

it('opens the create modal from the header action', async () => {
    renderClient();
    // Two "Lease" triggers (header button + Fab); the header one is first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Lease' })[0]);
    // "New lease" renders twice (modal title + header) — assert the form id.
    await waitFor(() => expect(document.getElementById('lease-form')).not.toBeNull());
    expect(screen.getAllByText('New lease').length).toBeGreaterThan(0);
});

it('drives the row status badge from the shared lease-expiry clock', async () => {
    leasesData = {
        leases: [
            lease({ id: 'l1', lessorName: 'Иван Петров', endDate: YMD(WARN_DAYS - 5) }), // within window → "d left"
            lease({ id: 'l2', lessorName: 'Петър Иванов', endDate: YMD(-3) }),            // past end → Expired
        ],
    };
    renderClient();
    await waitFor(() => expect(screen.getByText('Иван Петров')).toBeInTheDocument());
    expect(screen.getByText(/d left/)).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
});

it('revalidates the rent-roll card key when a lease is saved', async () => {
    leasesData = { leases: [lease({ id: 'l1' })] };
    rentRollData = { totalLeasedDca: 60, totals: [{ unit: 'лв/дка', total: 3600, paid: 0, outstanding: 3600 }], activeLeaseCount: 1, lessorCount: 1, seasonYear: 2026, byLessor: [], expiringSoon: [] };
    renderClient();
    // Open the edit modal via the row, then submit.
    fireEvent.click(screen.getByText('Иван Петров'));
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    // Both keys revalidate — the card key is the regression this locks.
    await waitFor(() => expect(rentRollMutate).toHaveBeenCalled());
    expect(leasesMutate).toHaveBeenCalled();
});
