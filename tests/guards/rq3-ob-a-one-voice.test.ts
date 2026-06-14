/**
 * RQ3-OB-A — one-voice ratchet.
 *
 * The product spoke two currencies on the same page ($ tiles beside
 * € rows) because eight files each declared a local `money()` with a
 * hardcoded symbol. Regression classes guarded:
 *
 *   - a hardcoded currency template literal reappearing anywhere in
 *     src/ outside the canonical formatter;
 *   - a local `const money =` formatter declaration reappearing
 *     (the canonical path is `useMoneyFormatter()` client-side or
 *     `formatCompactCurrency(v, sym)` server-side);
 *   - raw ISO date slices in user-facing text (one date voice:
 *     formatDate);
 *   - inline pluralization ternaries drifting back where the shared
 *     helper exists.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function grepSrc(pattern: string): string[] {
    // -F fixed-string + single quotes: the patterns contain backticks
    // and dollar signs that must never reach shell interpolation.
    const out = execSync(
        `grep -rlnF -e '${pattern}' src --include="*.ts" --include="*.tsx" || true`,
        { encoding: 'utf-8', cwd: ROOT },
    );
    return out.split('\n').filter(Boolean).sort();
}

describe('RQ3-OB-A — one voice', () => {
    test('no hardcoded currency template literal outside the canonical formatter', () => {
        const dollar = grepSrc('`$${').filter((p) => p !== 'src/lib/risk-coherence.ts');
        const euro = grepSrc('`€${').filter((p) => p !== 'src/lib/risk-coherence.ts');
        expect([...dollar, ...euro]).toEqual([]);
    });

    test('no local money-formatter declarations (useMoneyFormatter is the seam)', () => {
        const out = execSync(
            `grep -rnF -e 'const money = (n' src --include="*.ts" --include="*.tsx" || true`,
            { encoding: 'utf-8', cwd: ROOT },
        ).trim();
        expect(out).toBe('');
    });

    test('the tenant currency flows: schema field → server record → context → hook', () => {
        expect(read('prisma/schema/auth.prisma')).toMatch(/currencySymbol\s+String\s+@default\("€"\)/);
        expect(read('src/lib/server/tenant-context.server.ts')).toMatch(/currencySymbol: true/);
        expect(read('src/lib/tenant-context-provider.tsx')).toMatch(/export function useMoneyFormatter/);
        expect(read('src/app/t/[tenantSlug]/layout.tsx')).toMatch(/currencySymbol: serverCtx\.tenant\.currencySymbol/);
    });

    test('one date voice — no raw ISO slices in user-facing strings', () => {
        expect(read('src/app-layer/usecases/risk-appetite.ts')).not.toMatch(/toISOString\(\)\.slice/);
        expect(read('src/app-layer/usecases/risk-appetite.ts')).toMatch(/formatDate\(breach\.detectedAt\)/);
    });

    test('grammar — staleness uses the shared pluralizer (no "1 days ago")', () => {
        expect(read('src/lib/risk-staleness.ts')).toMatch(/countNoun\(/);
        expect(read('src/lib/risk-staleness.ts')).not.toMatch(/\$\{verdict\.assessmentAgeDays\} days/);
    });
});
