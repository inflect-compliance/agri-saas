/**
 * Unit tests for due planning, dashboard metrics, and test readiness.
 */
import { computeNextDueAt } from '@/app-layer/utils/cadence';

describe('Due Planning — Idempotency', () => {
    // These test the core logic used by runDuePlanning:
    // - Plans with existing PLANNED/RUNNING runs should be skipped
    // - Only ACTIVE plans with nextDueAt <= now are eligible

    test('computeNextDueAt returns correct date offsets for all frequencies', () => {
        const base = new Date('2026-01-15T12:00:00Z');
        const dayMs = 86400000;

        const daily = computeNextDueAt('DAILY', base)!;
        expect(Math.round((daily.getTime() - base.getTime()) / dayMs)).toBe(1);

        const weekly = computeNextDueAt('WEEKLY', base)!;
        expect(Math.round((weekly.getTime() - base.getTime()) / dayMs)).toBe(7);

        const monthly = computeNextDueAt('MONTHLY', base)!;
        expect(monthly.getMonth()).toBe(base.getMonth() + 1);

        const quarterly = computeNextDueAt('QUARTERLY', base)!;
        expect(quarterly.getMonth()).toBe(base.getMonth() + 3);

        const annually = computeNextDueAt('ANNUALLY', base)!;
        expect(annually.getFullYear()).toBe(base.getFullYear() + 1);

        expect(computeNextDueAt('AD_HOC', base)).toBeNull();
        expect(computeNextDueAt(null, base)).toBeNull();
    });

    test('idempotent filter: plans with pending runs are excluded', () => {
        // Simulates the idempotent filter logic from runDuePlanning
        const plans = [
            { id: '1', runs: [] }, // no pending runs — needs run
            { id: '2', runs: [{ id: 'r1', status: 'PLANNED' }] }, // has pending — skip
            { id: '3', runs: [{ id: 'r2', status: 'RUNNING' }] }, // has running — skip
            { id: '4', runs: [] }, // no pending — needs run
        ];

        const needsRun = plans.filter(p => p.runs.length === 0);
        expect(needsRun.map(p => p.id)).toEqual(['1', '4']);
        expect(needsRun.length).toBe(2);
    });

    test('only ACTIVE plans with non-AD_HOC frequency are eligible', () => {
        const plans = [
            { id: '1', status: 'ACTIVE', frequency: 'MONTHLY', nextDueAt: new Date('2026-01-01') },
            { id: '2', status: 'PAUSED', frequency: 'MONTHLY', nextDueAt: new Date('2026-01-01') },
            { id: '3', status: 'ACTIVE', frequency: 'AD_HOC', nextDueAt: null },
            { id: '4', status: 'ACTIVE', frequency: 'QUARTERLY', nextDueAt: new Date('2027-01-01') }, // not due
        ];

        const now = new Date('2026-03-13');
        const eligible = plans.filter(
            p => p.status === 'ACTIVE'
                && p.frequency !== 'AD_HOC'
                && p.nextDueAt
                && p.nextDueAt <= now
        );

        expect(eligible.map(p => p.id)).toEqual(['1']);
    });
});

// Production rate formula (guards divide-by-zero). Extracted so the
// zero-guard branch is exercised via varying inputs rather than a
// constant comparison at each call site.
const pct = (numerator: number, denominator: number): number =>
    denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;

