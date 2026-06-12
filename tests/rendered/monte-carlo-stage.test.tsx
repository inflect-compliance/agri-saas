/**
 * RQ3-1 — MonteCarloPanel as the dashboard's loss-exceedance stage.
 *
 * Locks: the simulated curve renders the P50/P80/P95 percentile
 * markers plus the portfolio-appetite ceiling as reference lines;
 * the breach-probability note reads the curve at the ceiling; the
 * per-risk cap renders as the P90-count note, never as a line.
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';

jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl: () => (p: string) => `/api/t/acme${p}`,
    useMoneyFormatter: () => (v: number | null | undefined) =>
        jest.requireActual('@/lib/risk-coherence').formatCompactCurrency(v),
}));

// ParentSize measures 0×0 in jsdom — pin a real size so the inner
// SVG renders.
jest.mock('@visx/responsive', () => ({
    ParentSize: ({ children }: { children: (s: { width: number }) => React.ReactNode }) =>
        children({ width: 600 }),
}));

import { MonteCarloPanel, type AppetitePayload, type SimulationRun } from '@/app/t/[tenantSlug]/(app)/risks/dashboard/MonteCarloPanel';

const RUN: SimulationRun = {
    portfolioMean: 400_000,
    portfolioP50: 380_000,
    portfolioP80: 520_000,
    portfolioP90: 600_000,
    portfolioP95: 700_000,
    portfolioP99: 900_000,
    portfolioStdDev: 120_000,
    iterations: 10_000,
    executionMs: 42,
    completedAt: '2026-06-11T12:00:00.000Z',
    lecPointsJson: [
        { threshold: 380_000, probability: 0.5 },
        { threshold: 520_000, probability: 0.2 },
        { threshold: 700_000, probability: 0.05 },
        { threshold: 900_000, probability: 0.01 },
    ],
    perRiskResultsJson: [
        { riskId: 'r1', title: 'Big risk', aleMean: 300_000, aleP90: 450_000, contribution: 0.75 },
        { riskId: 'r2', title: 'Small risk', aleMean: 100_000, aleP90: 140_000, contribution: 0.25 },
    ],
};

const APPETITE: AppetitePayload = {
    config: { totalAleThreshold: 600_000, singleRiskAleMax: 200_000 },
    status: { status: 'WITHIN', portfolioAle: 400_000, activeBreaches: 0 },
};

// RQ3-3 — the run is lifted page state, passed as a prop.
const noReload = async () => {};

describe('MonteCarloPanel — the simulated LEC stage (RQ3-1)', () => {
    it('renders the percentile markers and the portfolio-appetite line', () => {
        render(<MonteCarloPanel appetite={APPETITE} run={RUN} onReload={noReload} />);
        expect(screen.getByTestId('risk-mc-lec')).toBeInTheDocument();
        const markers = screen.getAllByTestId('lec-reference-line');
        const labels = markers.map((m) => m.textContent ?? '');
        expect(labels.some((l) => l.startsWith('P50'))).toBe(true);
        expect(labels.some((l) => l.startsWith('P80'))).toBe(true);
        expect(labels.some((l) => l.startsWith('P95'))).toBe(true);
        expect(labels.some((l) => l.startsWith('Portfolio appetite'))).toBe(true);
        // The per-risk cap must NOT be a line on the portfolio axis.
        expect(labels.some((l) => l.includes('Per-risk'))).toBe(false);
    });

    it('reads the breach probability off the curve at the ceiling', () => {
        render(<MonteCarloPanel appetite={APPETITE} run={RUN} onReload={noReload} />);
        expect(screen.getByTestId('lec-portfolio-appetite-note')).toBeInTheDocument();
        // Ceiling 600k falls between the 520k (p=0.2) and 700k (p=0.05)
        // steps — step semantics read the first point ≥ threshold.
        expect(screen.getByTestId('lec-portfolio-appetite-note').textContent).toMatch(/≈5% chance/);
    });

    it('answers the per-risk cap with the P90 count note', () => {
        render(<MonteCarloPanel appetite={APPETITE} run={RUN} onReload={noReload} />);
        expect(screen.getByTestId('mc-per-risk-appetite-note')).toBeInTheDocument();
        // r1 P90 450k > 200k cap; r2 P90 140k < cap → 1 of 2.
        expect(screen.getByTestId('mc-per-risk-appetite-note').textContent).toMatch(/1 of 2/);
    });

    it('renders no threshold chrome without an appetite config', () => {
        render(<MonteCarloPanel appetite={{ config: null, status: null }} run={RUN} onReload={noReload} />);
        expect(screen.getByTestId('risk-mc-lec')).toBeInTheDocument();
        expect(screen.queryByTestId('lec-portfolio-appetite-note')).toBeNull();
        expect(screen.queryByTestId('mc-per-risk-appetite-note')).toBeNull();
        // Percentile markers still render — they come from the run.
        const labels = screen.getAllByTestId('lec-reference-line').map((m) => m.textContent ?? '');
        expect(labels.some((l) => l.startsWith('P80'))).toBe(true);
    });
});
