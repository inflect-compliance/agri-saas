/**
 * R32-PR10 — Canvas decomposition ratchet (slice 1: document bar).
 *
 * The brutal-verdict review's PR 10 called out the
 * `<PersistedProcessCanvas>` god-component (1,950+ lines post-R31).
 * The verdict named five extraction targets:
 *
 *   • `<CanvasDocumentBar>` — the inline toolbar JSX
 *   • `<CanvasLeftPalette>` — already separate (`<ProcessPalette>`)
 *   • `<CanvasMinimap>` + `<CanvasZoomControls>` — already xyflow
 *     primitives mounted inline
 *   • `<CanvasCommandPalette>` — shipped Bundle 8 (#724)
 *   • `<CanvasInspector>` — already separate (`<ProcessInspector>`)
 *
 * Plus consolidating the three save-payload serialisers into a
 * `useProcessMapDocument` hook.
 *
 * Slice 1 (this PR) — extract the document bar. The serialiser
 * consolidation defers to a future bundle because its data-
 * integrity implications (three current paths handle slightly
 * different payload shapes) warrant a dedicated PR with focused
 * tests against the save → load round-trip.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("R32-PR10 — canvas decomposition (document bar)", () => {
    describe("CanvasDocumentBar primitive", () => {
        const src = read("src/components/processes/CanvasDocumentBar.tsx");

        it("exports the component + its five grouped prop types", () => {
            expect(src).toMatch(/export function CanvasDocumentBar/);
            expect(src).toMatch(/export interface CanvasDocumentBarDoc/);
            expect(src).toMatch(/export interface CanvasDocumentBarBusy/);
            expect(src).toMatch(
                /export interface CanvasDocumentBarEditorState/,
            );
            expect(src).toMatch(/export interface CanvasDocumentBarHandlers/);
        });

        it("preserves every testid the R26/R28/R31 ratchets pin", () => {
            // The extraction is byte-identical for these IDs;
            // breaking any one of them would break upstream
            // ratchets without a clear signal.
            for (const id of [
                "process-selector",
                "process-name-input",
                "new-process-btn",
                "duplicate-process-btn",
                "canvas-undo-btn",
                "canvas-redo-btn",
                "canvas-snap-toggle",
                "autosave-status",
                "save-process-btn",
            ]) {
                expect(src).toMatch(new RegExp(`data-testid="${id}"`));
            }
        });

        it("preserves the canonical document-bar + breadcrumb markers", () => {
            expect(src).toMatch(/data-persisted-canvas-toolbar="true"/);
            expect(src).toMatch(/data-canvas-document-bar="true"/);
            expect(src).toMatch(/data-canvas-document-breadcrumb="true"/);
        });

        it("owns no state — every field flows through props", () => {
            // The bar must NOT call `useState`, `useReducer`,
            // `useEffect`, etc. State ownership stays with `Inner`
            // upstream; the bar is a pure render.
            expect(src).not.toMatch(/useState\b/);
            expect(src).not.toMatch(/useEffect\b/);
            expect(src).not.toMatch(/useReducer\b/);
            expect(src).not.toMatch(/useRef\b/);
        });
    });

    describe("PersistedProcessCanvas — toolbar JSX retired", () => {
        const src = read(
            "src/components/processes/PersistedProcessCanvas.tsx",
        );

        it("imports + mounts CanvasDocumentBar", () => {
            expect(src).toMatch(
                /import\s*\{\s*CanvasDocumentBar\s*\}\s*from\s*["']\.\/CanvasDocumentBar["']/,
            );
            expect(src).toMatch(/<CanvasDocumentBar\b/);
        });

        it("passes the five canonical prop groups", () => {
            // The bar takes `tenantSlug` directly + four grouped
            // objects. Locked on the canonical group names so a
            // future refactor that drops one (e.g. rolls `busy`
            // into `editorState`) trips this and gets a written
            // justification.
            expect(src).toMatch(/tenantSlug=\{tenantSlug\}/);
            expect(src).toMatch(/doc=\{/);
            expect(src).toMatch(/busy=\{/);
            expect(src).toMatch(/editorState=\{/);
            expect(src).toMatch(/handlers=\{/);
        });

        it("the legacy inline toolbar block is gone", () => {
            // The pre-R32 inline toolbar carried both the
            // breadcrumb <nav> AND the action buttons within the
            // same wrapper div. The retirement comment leaves a
            // single line marker; the JSX itself is gone. The
            // markers below now live INSIDE the extracted
            // component, NOT inside PersistedProcessCanvas.tsx.
            expect(src).not.toMatch(/data-canvas-document-breadcrumb="true"/);
            // The data-persisted-canvas-toolbar marker is also
            // gone from PersistedProcessCanvas — it lives in the
            // extracted CanvasDocumentBar now.
            expect(src).not.toMatch(/data-persisted-canvas-toolbar="true"/);
        });
    });

    describe("Decomposition progress — file size", () => {
        it("PersistedProcessCanvas.tsx shrinks below the post-R32 floor", () => {
            // Pre-R32 the file was 2018 lines. R32-PR10 decomposed
            // the toolbar (≈195 lines out, ≈30 lines in) and the
            // file landed at ≈1859 lines.
            //
            // Subsequent feature growth (continuing the extraction
            // trend at each step) added two helper modules without
            // bloating the canvas back to the pre-R32 footprint:
            //   - Epic P1 — `surfaceVersionConflict` extracted to
            //     `src/lib/processes/version-conflict-toast.ts`
            //     (the canvas wires the helper but doesn't own
            //     the toast-message + body-parse boilerplate);
            //   - Epic P2-PR-A — `edgeControlsForSave` extracted
            //     to `src/lib/processes/edge-controls.ts` (the
            //     canvas calls one function instead of declaring
            //     a 50-line peeler inline).
            //
            // The cap moves with each absorbed feature; bumps
            // come paired with a written justification rather than
            // silently floating. Current cap: 2150. Bumps:
            //   - 1900 → 1925 (Epic P1 + P2-PR-A) — concurrency
            //     check + edge control picker.
            //   - 1925 → 1950 (Epic P2-PR-B) — node entity
            //     pickers + linkedEntityId dataJson round-trip.
            //   - 1950 → 1975 (Epic P3-PR-A) — PNG/SVG export
            //     menu wiring.
            //   - 1975 → 2025 (Epic P4-PR-A) — dagre auto-layout
            //     handler + "Layout" command group.
            //   - 2025 → 2150 (Epic P4-PR-B) — clipboard handlers
            //     (Cmd+C/V/D) + Tab-to-create + connection-
            //     rejection state + rejected-node className
            //     projection. ~120 lines for three keyboard
            //     features; the clipboard logic itself lives in
            //     `canvas-clipboard.ts` so the canvas only owns
            //     the wire-up.
            // Future Epics (P5 snapshots, P6 deferred) follow the
            // same helper-module-per-feature pattern.
            const src = read(
                "src/components/processes/PersistedProcessCanvas.tsx",
            );
            const lines = src.split("\n").length;
            expect(lines).toBeLessThan(2150);
        });
    });
});