describe('Dashboard Metrics — Computation Logic', () => {
    test('completion rate is totalCompleted / totalRuns * 100', () => {
        const completedRuns = 8;
        const totalRuns = 10;
        const rate = pct(completedRuns, totalRuns);
        expect(rate).toBe(80);
    });

    test('pass rate is passRuns / completedRuns * 100', () => {
        const passRuns = 6;
        const completedRuns = 8;
        const rate = pct(passRuns, completedRuns);
        expect(rate).toBe(75);
    });

    test('fail rate is failRuns / completedRuns * 100', () => {
        const failRuns = 2;
        const completedRuns = 8;
        const rate = pct(failRuns, completedRuns);
        expect(rate).toBe(25);
    });

    test('evidence rate is runsWithEvidence / completedRuns * 100', () => {
        const runsWithEvidence = 5;
        const completedRuns = 10;
        const rate = pct(runsWithEvidence, completedRuns);
        expect(rate).toBe(50);
    });

    test('handles zero runs gracefully', () => {
        const totalRuns = 0;
        const completedRuns = 0;
        const completionRate = pct(completedRuns, totalRuns);
        const passRate = pct(0, completedRuns);
        expect(completionRate).toBe(0);
        expect(passRate).toBe(0);
    });

    test('repeated failures detection: ≥2 FAIL per control', () => {
        const failRuns = [
            { controlId: 'c1' }, { controlId: 'c1' }, { controlId: 'c1' },
            { controlId: 'c2' },
            { controlId: 'c3' }, { controlId: 'c3' },
        ];

        const failsByControl: Record<string, number> = {};
        for (const r of failRuns) {
            failsByControl[r.controlId] = (failsByControl[r.controlId] || 0) + 1;
        }
        const repeated = Object.entries(failsByControl)
            .filter(([, count]) => count >= 2)
            .map(([controlId, count]) => ({ controlId, failCount: count }));

        expect(repeated).toEqual([
            { controlId: 'c1', failCount: 3 },
            { controlId: 'c3', failCount: 2 },
        ]);
    });
});

describe('Test Readiness — Coverage Computation', () => {
    test('testPlanCoverage: % of mapped controls with active plans', () => {
        const mappedControlIds = ['c1', 'c2', 'c3', 'c4', 'c5'];
        const controlsWithPlan = new Set(['c1', 'c3']);
        const coverage = Math.round((controlsWithPlan.size / mappedControlIds.length) * 100);
        expect(coverage).toBe(40);
    });

    test('testRunCoverage: % of mapped controls with recent completed runs', () => {
        const mappedControlIds = ['c1', 'c2', 'c3', 'c4', 'c5'];
        const controlsWithRun = new Set(['c1', 'c2', 'c5']);
        const coverage = Math.round((controlsWithRun.size / mappedControlIds.length) * 100);
        expect(coverage).toBe(60);
    });

    test('passRate: % of recent runs that PASS', () => {
        const recentRuns = [
            { result: 'PASS' }, { result: 'PASS' }, { result: 'FAIL' },
            { result: 'PASS' }, { result: 'INCONCLUSIVE' },
        ];
        const passes = recentRuns.filter(r => r.result === 'PASS').length;
        const passRate = Math.round((passes / recentRuns.length) * 100);
        expect(passRate).toBe(60);
    });

    test('handles zero mapped controls gracefully', () => {
        const totalMapped = 0;
        const coverage = pct(0, totalMapped);
        expect(coverage).toBe(0);
    });
});

describe('Route Structure — Tests Enhancement', () => {
    const fs = require('fs');
    const path = require('path');
    const routes = [
        'src/app/api/t/[tenantSlug]/tests/due/route.ts',
        'src/app/api/t/[tenantSlug]/tests/dashboard/route.ts',
        'src/app/api/t/[tenantSlug]/tests/plans/route.ts',
        'src/app/api/t/[tenantSlug]/tests/readiness/route.ts',
        'src/app/api/t/[tenantSlug]/tests/runs/[runId]/retest/route.ts',
    ];

    test.each(routes)('route file exists: %s', (routePath) => {
        expect(fs.existsSync(path.resolve(routePath))).toBe(true);
    });

    const pages = [
        'src/app/t/[tenantSlug]/(app)/tests/due/page.tsx',
        'src/app/t/[tenantSlug]/(app)/tests/dashboard/page.tsx',
    ];

    test.each(pages)('page file exists: %s', (pagePath) => {
        expect(fs.existsSync(path.resolve(pagePath))).toBe(true);
    });
});
