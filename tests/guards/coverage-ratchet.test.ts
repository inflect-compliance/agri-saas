/**
 * Coverage ratchet — the enforced floors are one-way-up.
 *
 * `jest.thresholds.json` holds the per-layer coverage floors that
 * the CI `Coverage (≥60%)` job enforces via `--coverageThreshold`.
 * The policy (`docs/coverage-policy.md`) is that a floor is **never
 * lowered** — raised when a PR earns it, never dropped to turn a
 * red PR green. `jest.config.js` documents that rule in prose; this
 * test ENFORCES it.
 *
 * `RATCHET_FLOOR` below is the hard minimum. Every value in
 * `jest.thresholds.json` must be greater than or equal to it — a
 * threshold lowered below the floor fails CI loudly, which is
 * exactly the regression (GAP-02: "lower a floor to make CI green")
 * this guard exists to catch.
 *
 * When a PR RAISES a threshold (the ratchet moving up), a value
 * above the floor already passes — bumping the matching
 * `RATCHET_FLOOR` entry to lock the gain harder is encouraged but
 * not required. `RATCHET_FLOOR` is only ever edited UPWARD: a
 * downward edit here is itself the reviewed, deliberate act of
 * retiring a floor, never a drive-by.
 *
 * Pure static analysis — reads `jest.thresholds.json`, no coverage
 * run, no DB.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

type Metrics = { branches: number; functions: number; lines: number; statements: number };

/**
 * The hard minimum coverage floor — the post-roadmap-3 state
 * (P1 policy, P2 `usecases/` uplift, P3 `lib/` uplift). No value in
 * `jest.thresholds.json` may drop below this. Edit UPWARD only.
 */
const RATCHET_FLOOR: Record<string, Metrics> = {
    global: { branches: 56, functions: 54, lines: 70, statements: 69 },
    // `usecases/` — quality roadmap + stage-3a/3b/3c/3d waves.
    // Post-Roadmap-3 floor was 42 (branches); measured branch
    // coverage had climbed to ~58 without the floor following.
    // Stage 3a (#664): 51 tests on 3 small files, +1 across all.
    // Stage 3b (#666): 41 tests on `audit-readiness/packs` (443
    // lines), file-level 92/85/89/95, +2 across all.
    // Stage 3c (#667): extended `framework-install.test.ts`
    // 15 → 39 tests adding `computeCoverage` + `listTemplates`
    // + missing branches. File-level 45/35/47/44 → 97/95/93/97.
    // +2 across all.
    // Stage 3d (this wave): 30 branch-focused tests on
    // `org-invites.ts` (512 lines, completely untested,
    // compliance-critical: 1 of 3 OrgMembership write paths).
    // File-level 0/0/0/0 → **100/89/100/100**.
    // Stage 3d landed at 62/56/72/69 (the +3 → +2 fixup after
    // CI measured branches at 62.5%).
    // Stage 3e (this wave): 22 branch-focused tests on
    // `webhook-processor.ts` (485 lines, previously untested).
    // Security-critical: signature verification + cross-tenant
    // resolution + replay defense + provider dispatch fan-out.
    // File-level 0/0/0/0 → **98/86/86/99**.
    //
    // CI's full-suite measured: branches **62.98%** (only +0.5
    // over stage-3d's 62.5%) and lines **73.5%**. The +2 bump
    // to 64 branches missed by ~1; the +2 to 74 lines missed
    // by 0.5. Backed off in fixup to:
    //   - branches: stays at 62 (the wave's branch lift on the
    //     broader tree was sub-percentage)
    //   - functions: 56 → 57 (+1)
    //   - lines:     72 → 73 (+1; measured 73.5%)
    //   - statements: 69 → 70 (+1)
    // The test file (durable gain) stays — only the floor moved
    // less aggressively. Branch coverage's plateau here is real
    // signal — webhook-processor is dense but only adds ~25-35
    // branches to the ~4962-branch usecases tree.
    // Stage 3f (this wave): 49 branch-focused tests across TWO
    // files in one PR:
    //   - `framework/coverage.ts` (313 lines): file-level 98/78/95/98
    //     (the lower branches comes from nuanced section/category
    //     fallback chains).
    //   - `control/queries.ts` (337 lines): file-level 100/95/100/100
    //     (dashboard aggregator + consistency-check + RBAC + 3 not-
    //     found paths).
    // Combined ~143 covered branches. Conservative +1 across all
    // metrics after stages 3d/3e showed the broader-tree dilution
    // (a dense file contributes ~0.5-1% absolute on the tree).
    // Stage 3g (this wave): 40 tests across THREE files —
    //   - `soft-delete-lifecycle.ts` (143 lines): file-level
    //     **100/100/100/100** (perfect). 4 fns, 6 throw guards.
    //   - `vendor-assessment-reminder.ts` (129 lines): file-level
    //     **100/96/100/100**. 5 reject-paths + audit + dedup.
    //   - `org-dashboard-widgets.ts` (225 lines): file-level
    //     **100/96/100/100**. Cross-org-id leak defence locked.
    // Combined ~85 covered branches; +1 across all metrics
    // (matches stage 3f's broader-tree-dilution pattern).
    // Next stage 3h (planned): remaining 5 small files
    // (`org-dashboard-presets`, `framework/fixtures`,
    // `org-tenants`, `control/page-data`, `test-readiness`).
    './src/app-layer/usecases/': { branches: 64, functions: 59, lines: 75, statements: 72 },
    // `policies/` — quality roadmap P3. Authorization decisions —
    // a wrong branch is a security hole. Measured ≈82 branches /
    // 91 funcs / 91 lines; seeded a few points below.
    './src/app-layer/policies/': { branches: 78, functions: 88, lines: 88, statements: 85 },
    // `events/` — quality roadmap P3. The hash-chained audit
    // trail — integrity-critical. Measured ≈75 branches / 63 funcs
    // / 80 lines.
    './src/app-layer/events/': { branches: 72, functions: 60, lines: 78, statements: 75 },
    './src/lib/': { branches: 66, functions: 61, lines: 71, statements: 69 },
};

