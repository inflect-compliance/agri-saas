/**
 * R25-PR-B — xyflow canvas + palette integration ratchet.
 *
 * Locks four invariants the rest of R25 depends on:
 *   1. `<ProcessCanvas>` exists at the canonical path and consumes
 *      xyflow's `<ReactFlow>` + `<ReactFlowProvider>` + dot
 *      `<Background>`. PR-C/D wire custom node + edge types via
 *      this canvas's API surface.
 *   2. `<ProcessPalette>` exports the canonical drag mime
 *      (`PALETTE_DRAG_MIME`). The canvas reads this on `onDrop` —
 *      if the constant ever drifts between palette and canvas, the
 *      drag-drop wiring silently breaks.
 *   3. The Processes page client mounts `<ProcessCanvas>` (not a
 *      raw `<ReactFlow>` inline). Centralised wrapping is the R25
 *      decision against canvas drift.
 *   4. `<ProcessCanvas>` is dynamic-imported with `ssr:false` —
 *      xyflow uses browser-only APIs; SSRing crashes. Same boundary
 *      as the existing `<GraphExplorer>`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

const CANVAS_PATH = "src/components/processes/ProcessCanvas.tsx";
const PALETTE_PATH = "src/components/processes/ProcessPalette.tsx";
const CLIENT_PATH =
    "src/app/t/[tenantSlug]/(app)/processes/ProcessesClient.tsx";

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("R25-PR-B — xyflow canvas + palette", () => {
    describe("ProcessCanvas component", () => {
        it("exists at the canonical path", () => {
            expect(fs.existsSync(path.join(ROOT, CANVAS_PATH))).toBe(true);
        });

        const src = read(CANVAS_PATH);

        it("imports the xyflow primitives we depend on", () => {
            expect(src).toMatch(/from\s+["']@xyflow\/react["']/);
            expect(src).toMatch(/\bReactFlow\b/);
            expect(src).toMatch(/\bReactFlowProvider\b/);
            expect(src).toMatch(/\bBackground\b/);
        });

        it("imports the xyflow stylesheet (required for default rendering)", () => {
            expect(src).toMatch(
                /import\s+["']@xyflow\/react\/dist\/style\.css["']/,
            );
        });

        it("wires the drag-drop pair (onDragOver + onDrop)", () => {
            expect(src).toMatch(/onDragOver/);
            expect(src).toMatch(/onDrop/);
        });

        it("uses screenToFlowPosition for drop coordinates", () => {
            // Critical: dropping at a screen position must convert
            // to the FLOW coordinate space (accounts for pan +
            // zoom). A future PR that uses raw clientX/Y here would
            // place nodes off-screen as the user pans the canvas.
            expect(src).toMatch(/screenToFlowPosition/);
        });

        it("reads palette drag payloads via PALETTE_DRAG_MIME", () => {
            // The canvas + palette must agree on the mime type.
            // Asserted on both sides — drift in either breaks drop.
            expect(src).toMatch(/PALETTE_DRAG_MIME/);
        });

        it("mounts ReactFlowProvider (required for useReactFlow consumers)", () => {
            expect(src).toMatch(/<ReactFlowProvider\b/);
        });

        it("hides the xyflow attribution badge (pro-options)", () => {
            // The "React Flow" attribution in the corner reads as a
            // demo affordance and breaks the IC premium tone. Hide
            // it via the proOptions escape hatch.
            expect(src).toMatch(/proOptions[\s\S]*?hideAttribution[\s\S]*?true/);
        });

        it("uses the IC canvas-grid token for the dot grid colour", () => {
            // The dot grid must be quiet — black or vivid colours
            // read as visual noise. Roadmap-27 pins it to the
            // dedicated `--canvas-grid` token (the Processes surface
            // ramp) so a theme flip resolves the right tone.
            expect(src).toMatch(/var\(--canvas-grid\)/);
        });
    });

    describe("ProcessPalette component", () => {
        it("exists at the canonical path", () => {
            expect(fs.existsSync(path.join(ROOT, PALETTE_PATH))).toBe(true);
        });

        const src = read(PALETTE_PATH);

        it("exports PALETTE_DRAG_MIME constant", () => {
            expect(src).toMatch(/export const PALETTE_DRAG_MIME\s*=/);
        });

        it("uses the agrent-namespaced mime type", () => {
            // Namespace avoids collisions with arbitrary HTML5 drag
            // sources (file uploads, browser-tab tear-off, etc.).
            expect(src).toMatch(
                /["']application\/x-agrent-process-step["']/,
            );
        });

        it("renders draggable palette items", () => {
            expect(src).toMatch(/draggable/);
            expect(src).toMatch(/onDragStart/);
            expect(src).toMatch(/setData\(PALETTE_DRAG_MIME/);
        });
    });

    describe("Processes page consumer (R26-PR-A — via PersistedProcessCanvas)", () => {
        // R25 shipped the page mounting `<ProcessCanvas>` directly
        // via `dynamic()` in ProcessesClient.tsx. R26-PR-A introduces
        // a persistence layer between the page and the raw xyflow
        // canvas (`<PersistedProcessCanvas>`), which owns the save/
        // load wiring. The two invariants still hold — xyflow lives
        // behind a `ssr:false` boundary, and `<ReactFlow>` is never
        // mounted inline at the page-shell level — they just resolve
        // on the wrapper component now.
        const PERSISTED_PATH =
            "src/components/processes/PersistedProcessCanvas.tsx";
        const clientSrc = read(CLIENT_PATH);
        const persistedSrc = read(PERSISTED_PATH);

        it("dynamic-imports the persisted-canvas wrapper with ssr:false", () => {
            expect(clientSrc).toMatch(/dynamic\(/);
            expect(clientSrc).toMatch(/PersistedProcessCanvas/);
            expect(clientSrc).toMatch(/ssr:\s*false/);
        });

        it("mounts the persisted-canvas wrapper (not raw ReactFlow inline) from the page", () => {
            expect(clientSrc).toMatch(/<PersistedProcessCanvas\b/);
            expect(clientSrc).not.toMatch(/<ReactFlow\b/);
        });

        it("PersistedProcessCanvas remains a client component", () => {
            // The wrapper that hosts xyflow MUST carry "use client"
            // so it never runs through the SSR pipeline (xyflow
            // touches browser-only APIs on mount). Same boundary
            // R25 enforced via `dynamic(..., { ssr: false })`.
            expect(persistedSrc).toMatch(/^["']use client["'];/m);
        });

        it("PersistedProcessCanvas mounts ReactFlowProvider + ReactFlow", () => {
            // The wrapper owns the xyflow tree end-to-end. The page
            // chrome above it only mounts the wrapper.
            expect(persistedSrc).toMatch(/<ReactFlowProvider\b/);
            expect(persistedSrc).toMatch(/<ReactFlow\b/);
        });
    });
});
