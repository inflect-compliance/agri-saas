/**
 * Roadmap-27 — capstone meta-ratchet.
 *
 * The final coherence lock for the Processes Canvas III round. It
 * does NOT re-test what the per-PR ratchets cover; it locks that the
 * round shipped as a whole and enforces two surface-wide coherence
 * invariants that no single per-PR ratchet owns:
 *
 *   • Every Processes component renders on the dedicated canvas
 *     surface ramp — no leftover translucent bg-token opacity
 *     washes, no raw hex colours.
 *   • The round's ratchets, implementation notes, and the
 *     world-class review document all exist.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function exists(rel: string): boolean {
    return fs.existsSync(path.join(ROOT, rel));
}

// Every component file that makes up the Processes surface.
const PROCESS_COMPONENTS = [
    "src/components/processes/PersistedProcessCanvas.tsx",
    "src/components/processes/ProcessCanvas.tsx",
    "src/components/processes/ProcessPalette.tsx",
    "src/components/processes/ProcessTypedNode.tsx",
    "src/components/processes/ProcessEdge.tsx",
    "src/components/processes/ProcessInspector.tsx",
    "src/components/processes/CanvasHelpStrip.tsx",
    "src/app/t/[tenantSlug]/(app)/processes/ProcessesClient.tsx",
];

describe("R27 — capstone: round completeness", () => {
    it("all three R27 ratchets are present", () => {
        expect(exists("tests/guards/r27-pra-visual-foundation.test.ts")).toBe(true);
        expect(exists("tests/guards/r27-prb-graph-elements.test.ts")).toBe(true);
        expect(exists("tests/guards/r27-prf-capstone.test.ts")).toBe(true);
    });

    it("all R27 implementation notes are present", () => {
        expect(
            exists(
                "docs/implementation-notes/2026-05-20-r27-pra-processes-visual-foundation.md",
            ),
        ).toBe(true);
        expect(
            exists(
                "docs/implementation-notes/2026-05-20-r27-prb-processes-graph-elements.md",
            ),
        ).toBe(true);
    });

    it("the world-class architecture review is published", () => {
        expect(exists("docs/processes-canvas-world-class-review.md")).toBe(true);
    });
});

describe("R27 — capstone: surface coherence", () => {
    for (const rel of PROCESS_COMPONENTS) {
        const src = read(rel);
        const file = rel.split("/").pop();

        it(`${file} — no translucent bg-bg-*/NN washes`, () => {
            // R27 replaced every translucent surface with a solid
            // token from the `--canvas-*` ramp. A `/NN` opacity
            // suffix on a bg token re-introduces the flat draft.
            expect(src).not.toMatch(/bg-bg-(default|subtle|muted)\/\d/);
        });

        it(`${file} — no raw hex colours`, () => {
            // Colour flows through tokens only.
            expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
        });
    }
});

describe("R27 — capstone: token ramp integrity", () => {
    const tokens = read("src/styles/tokens.css");
    const RAMP = [
        "--canvas-surface",
        "--canvas-frame",
        "--canvas-grid",
        "--canvas-edge",
        "--canvas-node",
        "--canvas-node-muted",
        "--canvas-border",
    ];

    for (const token of RAMP) {
        it(`${token} — defined in both themes`, () => {
            const defs = tokens.match(new RegExp(`${token}:`, "g")) ?? [];
            expect(defs.length).toBe(2);
        });
    }
});