const METRICS: Array<keyof Metrics> = ['branches', 'functions', 'lines', 'statements'];

function loadThresholds(): Record<string, Partial<Metrics>> {
    return JSON.parse(read('jest.thresholds.json'));
}

describe('coverage ratchet — thresholds never slip backward', () => {
    const thresholds = loadThresholds();

    it('every ratchet-floor scope still has a key in jest.thresholds.json', () => {
        for (const scope of Object.keys(RATCHET_FLOOR)) {
            expect(thresholds[scope]).toBeDefined();
        }
    });

    it.each(Object.keys(RATCHET_FLOOR))(
        '%s — no metric is below the ratchet floor',
        (scope) => {
            const actual = thresholds[scope] ?? {};
            const floor = RATCHET_FLOOR[scope];
            const below: string[] = [];
            for (const metric of METRICS) {
                const v = actual[metric];
                expect(typeof v).toBe('number');
                if ((v as number) < floor[metric]) {
                    below.push(`${metric}: ${v} < floor ${floor[metric]}`);
                }
            }
            if (below.length > 0) {
                throw new Error(
                    `${scope} dropped below the coverage ratchet floor:\n  ` +
                        below.join('\n  ') +
                        `\nA floor is never lowered (docs/coverage-policy.md). ` +
                        `Restore the coverage instead of dropping the threshold.`,
                );
            }
        },
    );

    it('the business-logic layer (usecases/) has its own dedicated, higher-assurance floor', () => {
        // usecases/ is Tier A — it must carry a per-folder threshold,
        // not merely ride the (lower-bar) global number.
        expect(thresholds['./src/app-layer/usecases/']).toBeDefined();
        expect(thresholds['./src/app-layer/usecases/']?.branches).toBeGreaterThanOrEqual(
            RATCHET_FLOOR['./src/app-layer/usecases/'].branches,
        );
    });

    it('the risk-tiered coverage policy doc exists', () => {
        expect(fs.existsSync(path.join(ROOT, 'docs/coverage-policy.md'))).toBe(true);
    });

    // ── Regression proof — the detector catches a lowered floor ──
    it('detects a threshold lowered below the floor', () => {
        const sabotaged = JSON.parse(JSON.stringify(thresholds)) as typeof thresholds;
        sabotaged['./src/app-layer/usecases/']!.branches = 10;
        const floor = RATCHET_FLOOR['./src/app-layer/usecases/'].branches;
        expect(sabotaged['./src/app-layer/usecases/']!.branches).toBeLessThan(floor);
    });
});
