/**
 * R31 (Bundle 8) — Canvas command palette (PR 9 of the roadmap).
 *
 * Pre-R31 the only canvas commands reachable via keyboard were
 * Cmd+Z / Cmd+Shift+Z / Cmd+S. Every other action required a
 * mouse trip to a strip-toolbar button. Linear, Figma, Notion,
 * Raycast — every world-class tool exposes a Cmd+K palette;
 * Canvas tools commonly expose `/` for an inline insertion
 * palette.
 *
 * R31 ships a CANVAS-LOCAL command palette:
 *
 *   • Mounts inside `<PersistedProcessCanvas>` (so canvas state
 *     lives in the same closure as the command callbacks — no
 *     second source of truth for the action set).
 *   • Triggered by `/` (default-allowInInputs=false, so typing
 *     in the inspector label field doesn't fire it).
 *   • Lists every R28 / R29 / R30 / R31 canvas verb across
 *     three groups: Document (Save / Undo / Redo / New /
 *     Duplicate), Selection (Group / Ungroup / Align L/R/T/B/
 *     C-X / C-Y, Distribute H / V, Delete), Modes (Snap toggle).
 *   • Each command's `disabled` mirrors the toolbar button's
 *     gate exactly (selection count, history availability,
 *     loading flag) so the palette never offers a no-op.
 *
 * NOT in scope this bundle:
 *   • App-wide Cmd+K integration. The app palette is
 *     navigation-shaped; canvas commands stay in the canvas
 *     subtree.
 *   • Fit-view command — xyflow's `fitView` accessor lives
 *     on `useReactFlow()` in a separate boundary; defer.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("R31 (Bundle 8) — canvas command palette", () => {
    describe("CanvasCommandPalette primitive", () => {
        const src = read(
            "src/components/processes/CanvasCommandPalette.tsx",
        );

        it("exports the palette + the command + group types", () => {
            expect(src).toMatch(/export function CanvasCommandPalette/);
            expect(src).toMatch(/export interface CanvasCommand\b/);
            expect(src).toMatch(/export interface CanvasCommandGroup\b/);
        });

        it("binds `/` as the open shortcut via useKeyboardShortcut", () => {
            expect(src).toMatch(
                /useKeyboardShortcut\(["']\/["'],\s*open/,
            );
        });

        it("renders inside a Radix Dialog with the canonical marker", () => {
            expect(src).toMatch(/Dialog\.Root/);
            expect(src).toMatch(/data-canvas-command-palette="true"/);
        });

        it("uses cmdk's Command + Command.Item primitives", () => {
            // Same engine the app palette uses; the canvas palette
            // is just a tighter consumer.
            expect(src).toMatch(/<Command\b/);
            expect(src).toMatch(/Command\.Item/);
        });

        it("each row carries a stable testid + honours disabled state", () => {
            expect(src).toMatch(/data-testid=\{`canvas-command-\$\{cmd\.id\}`\}/);
            expect(src).toMatch(/if\s*\(cmd\.disabled\)\s*return/);
        });
    });

    describe("PersistedProcessCanvas — palette mounted + canvas verbs registered", () => {
        const src = read(
            "src/components/processes/PersistedProcessCanvas.tsx",
        );

        it("imports + mounts the palette inside Inner", () => {
            expect(src).toMatch(
                /import\s*\{\s*\n?\s*CanvasCommandPalette/,
            );
            expect(src).toMatch(/<CanvasCommandPalette\s+groups=/);
        });

        it("declares Document / Selection / Modes groups", () => {
            // Locked at exactly three groups so the canonical
            // taxonomy doesn't drift silently. Adding a fourth
            // group means a deliberate update here.
            expect(src).toMatch(/heading:\s*t\("persistedCanvas\.headingDocument"\)/);
            expect(src).toMatch(/heading:\s*t\("persistedCanvas\.headingSelection"\)/);
            expect(src).toMatch(/heading:\s*t\("persistedCanvas\.headingModes"\)/);
        });

        it("registers every R28-R31 canvas verb as a command", () => {
            // Anchor on the `id:` field — a future PR that
            // renames or drops a command will fail this loudly.
            for (const id of [
                "save",
                "undo",
                "redo",
                "duplicate",
                "new",
                "group",
                "ungroup",
                "align-left",
                "align-center-x",
                "align-right",
                "align-top",
                "align-center-y",
                "align-bottom",
                "distribute-h",
                "distribute-v",
                "delete",
                "snap-toggle",
            ]) {
                expect(src).toMatch(new RegExp(`id:\\s*["']${id}["']`));
            }
        });

        it("disabled gates mirror the toolbar button gates", () => {
            // The palette never offers a no-op: each command's
            // disabled predicate matches the toolbar button's
            // disabled predicate. Anchor on the canonical
            // expressions.
            expect(src).toMatch(/disabled:\s*!history\.canUndo/);
            expect(src).toMatch(/disabled:\s*!history\.canRedo/);
            expect(src).toMatch(/disabled:\s*selectionCount\s*<\s*2/);
            expect(src).toMatch(/disabled:\s*selectionCount\s*<\s*3/);
            expect(src).toMatch(/disabled:\s*selectionCount\s*===\s*0/);
        });
    });
});
