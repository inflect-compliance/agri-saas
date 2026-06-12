/**
 * RQ3-3 — the risk dashboard's quant headline is a distribution.
 *
 * Locks: with a completed simulation the KPI tiles are the simulated
 * P50/P80/P95 (Σ demoted to the subordinate line with the gap
 * tooltip); without a run the Σ tiles survive but carry the
 * run-a-simulation nudge.
 */
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl: () => (p: string) => `/api/t/acme${p}`,
    useTenantHref: () => (p: string) => `/t/acme${p}`,
    useTenantContext: () => ({ tenantName: 'Acme', tenantSlug: 'acme' }),
    useMoneyFormatter: () => (v: number | null | undefined) =>
        jest.requireActual('@/lib/risk-coherence').formatCompactCurrency(v),
}));
jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));
jest.mock('@visx/responsive', () => ({
    ParentSize: ({ children }: { children: (s: { width: number }) => React.ReactNode }) =>
        children({ width: 600 }),
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import RiskDashboardPage from '@/app/t/[tenantSlug]/(app)/risks/dashboard/page';

const renderPage = () =>
    render(
        <TooltipProvider delayDuration={0}>
            <RiskDashboardPage />
        </TooltipProvider>,
    );

const ANALYTICS = {
    totals: { totalCount: 3, quantifiedCount: 2, totalAle: 300_000, avgAle: 150_000, maxAle: 200_000 },
    topByAle: [],
    byCategory: [{ category: 'Technical', count: 2, totalAle: 300_000 }],
};

const RUN = {
    portfolioMean: 400_000, portfolioP50: 380_000, portfolioP80: 520_000,
    portfolioP90: 600_000, portfolioP95: 700_000, portfolioP99: 900_000,
    portfolioStdDev: 120_000, iterations: 10_000, executionMs: 42,
    completedAt: '2026-06-12T00:00:00.000Z',
    lecPointsJson: [{ threshold: 380_000, probability: 0.5 }],
    perRiskResultsJson: [],
};

function mockFetch(run: typeof RUN | null) {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        const body = u.endsWith('/risks/analytics')
            ? ANALYTICS
            : u.endsWith('/risks/simulate')
              ? { run }
              : u.endsWith('/risks')
                ? []
                : null;
        return { ok: body !== null, json: async () => body } as Response;
    }) as unknown as typeof fetch;
}

describe('Risk dashboard — portfolio honesty (RQ3-3)', () => {
    it('headlines the simulated P50/P80/P95 and demotes Σ to the tooltip line', async () => {
        mockFetch(RUN);
        renderPage();
        await waitFor(() => expect(screen.getByTestId('risk-quant-tile-p80')).toBeInTheDocument());
        expect(screen.getByTestId('risk-quant-tile-p50').textContent).toContain('€380K');
        expect(screen.getByTestId('risk-quant-tile-p95').textContent).toContain('€700K');
        // Σ survives only as the subordinate line.
        expect(screen.queryByTestId('risk-quant-tile-total')).toBeNull();
        expect(screen.getByTestId('risk-quant-sum-line').textContent).toContain('€300K');
        expect(screen.queryByTestId('risk-quant-sum-nudge')).toBeNull();
    });

    it('without a run, Σ tiles survive with the run-a-simulation nudge', async () => {
        mockFetch(null);
        renderPage();
        await waitFor(() => expect(screen.getByTestId('risk-quant-tile-total')).toBeInTheDocument());
        expect(screen.queryByTestId('risk-quant-tile-p80')).toBeNull();
        expect(screen.getByTestId('risk-quant-sum-nudge').textContent).toMatch(/Run a simulation/);
    });
});
