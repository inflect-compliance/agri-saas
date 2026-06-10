/**
 * RQ-9 ratchet — historical trending + velocity stays wired: two models +
 * migration (RLS), the snapshot + pure-velocity services, the daily cron,
 * the routes, and the dashboard velocity card + risk-detail history tab.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

describe('RQ-9 trending & velocity', () => {
    it('two snapshot models + migration with RLS', () => {
        const schema = read('prisma/schema/compliance.prisma');
        expect(schema).toMatch(/model RiskSnapshot/);
        expect(schema).toMatch(/model PortfolioSnapshot/);
        const mig = 'prisma/migrations/20260610260000_rq9_snapshots/migration.sql';
        expect(exists(mig)).toBe(true);
        expect(read(mig)).toMatch(/CREATE POLICY tenant_isolation ON "RiskSnapshot"/);
        expect(read(mig)).toMatch(/CREATE POLICY tenant_isolation ON "PortfolioSnapshot"/);
    });

    it('snapshot + pure-velocity services', () => {
        const snap = read('src/app-layer/usecases/risk-snapshot.ts');
        for (const fn of ['takeSnapshot', 'cleanupSnapshots', 'getRiskHistory', 'getPortfolioTrend']) {
            expect(snap).toContain(`export async function ${fn}`);
        }
        const vel = read('src/app-layer/usecases/risk-velocity.ts');
        expect(vel).toMatch(/export function velocityOf/);
        expect(vel).toMatch(/export function classifyTrend/);
        expect(vel).toMatch(/export async function computeVelocity/);
    });

    it('the daily cron is registered + scheduled', () => {
        expect(exists('src/app-layer/jobs/risk-snapshot-jobs.ts')).toBe(true);
        expect(read('src/app-layer/jobs/executor-registry.ts')).toMatch(/register\('risk-snapshot'/);
        expect(read('src/app-layer/jobs/schedules.ts')).toMatch(/'risk-snapshot'/);
    });

    it('routes + dashboard velocity card + history tab', () => {
        expect(exists('src/app/api/t/[tenantSlug]/risks/velocity/route.ts')).toBe(true);
        expect(exists('src/app/api/t/[tenantSlug]/risks/portfolio-trend/route.ts')).toBe(true);
        expect(exists('src/app/api/t/[tenantSlug]/risks/[id]/history/route.ts')).toBe(true);
        expect(exists('src/app/t/[tenantSlug]/(app)/risks/dashboard/VelocityCard.tsx')).toBe(true);
        expect(read('src/app/t/[tenantSlug]/(app)/risks/dashboard/page.tsx')).toMatch(/VelocityCard/);
        expect(read('src/app/t/[tenantSlug]/(app)/risks/[riskId]/page.tsx')).toMatch(/RiskHistoryPanel/);
    });
});
