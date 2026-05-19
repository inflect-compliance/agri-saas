/**
 * R25-PR-D — ProcessEdge + ControlOnEdge ratchet.
 *
 * Locks five invariants:
 *   1. `<ProcessEdge>` exists at the canonical path + exports the
 *      `PROCESS_EDGE_TYPE` key. Canvas EDGE_TYPES registry
 *      consumes it.
 *   2. The edge is a custom bezier (via `getBezierPath`) — not the
 *      default xyflow stroke.
 *   3. Stroke is token-backed (`var(--border-default)` rest,
 *      `var(--brand-default)` selected) — no hex literals.
 *   4. `<ControlOnEdge>` renders via `EdgeLabelRenderer` (so the
 *      overlay positions correctly at the edge midpoint AND
 *      supports React-component children with native hover/focus).
 *      Visually distinct from `<ProcessStepNode>` (no card recipe,
 *      no handles) — the control reads as belonging to the edge,
 *      not as another node hanging in space.
 *   5. ProcessCanvas registers PROCESS_EDGE_TYPE in EDGE_TYPES AND
 *      uses it as the default `type` on new connections.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const EDGE_PATH = "src/components/processes/ProcessEdge.tsx";
const CANVAS_PATH = "src/components/processes/ProcessCanvas.tsx";
// R26-PR-B retargeted at the typed-node renderer; the legacy
// ProcessStepNode is now a thin re-export shim.
const NODE_PATH = "src/components/processes/ProcessTypedNode.tsx";

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("R25-PR-D — ProcessEdge + ControlOnEdge", () => {
    describe("Component file", () => {
        it("exists at the canonical path", () => {
            expect(fs.existsSync(path.join(ROOT, EDGE_PATH))).toBe(true);
        });

        const src = read(EDGE_PATH);

        it("exports ProcessEdge component", () => {
            expect(src).toMatch(/export const ProcessEdge\b/);
        });

        it("exports the PROCESS_EDGE_TYPE key", () => {
            expect(src).toMatch(
                /export const PROCESS_EDGE_TYPE\s*=\s*["']processEdge["']/,
            );
        });

        it("exports the ControlOnEdge component", () => {
            expect(src).toMatch(/export function ControlOnEdge\b/);
        });

        it("uses memo on the edge component", () => {
            expect(src).toMatch(/memo\(ProcessEdgeImpl\)/);
        });
    });

    describe("Bezier path + token-backed stroke", () => {
        const src = read(EDGE_PATH);

        it("uses xyflow's getBezierPath helper", () => {
            expect(src).toMatch(/getBezierPath\(/);
        });

        it("renders via xyflow's BaseEdge primitive", () => {
            expect(src).toMatch(/<BaseEdge\b/);
        });

        it("stroke uses --border-default at rest", () => {
            expect(src).toMatch(/var\(--border-default\)/);
        });

        it("stroke uses --brand-default when selected", () => {
            expect(src).toMatch(/var\(--brand-default\)/);
        });
    });

    describe("ControlOnEdge overlay", () => {
        const src = read(EDGE_PATH);

        it("positions overlay via EdgeLabelRenderer", () => {
            // EdgeLabelRenderer pulls the overlay OUT of the SVG
            // into an HTML positioned div so the badge can use
            // native React components + tokens + hover states.
            // Without it, we'd need to render inside the SVG and
            // lose the IC chrome story.
            expect(src).toMatch(/<EdgeLabelRenderer\b/);
        });

        it("overlay positions at the bezier midpoint", () => {
            // getBezierPath returns [path, labelX, labelY] — use
            // labelX/labelY for the overlay transform.
            expect(src).toMatch(/labelX[\s\S]*?labelY/);
            expect(src).toMatch(/translate\([^)]*labelX/);
        });

        it("ControlOnEdge has no Handle (it's not a node)", () => {
            // A control overlay must NOT carry connection handles
            // — that would let users connect to it like a node and
            // collapse the visual distinction. The handle import is
            // node-only.
            const controlBlock = src.slice(src.indexOf("function ControlOnEdge"));
            expect(controlBlock).not.toMatch(/<Handle\b/);
        });

        it("uses a shield icon (governance vocabulary)", () => {
            expect(src).toMatch(/ShieldCheck/);
        });

        it("control overlay carries data-control-on-edge-badge marker", () => {
            expect(src).toMatch(/data-control-on-edge-badge/);
        });
    });

    describe("Canvas integration", () => {
        const src = read(CANVAS_PATH);

        it("imports ProcessEdge + PROCESS_EDGE_TYPE", () => {
            expect(src).toMatch(
                /import\s*\{[\s\S]*?ProcessEdge[\s\S]*?PROCESS_EDGE_TYPE[\s\S]*?\}\s*from\s*["']\.\/ProcessEdge["']/,
            );
        });

        it("registers a stable EDGE_TYPES module-level constant", () => {
            expect(src).toMatch(
                /const EDGE_TYPES:\s*EdgeTypes\s*=\s*\{\s*\[PROCESS_EDGE_TYPE\]:\s*ProcessEdge/,
            );
        });

        it("passes the registry to <ReactFlow edgeTypes=...>", () => {
            expect(src).toMatch(/<ReactFlow[\s\S]*?edgeTypes=\{EDGE_TYPES\}/);
        });

        it("new connections get type PROCESS_EDGE_TYPE in onConnect", () => {
            // Without explicit type, addEdge falls back to xyflow's
            // default thin grey stroke. Pin the assignment.
            expect(src).toMatch(/type:\s*PROCESS_EDGE_TYPE/);
        });
    });

    describe("Control + node visual distinction", () => {
        // Critical R25 contract: the control overlay must NOT
        // accidentally adopt node card classes. A future
        // copy-paste from ProcessStepNode that brings `min-w-`,
        // card recipe, or Handle into ControlOnEdge would
        // collapse the distinction.
        const edgeSrc = read(EDGE_PATH);
        const nodeSrc = read(NODE_PATH);

        it("ControlOnEdge does not use the same min-w-[Xpx] card sizing as nodes", () => {
            // ProcessStepNode uses min-w-[160px]. Control overlay
            // should NOT — it's a pill, not a card.
            expect(nodeSrc).toMatch(/min-w-\[160px\]/);
            const controlBlock = edgeSrc.slice(
                edgeSrc.indexOf("function ControlOnEdge"),
            );
            expect(controlBlock).not.toMatch(/min-w-\[160px\]/);
        });
    });
});
