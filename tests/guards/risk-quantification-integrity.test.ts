/**
 * Risk-quantification integrity — the "guard the guards" meta-ratchet for
 * the 10-epic risk-quantification roadmap (RQ-1..RQ-10, Archer parity).
 *
 * Mirrors the codebase's other domain meta-ratchets (ci-pipeline-integrity,
 * observability-reliability-integrity, codebase-hygiene-integrity): it locks
 * in that EVERY RQ epic keeps its structural guard, its keystone usecase, and
 * its migration — so a future refactor can't silently delete an epic's
 * coverage without this test failing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// epic → { guard, usecase, migration (null = pure projection, no schema) }
const EPICS: Array<{ rq: string; guard: string; usecase: string; migration: string | null }> = [
    { rq: 'RQ-1 FAIR taxonomy', guard: 'tests/guards/rq1-fair-taxonomy.test.ts', usecase: 'src/app-layer/usecases/fair-calculator.ts', migration: 'rq1_fair_taxonomy' },
    { rq: 'RQ-2 Risk appetite', guard: 'tests/guards/rq2-risk-appetite.test.ts', usecase: 'src/app-layer/usecases/risk-appetite.ts', migration: 'rq2_risk_appetite' },
    { rq: 'RQ-3 Monte Carlo', guard: 'tests/guards/rq3-monte-carlo.test.ts', usecase: 'src/app-layer/usecases/monte-carlo.ts', migration: 'rq3_monte_carlo' },
    { rq: 'RQ-4 Scenarios', guard: 'tests/guards/rq4-scenarios.test.ts', usecase: 'src/app-layer/usecases/risk-scenario.ts', migration: 'rq4_scenarios' },
    { rq: 'RQ-5 Hierarchy', guard: 'tests/guards/rq5-hierarchy.test.ts', usecase: 'src/app-layer/usecases/risk-hierarchy.ts', migration: 'rq5_hierarchy' },
    { rq: 'RQ-6 KRI', guard: 'tests/guards/rq6-kri.test.ts', usecase: 'src/app-layer/usecases/key-risk-indicator.ts', migration: 'rq6_kri' },
    { rq: 'RQ-7 Bow-tie', guard: 'tests/guards/rq7-bowtie.test.ts', usecase: 'src/app-layer/usecases/bowtie-projection.ts', migration: null },
    { rq: 'RQ-8 Correlation', guard: 'tests/guards/rq8-correlation.test.ts', usecase: 'src/app-layer/usecases/risk-correlation.ts', migration: 'rq8_correlation' },
    { rq: 'RQ-9 Trending/velocity', guard: 'tests/guards/rq9-trending.test.ts', usecase: 'src/app-layer/usecases/risk-velocity.ts', migration: 'rq9_snapshots' },
    { rq: 'RQ-10 Reporting/BIA', guard: 'tests/guards/rq10-reporting.test.ts', usecase: 'src/app-layer/usecases/risk-report.ts', migration: 'rq10_reporting' },
];

describe('Risk-quantification integrity (RQ-1..RQ-10 meta-ratchet)', () => {
    it.each(EPICS)('$rq keeps its structural guard', ({ guard }) => {
        expect(exists(guard)).toBe(true);
    });

    it.each(EPICS)('$rq keeps its keystone usecase', ({ usecase }) => {
        expect(exists(usecase)).toBe(true);
    });

    it.each(EPICS)('$rq keeps its migration (or is a pure projection)', ({ migration }) => {
        if (migration === null) return; // RQ-7 is a read-time projection — no schema.
        const migs = fs.readdirSync(path.join(ROOT, 'prisma/migrations'));
        expect(migs.some((m) => m.includes(migration))).toBe(true);
    });

    it('FAIR resolveALE is the shared ALE resolver across the quantitative epics', () => {
        // resolveALE (RQ-1) is the single source of truth for "the ALE of a
        // risk" — analytics, appetite, Monte Carlo, hierarchy, snapshots, and
        // reports all consume it. If a future epic re-implements ALE inline,
        // this list keeps the convergence honest.
        for (const f of ['risk-analytics', 'risk-appetite', 'monte-carlo', 'risk-hierarchy', 'risk-snapshot', 'risk-report']) {
            expect(read(`src/app-layer/usecases/${f}.ts`)).toMatch(/resolveALE/);
        }
    });

    it('the three RQ cross-tenant crons are scheduled', () => {
        const schedules = read('src/app-layer/jobs/schedules.ts');
        for (const job of ['risk-appetite-monitor', 'risk-snapshot', 'report-delivery']) {
            expect(schedules).toContain(`'${job}'`);
        }
    });
});
