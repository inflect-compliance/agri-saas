/**
 * RQ-4 ratchet — scenario & what-if stays wired: schema + migration (RLS),
 * the pure override/ROI core + simulateScenario reusing RQ-3, the routes,
 * and the scenarios page.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

describe('RQ-4 scenarios', () => {
    it('RiskScenario schema + migration with RLS', () => {
        expect(read('prisma/schema/compliance.prisma')).toMatch(/model RiskScenario/);
        const mig = 'prisma/migrations/20260610180000_rq4_scenarios/migration.sql';
        expect(exists(mig)).toBe(true);
        expect(read(mig)).toMatch(/CREATE POLICY tenant_isolation ON "RiskScenario"/);
    });

    it('the service exposes pure override/ROI core + simulateScenario + CRUD', () => {
        const src = read('src/app-layer/usecases/risk-scenario.ts');
        expect(src).toMatch(/export function applyOverrides/);
        expect(src).toMatch(/export function computeRoi/);
        for (const fn of ['createScenario', 'listScenarios', 'getScenario', 'archiveScenario', 'cloneScenario', 'simulateScenario']) {
            expect(src).toContain(`export async function ${fn}`);
        }
        // reuses RQ-3 engine + RQ-1 calculator
        expect(src).toMatch(/simulatePortfolio/);
        expect(src).toMatch(/computeFairALE/);
    });

    it('the routes + scenarios page exist', () => {
        expect(exists('src/app/api/t/[tenantSlug]/risks/scenarios/route.ts')).toBe(true);
        expect(exists('src/app/api/t/[tenantSlug]/risks/scenarios/[scenarioId]/route.ts')).toBe(true);
        expect(exists('src/app/api/t/[tenantSlug]/risks/scenarios/[scenarioId]/simulate/route.ts')).toBe(true);
        expect(exists('src/app/t/[tenantSlug]/(app)/risks/scenarios/page.tsx')).toBe(true);
    });
});
