/**
 * Audit Coherence S2 (2026-05-22) — structural ratchet locking the
 * three Control Framework & Testing gap closures:
 *
 *   1. Rolling pass-rate metric (`getControlEffectiveness`).
 *   2. `ARCHIVED` terminal state on `TestPlanStatus`.
 *   3. Inline OVERDUE-semantics documentation in `control-test.ts`.
 *
 * Pure static analysis — no DB, no mounts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Audit S2 — Control Framework & Testing', () => {
    describe('schema', () => {
        const enums = read('prisma/schema/enums.prisma');

        it('TestPlanStatus enum carries ARCHIVED', () => {
            expect(enums).toMatch(/enum TestPlanStatus\s*\{[\s\S]*?\bARCHIVED\b[\s\S]*?\}/);
        });

        it('migration SQL exists for the audit S2 changes', () => {
            const migDir = path.join(
                ROOT,
                'prisma/migrations/20260524110000_audit_s2_testplan_archived',
            );
            expect(fs.existsSync(migDir)).toBe(true);
            const sql = fs.readFileSync(
                path.join(migDir, 'migration.sql'),
                'utf8',
            );
            expect(sql).toMatch(
                /ADD VALUE IF NOT EXISTS 'ARCHIVED'/,
            );
        });
    });

    describe('control-effectiveness usecase', () => {
        const src = read('src/app-layer/usecases/control-test.ts');

        it('exports `getControlEffectiveness`', () => {
            expect(src).toMatch(/export async function getControlEffectiveness/);
        });

        it('declares the `ControlEffectiveness` return shape', () => {
            expect(src).toMatch(/export interface ControlEffectiveness/);
            // The minimum public surface — passRate / total / passes /
            // fails / inconclusive / windowDays.
            expect(src).toMatch(/passRate:\s*number\s*\|\s*null/);
            expect(src).toMatch(/total:\s*number/);
            expect(src).toMatch(/passes:\s*number/);
            expect(src).toMatch(/fails:\s*number/);
            expect(src).toMatch(/inconclusive:\s*number/);
            expect(src).toMatch(/windowDays:\s*number/);
        });

        it('default window is 90 days', () => {
            expect(src).toMatch(/DEFAULT_EFFECTIVENESS_WINDOW_DAYS\s*=\s*90/);
        });

        it('groups completed runs by `result` (PASS/FAIL/INCONCLUSIVE)', () => {
            // Aggregation must be a `groupBy(by: ['result'], ...)`
            // call so the three result classes are counted in one
            // round trip.
            expect(src).toMatch(/groupBy\(/);
            expect(src).toMatch(/by:\s*\[['"]result['"]\]/);
        });

        it('reads only COMPLETED runs and only within the window', () => {
            expect(src).toMatch(/status:\s*['"]COMPLETED['"]/);
            expect(src).toMatch(/executedAt:\s*\{\s*gte:\s*cutoff/);
        });

        it('rounds the pass-rate to a 0..100 integer', () => {
            expect(src).toMatch(/Math\.round\([\s\S]{0,80}100\)/);
        });

        it('policy: assertCanReadTests gates the read', () => {
            // The function must be permission-gated at the read tier.
            expect(src).toMatch(
                /export async function getControlEffectiveness[\s\S]{0,400}assertCanReadTests/,
            );
        });
    });

    describe('OVERDUE semantics — documented divergence', () => {
        const src = read('src/app-layer/usecases/control-test.ts');

        it('the inline rationale comment exists', () => {
            // The comment block explains why TestPlanStatus does NOT
            // carry an OVERDUE value — derived live from `nextDueAt`,
            // distinct from RiskTreatmentPlan's persisted OVERDUE.
            expect(src).toMatch(/OVERDUE semantics/);
            expect(src).toMatch(/nextDueAt\s*<\s*now\(\)/);
            // Reference to the divergence vs treatment plans.
            expect(src).toMatch(/RiskTreatmentPlan/);
        });
    });
});
