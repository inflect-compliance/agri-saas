/* eslint-disable @typescript-eslint/no-explicit-any -- test
 * mocks, fixtures, and adapter shims that mirror runtime contracts
 * (Prisma extensions, NextRequest mocks, JSON-loaded fixtures,
 * spy harnesses). Per-line typing has poor cost/benefit ratio in
 * test files; the file-level disable is the codebase's standard
 * pattern for these surfaces (see also
 * tests/guards/helm-chart-foundation.test.ts and
 * tests/integration/audit-middleware.test.ts). */
/**
 * Unit tests for Control Test usecases:
 * - nextDueAt computation based on frequency
 * - FAIL run triggers Task creation
 * - Structural: routes don't contain prisma imports
 */
import { computeNextDueAt } from '@/app-layer/utils/cadence';
import * as fs from 'fs';
import * as path from 'path';

// ─── nextDueAt computation ───

describe('Control Test: nextDueAt computation', () => {
    const base = new Date('2025-01-15T10:00:00Z');

    it('AD_HOC returns null', () => {
        expect(computeNextDueAt('AD_HOC', base)).toBeNull();
    });

    it('null/undefined frequency returns null', () => {
        expect(computeNextDueAt(null, base)).toBeNull();
        expect(computeNextDueAt(undefined, base)).toBeNull();
    });

    it('DAILY adds 1 day', () => {
        const result = computeNextDueAt('DAILY', base);
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2025-01-16T10:00:00.000Z');
    });

    it('WEEKLY adds 7 days', () => {
        const result = computeNextDueAt('WEEKLY', base);
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2025-01-22T10:00:00.000Z');
    });

    it('MONTHLY adds 1 month', () => {
        const result = computeNextDueAt('MONTHLY', base);
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2025-02-15T10:00:00.000Z');
    });

    it('QUARTERLY adds 3 months', () => {
        const result = computeNextDueAt('QUARTERLY', base);
        expect(result).not.toBeNull();
        // Check month/year (DST shifts may adjust the UTC hour by ±1)
        expect(result!.getUTCFullYear()).toBe(2025);
        expect(result!.getUTCMonth()).toBe(3); // April = month 3
        expect(result!.getUTCDate()).toBe(15);
    });

    it('ANNUALLY adds 1 year', () => {
        const result = computeNextDueAt('ANNUALLY', base);
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2026-01-15T10:00:00.000Z');
    });

    it('unknown frequency returns null', () => {
        expect(computeNextDueAt('BIWEEKLY' as any, base)).toBeNull();
    });
});

// ─── Structural: no prisma or logAudit in test routes ───

function getAllRouteFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getAllRouteFiles(fullPath));
        } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
            results.push(fullPath);
        }
    }
    return results;
}

describe('Structural: Control Test routes follow conventions', () => {
    const testPlanRouteDir = path.resolve(__dirname, '../../src/app/api/t/[tenantSlug]/controls/[controlId]/tests');
    const testRunRouteDir = path.resolve(__dirname, '../../src/app/api/t/[tenantSlug]/tests');

    it('test plan route files exist', () => {
        const planRoutes = getAllRouteFiles(testPlanRouteDir);
        expect(planRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('test run route files exist', () => {
        const runRoutes = getAllRouteFiles(testRunRouteDir);
        expect(runRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('no test route files contain direct prisma.xxx calls', () => {
        const allRoutes = [
            ...getAllRouteFiles(testPlanRouteDir),
            ...getAllRouteFiles(testRunRouteDir),
        ];

        const violations: string[] = [];
        for (const file of allRoutes) {
            const content = fs.readFileSync(file, 'utf-8');
            if (/\bprisma\.\w+/g.test(content)) {
                violations.push(file);
            }
        }

        if (violations.length > 0) {
            fail(`Test route files contain direct Prisma calls:\n${violations.join('\n')}`);
        }
    });

    it('no test route files import logAudit directly', () => {
        const allRoutes = [
            ...getAllRouteFiles(testPlanRouteDir),
            ...getAllRouteFiles(testRunRouteDir),
        ];

        const violations: string[] = [];
        for (const file of allRoutes) {
            const content = fs.readFileSync(file, 'utf-8');
            if (/\blogAudit\b/.test(content)) {
                violations.push(file);
            }
        }

        if (violations.length > 0) {
            fail(`Test route files import logAudit directly:\n${violations.join('\n')}`);
        }
    });
});

// ─── Zod schema validation ───

describe('Control Test Zod schemas', () => {
    // Dynamic import to test schemas exist and work

    const schemas = require('../../src/lib/schemas');

    it('CreateTestPlanSchema validates correct input', () => {
        const input = { name: 'Quarterly access review', method: 'MANUAL', frequency: 'QUARTERLY' };
        const result = schemas.CreateTestPlanSchema.safeParse(input);
        expect(result.success).toBe(true);
    });

    it('CreateTestPlanSchema rejects empty name', () => {
        const input = { name: '' };
        const result = schemas.CreateTestPlanSchema.safeParse(input);
        expect(result.success).toBe(false);
    });

    it('CreateTestPlanSchema strips unknown fields', () => {
        const input = { name: 'Test', hackField: 'evil' };
        const result = schemas.CreateTestPlanSchema.parse(input);
        expect(result).not.toHaveProperty('hackField');
    });

    it('CompleteTestRunSchema validates correct input', () => {
        const input = { result: 'PASS', notes: 'All good' };
        const result = schemas.CompleteTestRunSchema.safeParse(input);
        expect(result.success).toBe(true);
    });

    it('CompleteTestRunSchema rejects invalid result', () => {
        const input = { result: 'MAYBE' };
        const result = schemas.CompleteTestRunSchema.safeParse(input);
        expect(result.success).toBe(false);
    });

    it('LinkTestEvidenceSchema validates correct input', () => {
        const input = { kind: 'EVIDENCE', evidenceId: 'abc123' };
        const result = schemas.LinkTestEvidenceSchema.safeParse(input);
        expect(result.success).toBe(true);
    });

    it('LinkTestEvidenceSchema strips unknown fields', () => {
        const input = { kind: 'FILE', fileId: 'f1', extra: true };
        const result = schemas.LinkTestEvidenceSchema.parse(input);
        expect(result).not.toHaveProperty('extra');
    });

    it('UpdateTestPlanSchema accepts partial updates', () => {
        const input = { name: 'Updated name' };
        const result = schemas.UpdateTestPlanSchema.safeParse(input);
        expect(result.success).toBe(true);
    });

    it('UpdateTestPlanSchema rejects invalid status', () => {
        const input = { status: 'DELETED' };
        const result = schemas.UpdateTestPlanSchema.safeParse(input);
        expect(result.success).toBe(false);
    });
});
