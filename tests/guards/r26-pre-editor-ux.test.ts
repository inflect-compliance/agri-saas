/**
 * R26-PR-E — Editor UX structural ratchet.
 *
 * R26-PR-A landed the bare-minimum save/load loop. PR-E builds
 * the editor layer the user needs to actually FEEL like they're
 * authoring:
 *
 *   1. Inline rename — the toolbar carries a name input that
 *      commits on blur/Enter. Replaces the read-only "selector
 *      shows the name" model.
 *   2. Duplicate ("Save as") — a button that POSTs a fresh
 *      process with the current graph and switches the active
 *      selection to the new map.
 *   3. Inspector panel — when a node is selected, a slim right-
 *      side panel surfaces the node's editable properties
 *      (label + subtitle). Mounts on selection, hides otherwise.
 *
 * This ratchet locks the WIRING, not the visual specifics:
 *   • The inline rename input + commit handler exist.
 *   • The Duplicate button + POST handler exist.
 *   • The Inspector component is imported + mounted with the
 *     selected-node accessor.
 *   • Inspector receives an `onUpdate` callback that patches
 *     the node's data via setNodes (no parallel state path).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const CANVAS_PATH =
    "src/components/processes/PersistedProcessCanvas.tsx";
// R32-PR10 extracted the document bar JSX (toolbar buttons, name
// input, duplicate button) into its own `<CanvasDocumentBar>`
// component. Testid assertions that targeted CANVAS_PATH now read
// `DOC_BAR_PATH` instead — handlers stay on the canvas, JSX lives
// in the bar.
const DOC_BAR_PATH =
    "src/components/processes/CanvasDocumentBar.tsx";
const INSPECTOR_PATH = "src/components/processes/ProcessInspector.tsx";

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("R26-PR-E — editor UX wiring", () => {
    const canvasSrc = read(CANVAS_PATH);
    const docBarSrc = read(DOC_BAR_PATH);

    describe("inline rename", () => {
        it("the toolbar mounts an editable name input", () => {
            // The input must carry the canonical testid + an
            // aria-label for accessibility. R32-PR10 — the JSX
            // lives in the extracted document bar; the canvas
            // delegates via props.
            expect(docBarSrc).toMatch(
                /data-testid=["']process-name-input["']/,
            );
            expect(docBarSrc).toMatch(/aria-label=\{t\("processDocBar\.processName"\)\}/);
        });

        it("rename commits on blur / Enter (NOT on every keystroke)", () => {
            // The commit handler `handleRenameCommit` stays defined
            // in the canvas; the JSX (`onBlur={handleRenameCommit}`)
            // lives in the bar — both are required.
            expect(docBarSrc).toMatch(/onBlur=\{handleRenameCommit\}/);
            expect(canvasSrc).toMatch(/handleRenameCommit/);
        });
    });

    describe("duplicate", () => {
        it("the toolbar mounts the Duplicate button when a process is active", () => {
            // R32-PR10 — testid lives in the extracted bar.
            expect(docBarSrc).toMatch(
                /data-testid=["']duplicate-process-btn["']/,
            );
            expect(docBarSrc).toMatch(/Duplicate/);
        });

        it("duplicate POSTs a new process then PUTs the current graph", () => {
            // The two-round-trip shape is intentional: create then
            // fill. A future PR collapsing to a single endpoint
            // would change the API surface; this ratchet would
            // flag that for review.
            expect(canvasSrc).toMatch(/handleDuplicate/);
            expect(canvasSrc).toMatch(
                /\/api\/t\/\$\{tenantSlug\}\/processes\b/,
            );
        });
    });

    describe("inspector", () => {
        it("ProcessInspector exists at the canonical path", () => {
            expect(fs.existsSync(path.join(ROOT, INSPECTOR_PATH))).toBe(true);
        });

        it("the canvas imports + mounts the inspector", () => {
            expect(canvasSrc).toMatch(
                /import\s*\{\s*ProcessInspector\s*\}\s*from\s*["']\.\/ProcessInspector["']/,
            );
            expect(canvasSrc).toMatch(/<ProcessInspector\b/);
        });

        it("inspector receives the selected node + an update callback", () => {
            // The `selectedNode` derivation reads off xyflow's
            // internal selection state via the live nodes array.
            // The update callback patches via setNodes — no
            // parallel state path that could drift.
            expect(canvasSrc).toMatch(/selectedNode/);
            expect(canvasSrc).toMatch(/handleInspectorUpdate/);
            expect(canvasSrc).toMatch(
                /onUpdate=\{handleInspectorUpdate\}/,
            );
        });
    });

    describe("ProcessInspector component", () => {
        const inspectorSrc = read(INSPECTOR_PATH);

        it("returns null when no node is selected (hides cleanly)", () => {
            expect(inspectorSrc).toMatch(/if\s*\(\s*!node\s*\)/);
            expect(inspectorSrc).toMatch(/return\s+null/);
        });

        it("commits on blur AND Enter for both fields", () => {
            // The commit-on-blur + commit-on-Enter pair is the
            // canonical text-input commit shape across IC inline
            // editors. A future "commit-on-debounce" replacement
            // would change the contract.
            expect(inspectorSrc).toMatch(/onBlur=\{commit\}/);
            expect(inspectorSrc).toMatch(/key === ["']Enter["']/);
        });

        it("exposes the label + subtitle test ids", () => {
            // E2E selectors depend on these. A future PR renaming
            // them silently would break the E2E suite.
            expect(inspectorSrc).toMatch(
                /data-testid=["']inspector-label-input["']/,
            );
            expect(inspectorSrc).toMatch(
                /data-testid=["']inspector-subtitle-input["']/,
            );
        });
    });
});
