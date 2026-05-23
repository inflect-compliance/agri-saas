
/**
 * Test Readiness — Framework-aware test coverage scoring
 *
 * For each framework with mapped controls, computes:
 *   - testPlanCoverage: % of mapped controls with ≥1 ACTIVE test plan
 *   - testRunCoverage:  % of mapped controls with a completed run in last 90 days
 *   - passRate:         % of those completed runs that PASS
 */
import { RequestContext } from '../types';
import { assertCanReadTests } from '../policies/test.policies';
import { runInTenantContext } from '@/lib/db-context';

export interface FrameworkTestReadiness {
    frameworkKey: string;
    frameworkName: string;
    totalMappedControls: number;
    withTestPlan: number;
    testPlanCoverage: number;   // 0–100
    withRecentRun: number;
    testRunCoverage: number;    // 0–100
    passRate: number;           // 0–100
    recentRuns: number;
    recentPasses: number;
}

export async function computeTestReadiness(ctx: RequestContext): Promise<FrameworkTestReadiness[]> {
    assertCanReadTests(ctx);

    // Get all frameworks
    const frameworks = await runInTenantContext(ctx, (db) =>
        db.framework.findMany({
            select: { id: true, key: true, name: true },
        })
    );

    const results: FrameworkTestReadiness[] = [];
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    for (const fw of frameworks) {
        // Get control IDs mapped to this framework via ControlRequirementLink
        const mappedLinks = await runInTenantContext(ctx, (db) =>
            db.controlRequirementLink.findMany({
                where: { tenantId: ctx.tenantId, requirement: { frameworkId: fw.id } },
                select: { controlId: true },
            })
        );


        const mappedControlIds = [...new Set(mappedLinks.map((l) => l.controlId))] as string[];
        if (mappedControlIds.length === 0) continue;

        // Get test plans for those controls

        const testPlans = await runInTenantContext(ctx, (db) =>
            db.controlTestPlan.findMany({
                where: {
                    tenantId: ctx.tenantId,
                    controlId: { in: mappedControlIds },
                    status: 'ACTIVE',
                },
                select: { id: true, controlId: true },
            })
        );


        const controlsWithPlan = new Set(testPlans.map((p) => p.controlId as string));

        // Get completed runs in last 90 days for those controls

        const recentRuns = await runInTenantContext(ctx, (db) =>
            db.controlTestRun.findMany({
                where: {
                    tenantId: ctx.tenantId,
                    controlId: { in: mappedControlIds },
                    status: 'COMPLETED',
                    executedAt: { gte: ninetyDaysAgo },
                },
                select: { id: true, controlId: true, result: true },
            })
        );


        const controlsWithRun = new Set(recentRuns.map((r) => r.controlId as string));

        const recentPasses = recentRuns.filter((r) => r.result === 'PASS').length;

        const totalMapped = mappedControlIds.length;
        results.push({
            frameworkKey: fw.key,
            frameworkName: fw.name,
            totalMappedControls: totalMapped,
            withTestPlan: controlsWithPlan.size,
            testPlanCoverage: totalMapped > 0 ? Math.round((controlsWithPlan.size / totalMapped) * 100) : 0,
            withRecentRun: controlsWithRun.size,
            testRunCoverage: totalMapped > 0 ? Math.round((controlsWithRun.size / totalMapped) * 100) : 0,
            passRate: recentRuns.length > 0 ? Math.round((recentPasses / recentRuns.length) * 100) : 0,
            recentRuns: recentRuns.length,
            recentPasses,
        });
    }

    return results;
}
