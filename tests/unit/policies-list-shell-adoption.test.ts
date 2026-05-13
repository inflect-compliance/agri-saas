/**
 * Structural ratchet — Epic 45.1 policy list migration.
 *
 * Locks the policy list page to:
 *   1. The unified <EntityListPage> shell (Epic 91).
 *   2. The new column set (status / owner / version / next review).
 *   3. The corrected `POLICY_STATUS_LABELS` (filter-defs aligned to
 *      the prisma `PolicyStatus` enum — pre-Epic-45 the filter map
 *      listed `RETIRED` but the schema enum is `ARCHIVED`, so
 *      filtering by "Retired" matched zero rows).
 *
 * Mirrors the controls / risks shell-adoption ratchets — one
 * canonical pattern, one place to update when the contract changes.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const POLICIES_CLIENT = path.resolve(
    __dirname,
    '../../src/app/t/[tenantSlug]/(app)/policies/PoliciesClient.tsx',
);
const FILTER_DEFS = path.resolve(
    __dirname,
    '../../src/app/t/[tenantSlug]/(app)/policies/filter-defs.ts',
);

const clientSrc = readFileSync(POLICIES_CLIENT, 'utf8');
const filterDefsSrc = readFileSync(FILTER_DEFS, 'utf8');

describe('Policies list — Epic 45.1 shell + column wiring', () => {
    it('imports <EntityListPage> from the canonical path', () => {
        expect(clientSrc).toMatch(
            /import\s*\{\s*EntityListPage\s*\}\s*from\s*['"]@\/components\/layout\/EntityListPage['"]/,
        );
    });

    it('does NOT hand-roll <ListPageShell> directly (shell owns it)', () => {
        // The unified shell now owns the header / filters / body
        // composition. A future tidy-up that re-introduced inline
        // `<ListPageShell>` would silently regress consistency.
        expect(clientSrc).not.toMatch(
            /import\s*\{[^}]*\bListPageShell\b[^}]*\}\s*from\s*['"]@\/components\/layout\/ListPageShell['"]/,
        );
    });

    it('preserves the Epic 53 filter context (search + status + category)', () => {
        expect(clientSrc).toMatch(
            /import\s*\{[^}]*\buseFilterContext\b[^}]*\}\s*from\s*['"]@\/components\/ui\/filter['"]/,
        );
        expect(clientSrc).toContain('toApiSearchParams');
        expect(clientSrc).toContain('POLICY_FILTER_KEYS');
    });

    it('mounts <EntityListPage<any>> and threads the canonical props', () => {
        expect(clientSrc).toContain('<EntityListPage<any>');
        expect(clientSrc).toMatch(/header=\{\{[\s\S]{0,200}title:/);
        expect(clientSrc).toMatch(/filters=\{\{[\s\S]{0,200}defs:\s*liveFilters/);
        expect(clientSrc).toMatch(/table=\{\{[\s\S]{0,200}columns:\s*policyColumns/);
    });

    it('does not thread search-id / searchPlaceholder (retired by #443)', () => {
        // The FilterToolbar text-search input was retired site-wide
        // by #443 ("kill FilterToolbar text-search on every list
        // page"). The sidebar Search pill + global ⌘K palette own
        // textual search now. Both props are gone from the
        // canonical entity-list-page filters wiring.
        expect(clientSrc).not.toContain("searchId: 'policy-search'");
        expect(clientSrc).not.toMatch(/searchPlaceholder:\s*['"]Search policies/);
    });

    it('preserves row navigation to the detail page', () => {
        expect(clientSrc).toMatch(
            /onRowClick:\s*\(row\)\s*=>[\s\S]{0,200}router\.push\([\s\S]{0,200}\/policies\//,
        );
    });

    it('exposes the new Version column with currentVersion → lifecycleVersion fallback', () => {
        expect(clientSrc).toContain("id: 'version'");
        expect(clientSrc).toContain("header: 'Version'");
        expect(clientSrc).toMatch(
            /p\.currentVersion\?\.versionNumber\s*\?\?\s*p\.lifecycleVersion/,
        );
        expect(clientSrc).toContain('data-testid={`policy-version-${row.original.id}`}');
    });

    it('upgrades the Owner column to a chip with avatar + name + email', () => {
        // Same shape we landed for controls in PR #94.
        expect(clientSrc).toContain('charAt(0).toUpperCase()');
        expect(clientSrc).toContain('data-testid={`policy-owner-${p.id}`}');
        // Either form of the fallback chain is acceptable — the
        // accessorFn uses `||` (legacy) and the cell uses `??` after
        // an explicit null-check. Both are equivalent for the
        // operator-visible behaviour.
        expect(clientSrc).toMatch(
            /p\.owner\??\.name\s*(?:\?\?|\|\|)\s*p\.owner\??\.email/,
        );
    });

    it('Status column reads labels from POLICY_STATUS_LABELS (single source of truth)', () => {
        expect(clientSrc).toContain('POLICY_STATUS_LABELS');
        // STATUS_BADGE in the page maps every PolicyStatus enum
        // value — drift here would render an unstyled badge for any
        // missing key.
        for (const k of ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']) {
            expect(clientSrc).toContain(`${k}:`);
        }
    });

    it('column visibility config carries every new column as default-visible', () => {
        // R10-PR6 migrated to `useColumnsDropdown` — defaultVisible is
        // now a per-column flag (omitted = visible). Lock that the
        // three columns are present and none opt out.
        for (const id of ['status', 'owner', 'version']) {
            expect(clientSrc).toMatch(new RegExp(`id:\\s*['"]${id}['"]`));
            const entry = clientSrc.match(
                new RegExp(`\\{\\s*id:\\s*['"]${id}['"][^}]*\\}`),
            )?.[0] ?? '';
            expect(entry).not.toMatch(/defaultVisible:\s*false/);
        }
    });

    it('keeps the overdue-review badge visible when nextReviewAt < now', () => {
        expect(clientSrc).toContain("data-testid={`policy-overdue-${p.id}`}");
        expect(clientSrc).toMatch(/new Date\(p\.nextReviewAt\)\s*<\s*hydratedNow/);
    });
});

describe('Policies filter-defs — POLICY_STATUS_LABELS aligned to enum', () => {
    it('uses ARCHIVED (matching the prisma PolicyStatus enum), not RETIRED', () => {
        expect(filterDefsSrc).toContain('ARCHIVED');
        expect(filterDefsSrc).not.toMatch(/RETIRED:\s*['"]Retired['"]/);
    });

    it('covers every PolicyStatus enum value with a human label', () => {
        // The filter picker offers options derived from
        // POLICY_STATUS_LABELS via `optionsFromEnum(...)`. Missing
        // labels disappear from the picker silently.
        for (const k of ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']) {
            expect(filterDefsSrc).toContain(`${k}:`);
        }
    });
});
