/**
 * E2E coverage manifest — quality roadmap P4 first wave.
 *
 * Four UI surfaces were explicitly deferred to browser/E2E
 * verification because their assurance is shaped by real user
 * interaction, not source structure: the search-affordance kill
 * sweep, the tenant switcher, FilterToolbar coverage, and
 * `<EntityDetailLayout>`. P4 lands the first meaningful wave of
 * E2E for each.
 *
 * This manifest makes the coverage VISIBLE — and prevents one of
 * the four specs from being silently deleted, dropping a surface
 * back into ambiguous "deferred" status. Each entry pins:
 *   - the spec file (must exist), and
 *   - a structural anchor in the spec body (must be present), so a
 *     rename-and-gut regression is caught.
 *
 * Adding a new surface to this list locks it in the same shape;
 * removing one is a deliberate, reviewed act, not a drive-by.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

interface E2EManifestEntry {
    /** The browser-shaped surface this entry locks. */
    surface: string;
    /** Relative path under `tests/e2e/`. */
    spec: string;
    /** Substring that MUST appear in the spec body. Catches a
     *  rename-and-gut: the file still exists but no longer carries
     *  the canonical assertion. */
    anchor: string;
}

const E2E_MANIFEST: ReadonlyArray<E2EManifestEntry> = [
    {
        surface: 'Search affordance — Ctrl+K palette, no rogue searchbars',
        spec: 'tests/e2e/search-affordances.spec.ts',
        anchor: 'command-palette-input',
    },
    {
        surface: 'Tenant switcher — trigger opens, lists the current tenant',
        spec: 'tests/e2e/tenant-switcher.spec.ts',
        anchor: 'top-chrome-tenant-switcher',
    },
    {
        surface: 'FilterToolbar — apply/clear chip round-trips through URL',
        spec: 'tests/e2e/filter-toolbar-coverage.spec.ts',
        anchor: 'clear filters',
    },
    {
        surface: 'EntityDetailLayout — breadcrumbs / header / body render',
        spec: 'tests/e2e/entity-detail-layout.spec.ts',
        anchor: 'entity-detail-header',
    },
];

describe('E2E coverage manifest (quality roadmap P4 first wave)', () => {
    it.each(E2E_MANIFEST.map((e) => [e.surface, e]))(
        '%s — spec exists',
        (_surface, entry) => {
            const e = entry as E2EManifestEntry;
            const abs = path.join(ROOT, e.spec);
            expect(fs.existsSync(abs)).toBe(true);
        },
    );

    it.each(E2E_MANIFEST.map((e) => [e.surface, e]))(
        '%s — spec body carries the canonical assertion',
        (_surface, entry) => {
            const e = entry as E2EManifestEntry;
            const body = fs.readFileSync(path.join(ROOT, e.spec), 'utf8');
            expect(body).toContain(e.anchor);
        },
    );

    it('the manifest pins every deferred P4 surface', () => {
        // The 4-surface scope is locked here so a future PR cannot
        // quietly drop an entry. Adding a 5th surface lifts the
        // count; the prompt scope is exactly four.
        expect(E2E_MANIFEST).toHaveLength(4);
    });
});
