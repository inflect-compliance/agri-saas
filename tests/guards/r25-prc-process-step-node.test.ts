/**
 * R25-PR-C — ProcessStepNode ratchet.
 *
 * Locks four invariants:
 *   1. `<ProcessStepNode>` exists at the canonical path + exports
 *      the canonical `PROCESS_STEP_NODE_TYPE` key. The canvas's
 *      nodeTypes registry consumes the key — drift here silently
 *      reverts nodes to xyflow's default rendering.
 *   2. The node renders xyflow's `<Handle type="target">` (left)
 *      + `<Handle type="source">` (right). The L→R handle layout
 *      enforces the process-flow reading direction.
 *   3. The selected state uses brand-emphasis ring (matches R23
 *      KpiFilterCard so canvas + list pages share one selection
 *      vocabulary).
 *   4. ProcessCanvas registers PROCESS_STEP_NODE_TYPE in its
 *      `nodeTypes` registry AND uses it as the default `type` on
 *      drop — otherwise the custom rendering never reaches the
 *      canvas.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
// R26-PR-B retargeted these assertions at the typed-node renderer
// — the R25-era `ProcessStepNode.tsx` is now a thin re-export
// shim. The structural invariants this ratchet enforces still
// hold; they just live one file over now.
const NODE_PATH = "src/components/processes/ProcessTypedNode.tsx";
const CANVAS_PATH = "src/components/processes/PersistedProcessCanvas.tsx";

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("R25-PR-C — ProcessStepNode", () => {
    describe("Component file", () => {
        it("exists at the canonical path", () => {
            expect(fs.existsSync(path.join(ROOT, NODE_PATH))).toBe(true);
        });

        const src = read(NODE_PATH);

        it("exports the typed-node component (alias preserved)", () => {
            // R26-PR-B renamed the implementation to ProcessTypedNode
            // and kept ProcessStepNode as an alias re-export. Either
            // identifier exported from THIS file satisfies the canvas
            // contract.
            expect(src).toMatch(
                /export const (?:ProcessTypedNode|ProcessStepNode)\b/,
            );
        });

        it("exports the PROCESS_STEP_NODE_TYPE registration key", () => {
            expect(src).toMatch(
                /export const PROCESS_STEP_NODE_TYPE\s*=\s*["']processStep["']/,
            );
        });

        it("uses memo to avoid re-renders on every canvas state change", () => {
            // xyflow re-renders nodes whenever a SIBLING node moves.
            // memo here turns those into shallow-prop comparisons,
            // which is essentially free vs the full render path.
            // R26-PR-B renamed the inner impl to ProcessTypedNodeImpl;
            // accept either name.
            expect(src).toMatch(
                /memo\((?:ProcessTypedNodeImpl|ProcessStepNodeImpl)\)/,
            );
        });
    });

    describe("Handle layout (L→R flow direction)", () => {
        const src = read(NODE_PATH);

        it("renders a target handle on the LEFT (input)", () => {
            // R26-PR-B introduced `meta.hasHandles` gating — the
            // Handle JSX is wrapped in a runtime guard so annotation
            // kinds (no flow semantics) skip it. Either form is
            // accepted by this regex.
            expect(src).toMatch(
                /<Handle[\s\S]*?type="target"[\s\S]*?position=\{Position\.Left\}/,
            );
        });

        it("renders a source handle on the RIGHT (output)", () => {
            expect(src).toMatch(
                /<Handle[\s\S]*?type="source"[\s\S]*?position=\{Position\.Right\}/,
            );
        });
    });

    describe("Selected state — brand-emphasis ring", () => {
        const src = read(NODE_PATH);

        it("brand ring + tinted surface on selected", () => {
            // Matches R23 <KpiFilterCard> selected affordance:
            // brand-default ring + bg-bg-elevated tint. Drift here
            // forks the selection vocabulary across surfaces.
            expect(src).toMatch(/ring-2\s+ring-\[color:var\(--brand-default\)\]/);
            expect(src).toMatch(/bg-bg-elevated/);
        });
    });

    describe("Canvas integration", () => {
        const src = read(CANVAS_PATH);

        it("imports PROCESS_STEP_NODE_TYPE + the typed-node renderer", () => {
            // R26-PR-B widened the registry from a single-kind map
            // (`{ [PROCESS_STEP_NODE_TYPE]: ProcessStepNode }`) to an
            // every-kind map driven by NODE_TAXONOMY_ORDER. The
            // imports still flow from the typed-node module.
            expect(src).toMatch(
                /import\s*\{[\s\S]*?ProcessTypedNode[\s\S]*?PROCESS_STEP_NODE_TYPE[\s\S]*?\}\s*from\s*["']\.\/ProcessTypedNode["']/,
            );
        });

        it("registers the node-type table at module scope", () => {
            // xyflow expects a STABLE nodeTypes reference; recreating
            // it per-render forces all nodes to remount and lose
            // state. R26-PR-B's table is built via
            // `Object.fromEntries(NODE_TAXONOMY_ORDER.map(...))` so
            // every canonical kind ends up registered.
            expect(src).toMatch(
                /const NODE_TYPES:\s*NodeTypes\s*=\s*Object\.fromEntries\(\s*NODE_TAXONOMY_ORDER\.map/,
            );
        });

        it("passes the registry to <ReactFlow nodeTypes=...>", () => {
            expect(src).toMatch(/<ReactFlow[\s\S]*?nodeTypes=\{NODE_TYPES\}/);
        });

        it("drop creates nodes with a typed kind (not default)", () => {
            // R25 always minted `type: PROCESS_STEP_NODE_TYPE`.
            // R26-PR-B mints `type: kind` where `kind` is parsed from
            // the typed palette payload. Either shape avoids the
            // xyflow `'default'` fallback that bypasses custom
            // rendering.
            expect(src).toMatch(/type:\s*(?:PROCESS_STEP_NODE_TYPE|kind)/);
            expect(src).not.toMatch(/type:\s*["']default["']/);
        });
    });
});
