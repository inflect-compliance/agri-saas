/**
 * R25-PR-A — Processes route + shell + Manage nav ratchet.
 *
 * Locks the four invariants the rest of R25 builds on:
 *   1. The `<WorkspaceShell>` primitive exists at the canonical
 *      path with the three composable slots (Header / Toolbar /
 *      Body). PR-B+ depends on these slot names.
 *   2. The Processes route exists at the canonical path
 *      (`src/app/t/[tenantSlug]/(app)/processes/page.tsx`).
 *   3. The page imports + mounts `<WorkspaceShell>` — a future PR
 *      that "simplifies" by dropping the shell and inlining the
 *      layout loses the canvas-centric framing contract.
 *   4. The Manage sidebar section includes a Processes entry
 *      pointing at `/processes`. The label + icon convention
 *      matches its Manage siblings (Policy, Vendor, Report).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("R25-PR-A — Processes route + shell + nav", () => {
    describe("WorkspaceShell primitive", () => {
        const SHELL_PATH = "src/components/layout/WorkspaceShell.tsx";

        it("exists at the canonical path", () => {
            expect(fs.existsSync(path.join(ROOT, SHELL_PATH))).toBe(true);
        });

        const src = read(SHELL_PATH);

        it("exports the WorkspaceShell composite", () => {
            expect(src).toMatch(/export const WorkspaceShell\s*=\s*Object\.assign/);
        });

        it("provides Header / Toolbar / Body slots", () => {
            expect(src).toMatch(/Header:\s*WorkspaceShellHeader/);
            expect(src).toMatch(/Toolbar:\s*WorkspaceShellToolbar/);
            expect(src).toMatch(/Body:\s*WorkspaceShellBody/);
        });

        it("Body is overflow-hidden so the canvas owns pan/scroll", () => {
            // R25 architectural contract: the workspace body never
            // scrolls — the canvas inside (xyflow, d3, etc.) owns
            // pan/zoom semantics. A future PR that adds overflow-
            // auto to the body would break that contract.
            expect(src).toMatch(/overflow-hidden/);
        });

        it("data attribute marker present for downstream selectors", () => {
            expect(src).toMatch(/data-workspace-shell/);
            expect(src).toMatch(/data-workspace-toolbar/);
            expect(src).toMatch(/data-workspace-body/);
        });
    });

    describe("Processes route", () => {
        const PAGE_PATH =
            "src/app/t/[tenantSlug]/(app)/processes/page.tsx";
        const CLIENT_PATH =
            "src/app/t/[tenantSlug]/(app)/processes/ProcessesClient.tsx";

        it("page.tsx exists at the canonical path", () => {
            expect(fs.existsSync(path.join(ROOT, PAGE_PATH))).toBe(true);
        });

        it("ProcessesClient.tsx exists", () => {
            expect(fs.existsSync(path.join(ROOT, CLIENT_PATH))).toBe(true);
        });

        it("page renders the client island", () => {
            const src = read(PAGE_PATH);
            expect(src).toMatch(/import\s*\{\s*ProcessesClient\s*\}/);
            expect(src).toMatch(/<ProcessesClient/);
        });

        it("client mounts <WorkspaceShell> (not <ListPageShell>)", () => {
            // The canvas-centric framing requires the WorkspaceShell.
            // A future PR that switches to ListPageShell would
            // re-introduce filter-toolbar chrome and compromise the
            // canvas layout.
            const src = read(CLIENT_PATH);
            expect(src).toMatch(
                /from\s+["']@\/components\/layout\/WorkspaceShell["']/,
            );
            expect(src).toMatch(/<WorkspaceShell\b/);
            expect(src).not.toMatch(/<ListPageShell\b/);
        });

        it("client renders the Body slot (Header retired in R31)", () => {
            // R31 Bundle 3 (PR 1 — document bar) — the Processes page
            // retired its `<WorkspaceShell.Header>` body. A canvas
            // tool announces itself THROUGH the canvas: the document
            // bar inside `<PersistedProcessCanvas>` now carries the
            // breadcrumbs + document title inline (Figma-style). The
            // Header SLOT remains available in the primitive for
            // future canvas-mode chrome (Design / Run toggle); this
            // page just doesn't mount it. The Body slot stays
            // required — the canvas surface itself.
            const src = read(CLIENT_PATH);
            expect(src).toMatch(/<WorkspaceShell\.Body\b/);
            // Guard against a regression that re-introduces the
            // CRUD-page chrome above the canvas.
            expect(src).not.toMatch(/<WorkspaceShell\.Header\b/);
        });
    });

    describe("Manage nav integration", () => {
        const NAV_PATH = "src/components/layout/SidebarNav.tsx";
        const src = read(NAV_PATH);

        // The Processes sidebar entry was intentionally removed (the
        // compliance surfaces were dropped from the farm-app nav). The
        // /processes ROUTE + shell still exist (covered above) and stay
        // reachable by direct URL; only the nav affordance is gone. This
        // assertion locks the removal in so the entry can't silently
        // return without a deliberate edit here.
        it("no longer registers a `/processes` sidebar entry", () => {
            expect(src).not.toMatch(
                /href:\s*tenantHref\(['"]\/processes['"]\)/,
            );
        });
    });
});
