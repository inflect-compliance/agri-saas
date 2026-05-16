/**
 * R23-PR-C — KPI filter URL sync + coexistence ratchet.
 *
 * Two structural locks:
 *   1. The `KpiFilterDef` interface carries an optional `clear`
 *      callback — the seam that lets a KPI scope its toggle-off to
 *      its own keys (so sibling filters / search survive). A future
 *      PR that removes the seam loses the coexistence story.
 *   2. The `useKpiFilter` `toggle` falls back to `ctx.clearAll()`
 *      only when no `clear` is provided. Inverting that — calling
 *      `clearAll` unconditionally — would silently re-introduce the
 *      "toggle wipes siblings" regression PR-C exists to prevent.
 *
 * URL sync itself is owned by the underlying `FilterContextValue`
 * (already covered by the filter primitive's own tests). PR-C
 * deliberately does NOT add a `?kpi=<id>` URL param — the filter
 * state IS the source of truth and KPI activation is derived via
 * `isActive(state)` on every render. The negative invariant
 * (no `?kpi=` param) is locked below.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const HOOK_PATH = 'src/components/ui/kpi-filter/use-kpi-filter.ts';

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('R23-PR-C — KPI URL sync + coexistence', () => {
    const src = read(HOOK_PATH);

    it('KpiFilterDef carries an optional `clear` callback', () => {
        expect(src).toMatch(
            /clear\?\:\s*\(ctx\s*:\s*FilterContextValue\)\s*=>\s*void/,
        );
    });

    it('toggle prefers def.clear over ctx.clearAll when a clear is provided', () => {
        // Pattern lock — the toggle implementation MUST check for
        // def.clear and prefer it. A future "simplify" PR that drops
        // back to unconditional clearAll fails CI.
        expect(src).toMatch(/def\?\.clear\b/);
        expect(src).toMatch(/def\.clear\(ctx\)/);
    });

    it('toggle falls back to ctx.clearAll when def.clear is omitted', () => {
        // The fallback is intentional and documented — an "all/total"
        // KPI without a `clear` should still deactivate via clearAll.
        // Pattern: `def?.clear ? def.clear(ctx) : ctx.clearAll()`.
        expect(src).toMatch(/ctx\.clearAll\(\)/);
    });

    it('does NOT introduce a separate `?kpi=<id>` URL param', () => {
        // The URL contract: KPI state lives implicitly in the
        // underlying filter state (status=OPEN ↔ "Open" KPI active).
        // A future PR that adds a sibling `kpi` URL key would create
        // a second source of truth that can drift from filter state.
        // This negative invariant locks the implicit-state design.
        expect(src).not.toMatch(/['"]kpi['"]/);
        expect(src).not.toMatch(/useSearchParams|useRouter|URLSearchParams/);
    });
});
