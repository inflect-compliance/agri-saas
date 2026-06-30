/**
 * Admin API contract tests for the risk-matrix configuration —
 * Epic 44.5
 *
 * Proves the route path the admin editor calls (`PUT /api/t/:slug/
 * admin/risk-matrix-config`) is gated by the canonical
 * `requirePermission('admin.manage')` rule. The usecase-level
 * validation + persistence flow is already covered by
 * `tests/integration/risk-matrix-config.test.ts`; this file
 * narrowly tests the surface the admin UI hits.
 */

import * as fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('Admin risk-matrix-config API — wiring', () => {
    const routeSrc = read(
        'src/app/api/t/[tenantSlug]/admin/risk-matrix-config/route.ts',
    );
    const permsSrc = read('src/lib/security/route-permissions.ts');

    it('PUT route enforces admin.manage permission', () => {
        expect(routeSrc).toMatch(/requirePermission\(['"]admin\.manage['"]/);
        expect(routeSrc).toMatch(/export const PUT/);
    });

    it('route-permissions registry carries the admin/risk-matrix-config rule', () => {
        // `tests/guards/route-permission-coverage.test.ts` enforces
        // that every admin route in src/app/api/**/admin has a rule;
        // this assertion mirrors the rule shape so a future "tidy
        // up" can't drop the rule + leave the route unguarded.
        // (Source uses double-backslash escapes; we look for the
        // literal substring instead of regex to keep the assertion
        // robust to escape-form drift.)
        const idx = permsSrc.indexOf('risk-matrix-config');
        expect(idx).toBeGreaterThan(0);
        const window = permsSrc.slice(idx, idx + 600);
        expect(window).toContain("'admin.manage'");
    });

    it('admin route also exposes a GET twin for the editor convenience read', () => {
        expect(routeSrc).toMatch(/export const GET/);
        // The same admin.manage gate protects both methods; the
        // matrix shape isn't sensitive on its own, but the admin
        // surface is namespaced consistently.
        expect(
            (routeSrc.match(/requirePermission\(['"]admin\.manage['"]/g) ?? [])
                .length,
        ).toBeGreaterThanOrEqual(2);
    });

    it('route-permissions documents the read-only sibling at /risk-matrix-config (risks.view)', () => {
        // The note explicitly calls out the read-only sibling so
        // future audits don't tighten the wrong path.
        expect(permsSrc).toContain('Risk matrix configuration');
        expect(permsSrc).toContain('Read-only sibling');
    });
});
