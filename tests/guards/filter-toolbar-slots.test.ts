/**
 * v2-PR-7 — `<FilterToolbar>` slots ratchet.
 *
 * Asserts the canonical reading order on every list page:
 *
 *   [search + filter button] [active pills] [secondary] [primary]
 *
 * Where `secondary` carries icon-only ghost actions (column
 * visibility, bulk export, settings) and `primary` is reserved for
 * the SINGLE primary action of the page (the "Create X" button).
 *
 * Why this is a ratchet:
 *   - The previous toolbar had only one right-edge slot (`actions`).
 *     Pages crowded primary CTAs into the page header instead, which
 *     diluted hierarchy: header buttons should navigate, toolbar
 *     buttons should mutate.
 *   - The slot lock keeps premium feel — never two "Create" buttons
 *     side-by-side, never a primary swimming inside an icon row.
 *
 * Pairs with:
 *   - src/components/filters/FilterToolbar.tsx (the slots)
 *   - src/components/layout/EntityListPage.tsx (the consumer
 *     interface — `filters.toolbarPrimary` threads into the slot)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("v2-PR-7 FilterToolbar slot contract", () => {
    const src = fs.readFileSync(
        path.join(ROOT, "src/components/filters/FilterToolbar.tsx"),
        "utf8",
    );

    it("declares both `actions` and `primary` slot props", () => {
        expect(src).toMatch(/\bactions\?:/);
        expect(src).toMatch(/\bprimary\?:/);
    });

    it("destructures `primary` in the function signature", () => {
        expect(src).toMatch(/function\s+FilterToolbar\(\{[\s\S]*?\bprimary,/);
    });

    it("renders both slot wrappers with stable test ids", () => {
        // Each slot has a wrapping div with a data-testid so consumer
        // tests can target the cluster regardless of the inner shape.
        expect(src).toContain('data-testid="filter-toolbar-secondary"');
        expect(src).toContain('data-testid="filter-toolbar-primary"');
    });

    it("renders secondary BEFORE primary (canonical reading order)", () => {
        const secondaryIdx = src.indexOf(
            'data-testid="filter-toolbar-secondary"',
        );
        const primaryIdx = src.indexOf(
            'data-testid="filter-toolbar-primary"',
        );
        expect(secondaryIdx).toBeGreaterThan(0);
        expect(primaryIdx).toBeGreaterThan(0);
        expect(secondaryIdx).toBeLessThan(primaryIdx);
    });
});

describe("v2-PR-7 EntityListPage exposes the slots", () => {
    const src = fs.readFileSync(
        path.join(ROOT, "src/components/layout/EntityListPage.tsx"),
        "utf8",
    );

    it("EntityListPageFilters declares `toolbarPrimary` slot", () => {
        expect(src).toMatch(/\btoolbarPrimary\?:/);
        expect(src).toMatch(/\btoolbarActions\?:/);
    });

    it("threads `filters.toolbarPrimary` into the FilterToolbar primary slot", () => {
        expect(src).toMatch(/primary=\{filters\.toolbarPrimary\}/);
    });
});
