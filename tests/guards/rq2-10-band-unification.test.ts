/**
 * RQ2-10 — band-unification ratchet.
 *
 * One sentence of truth: a risk's severity band comes from the
 * tenant's `RiskMatrixConfig` via `resolveBandForScore` — never
 * from a hardcoded threshold ladder. Pre-RQ2-10 the product had
 * FOUR independent ladders (RisksClient Level column, PDF register
 * summary, `getRiskLevel` percentages, `getRiskScoreBand` statics)
 * that silently disagreed the moment a tenant customised bands.
 *
 * This ratchet:
 *   1. pins the two unified surfaces (risks list Level column, PDF
 *      register) to the canonical resolver with zero inline
 *      thresholds;
 *   2. FREEZES the two known legacy holdouts at their current call
 *      sites — `getRiskLevel` (risk-scoring.ts) and
 *      `getRiskScoreBand` (entity-status-mapping.ts) may not gain
 *      new importers. Migrating one off ⇒ lower its cap here in the
 *      same diff.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const risksClient = read('src/app/t/[tenantSlug]/(app)/risks/RisksClient.tsx');
const pdf = read('src/app-layer/reports/pdf/riskRegister.ts');

function srcImportersOf(symbol: string): string[] {
    const out = execSync(
        `grep -rl "${symbol}" src --include="*.ts" --include="*.tsx" || true`,
        { encoding: 'utf-8', cwd: ROOT },
    );
    return out.split('\n').filter(Boolean).sort();
}

describe('RQ2-10 — unified surfaces', () => {
    test('the risks list Level column resolves from tenant bands, with no inline ladder', () => {
        expect(risksClient).toMatch(/resolveBandForScore\(score, matrixConfig\.bands\)/);
        // The old ladder shape is gone for good.
        expect(risksClient).not.toMatch(/score <= 5\b/);
        expect(risksClient).not.toMatch(/score <= 12\b/);
        expect(risksClient).not.toMatch(/score <= 18\b/);
    });

    test('the PDF register buckets by tenant bands, with no inline ladder', () => {
        expect(pdf).toMatch(/getRiskMatrixConfig\(ctx\)/);
        expect(pdf).toMatch(/resolveBandForScore\(r\.score, matrix\.bands\)/);
        expect(pdf).not.toMatch(/score >= 15/);
        expect(pdf).not.toMatch(/score >= 8/);
        // Band names render from config, not literals.
        expect(pdf).not.toMatch(/'High \(/);
        expect(pdf).not.toMatch(/'Medium \(/);
    });
});

describe('RQ2-10 — legacy ladders are frozen', () => {
    test('getRiskLevel (fixed-percentage ladder) gains no new importers', () => {
        const importers = srcImportersOf('getRiskLevel').filter(
            (p) => p !== 'src/lib/risk-scoring.ts',
        );
        // Frozen holdouts at unification time (each carries fixed
        // thresholds that pre-date the configurable matrix; migrating
        // one ⇒ remove it here in the same diff):
        //  - none. RisksClient migrated in this PR; the remaining
        //    `getRiskLevel` references in src are the definition file.
        expect(importers).toEqual([]);
    });

    test('getRiskScoreBand (static band map) holds at its frozen call-site set', () => {
        const importers = srcImportersOf('getRiskScoreBand').filter(
            (p) => p !== 'src/app-layer/domain/entity-status-mapping.ts',
        );
        // Frozen holdouts (display-tone usage on surfaces without a
        // loaded matrix config; the RQ2-3 explainer already shows the
        // configured bands on these pages):
        const FROZEN = [
            'src/app/t/[tenantSlug]/(app)/risks/[riskId]/page.tsx',
        ].sort();
        expect(importers).toEqual(FROZEN);
    });
});
