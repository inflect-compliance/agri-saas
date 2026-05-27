/**
 * Audit Coherence S9 (closure lock, 2026-05-27) — Gap 9 (control
 * effectiveness scoring) was shipped 2026-05-24. This ratchet locks
 * the surface so a future refactor can't silently drop the rolling
 * pass-rate aggregation or change its window default.
 *
 * The original audit (2026-05-22) flagged the lack of an
 * aggregation over `ControlTestRun` rows — auditors evaluating
 * operating effectiveness want a "pass rate over the last N runs"
 * number, but the only path was to read raw rows and compute by
 * eye. `getControlEffectiveness(controlId)` closes that.
 *
 * Locks the three load-bearing pieces:
 *
 *   1. The exported `ControlEffectiveness` shape — controlId +
 *      passRate + total + passes + fails + inconclusive +
 *      windowDays.
 *   2. The 90-day default rolling window (matches the audit-
 *      readiness scoring convention).
 *   3. The Prisma `groupBy(['result'])` aggregation shape with
 *      the COMPLETED + executedAt-since-cutoff filters.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("Audit S9 — control effectiveness scoring (closure lock)", () => {
    const src = () => read("src/app-layer/usecases/control-test.ts");

    describe("Exported shape", () => {
        it("ControlEffectiveness interface carries the documented fields", () => {
            const s = src();
            expect(s).toMatch(/export interface ControlEffectiveness \{/);
            // Each field anchored on type so a refactor that flips
            // `passRate` from `number | null` to `number` (losing
            // the empty-window semantics) trips this.
            expect(s).toMatch(/controlId:\s*string/);
            expect(s).toMatch(/passRate:\s*number \| null/);
            expect(s).toMatch(/total:\s*number/);
            expect(s).toMatch(/passes:\s*number/);
            expect(s).toMatch(/fails:\s*number/);
            expect(s).toMatch(/inconclusive:\s*number/);
            expect(s).toMatch(/windowDays:\s*number/);
        });

        it("getControlEffectiveness is exported with the canonical signature", () => {
            expect(src()).toMatch(
                /export async function getControlEffectiveness\(\s*ctx:\s*RequestContext,\s*controlId:\s*string,\s*opts:\s*\{\s*windowDays\?:\s*number\s*\}\s*=\s*\{\},?\s*\):\s*Promise<ControlEffectiveness>/,
            );
        });
    });

    describe("Window default", () => {
        it("defaults to 90 days (matches the readiness scoring convention)", () => {
            // Changing the window changes every dashboard that
            // surfaces effectiveness — a refactor to 30 or 180 days
            // needs a deliberate decision.
            expect(src()).toMatch(
                /const DEFAULT_EFFECTIVENESS_WINDOW_DAYS\s*=\s*90/,
            );
            expect(src()).toMatch(
                /opts\.windowDays\s*\?\?\s*DEFAULT_EFFECTIVENESS_WINDOW_DAYS/,
            );
        });
    });

    describe("Aggregation query", () => {
        it("uses Prisma groupBy on `result` (not a manual reduce)", () => {
            // groupBy pushes the COUNT into SQL — a refactor to
            // findMany + JS reduce would be O(n) over rows that
            // the DB can aggregate in O(log n).
            const s = src();
            expect(s).toMatch(/controlTestRun\.groupBy\(/);
            expect(s).toMatch(/by:\s*\[['"]result['"]\]/);
            expect(s).toMatch(/_count:\s*\{\s*_all:\s*true\s*\}/);
        });

        it("filters to COMPLETED runs only, within the window", () => {
            // `IN_PROGRESS` and `SCHEDULED` runs aren't decisions —
            // counting them would inflate the denominator and
            // skew the pass rate. The cutoff must be present so the
            // window actually limits the result set.
            const s = src();
            expect(s).toMatch(/status:\s*['"]COMPLETED['"]/);
            expect(s).toMatch(/executedAt:\s*\{\s*gte:\s*cutoff\s*\}/);
            expect(s).toMatch(/cutoff\.setDate\(cutoff\.getDate\(\)\s*-\s*windowDays\)/);
        });

        it("passRate rounds to integer percentage; null when no runs", () => {
            const s = src();
            // The null case is essential — empty windows must not
            // surface as "0%" (which would read as "all tests
            // failed", semantically wrong).
            expect(s).toMatch(
                /total > 0\s*\?\s*Math\.round\(\(passes\s*\/\s*total\)\s*\*\s*100\)\s*:\s*null/,
            );
        });
    });

    describe("Authorization gate", () => {
        it("calls assertCanReadTests at the top of the function", () => {
            // Effectiveness data is sensitive — a refactor that
            // dropped the gate would surface pass rates to any
            // authenticated session.
            const s = src();
            const start = s.indexOf("export async function getControlEffectiveness");
            const end = s.indexOf("return runInTenantContext", start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            const head = s.slice(start, end);
            expect(head).toMatch(/assertCanReadTests\(ctx\)/);
        });
    });
});
