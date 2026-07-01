/**
 * v2-PR-6 — `<DashboardLayout>` primitive contract + adoption ratchet.
 *
 * Asserts the new dashboard composition shell exists and that the
 * canonical adoption site (the executive dashboard) consumes it.
 *
 * Three public layout shells now coexist:
 *   - <EntityListPage>     — list pages (DataTable + FilterToolbar)
 *   - <EntityDetailLayout> — entity detail pages (header + tabs + body)
 *   - <DashboardLayout>    — dashboard pages (this PR)
 *
 * All three delegate the page header to the same `<PageHeader>`
 * primitive (v2-PR-5), so reading order, typography, and spacing are
 * unified across the entire app.
 *
 * Pairs with:
 *   - src/components/layout/DashboardLayout.tsx
 *   - src/components/layout/PageHeader.tsx
 *   - tests/guards/page-header-discipline.test.ts
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("v2-PR-6 DashboardLayout primitive contract", () => {
    const src = fs.readFileSync(
        path.join(ROOT, "src/components/layout/DashboardLayout.tsx"),
        "utf8",
    );

    it("exports the DashboardLayout component + props interface", () => {
        expect(src).toMatch(/export\s+function\s+DashboardLayout/);
        expect(src).toMatch(/export\s+interface\s+DashboardLayoutProps/);
    });

    it("delegates the header to <PageHeader>", () => {
        expect(src).toMatch(
            /import\s+\{[^}]*PageHeader[^}]*\}\s+from\s+["']\.\/PageHeader["']/,
        );
        expect(src).toMatch(/<PageHeader\b/);
    });

    it("requires a header prop typed as PageHeaderProps", () => {
        expect(src).toMatch(/header:\s*PageHeaderProps/);
    });

    it("wraps in `space-y-section animate-fadeIn`", () => {
        // The shared dashboard rhythm — vertical sections + fade on
        // first paint. Asserting both classes appear on the wrapper
        // keeps the rhythm constant across consumers.
        expect(src).toMatch(/space-y-section/);
        expect(src).toMatch(/animate-fadeIn/);
    });

    it("carries the data-dashboard-layout marker for E2E selectors", () => {
        expect(src).toMatch(/data-dashboard-layout/);
    });
});

describe("v2-PR-6 executive dashboard adoption", () => {
    const src = fs.readFileSync(
        path.join(
            ROOT,
            "src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx",
        ),
        "utf8",
    );

    // The farm-UI trim removed the dashboard masthead header (the
    // "Compliance Dashboard" PageHeader), so DashboardClient no longer
    // mounts <DashboardLayout> — the page's greeting header (server
    // page.tsx) is the sole masthead. Forward-guard the removal.
    it("no longer mounts <DashboardLayout> (masthead header removed)", () => {
        expect(src).not.toContain("DashboardLayout");
    });

    it("no longer hand-rolls a level-1 page heading", () => {
        // The page now passes `title` to <DashboardLayout>'s header
        // prop instead of rendering <Heading level={1}> inline. Lower-
        // level <Heading> nodes (e.g. level=2/3 inside section cards)
        // are unaffected.
        expect(src).not.toMatch(/<Heading\s+level=\{1\}/);
    });
});
