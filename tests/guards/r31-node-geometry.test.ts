/**
 * R31 (Bundle 2) — Node geometry discipline.
 *
 * Closes PR 4 of the 10-PR design refinement roadmap. The
 * pre-R31 vocabulary mixed three shapes (rect / diamond / note)
 * and a dashed-border treatment on the `subtle` accent. The
 * verdict found both vocabulary lifts (BPMN-2004 diamond + the
 * dashed border) competing with the rest of the canvas's
 * language. R31 collapses to TWO shapes (rect + note), drops
 * the dashed-border treatment, and introduces a quiet per-kind
 * corner-sticker affordance that scales to any future kind.
 *
 *   • Decision: shape changes 'diamond' → 'rect'; gets a "?"
 *     corner sticker.
 *   • External: dashed border retired (the `subtle` accent
 *     class drops `border-dashed`); gets an "EXT" sticker.
 *   • The renderer drops its diamond branch entirely;
 *     DIAMOND_SIZE table is gone.
 *   • The corner-sticker slot is exposed via
 *     `data-process-node-sticker` so future kinds (locked /
 *     errored / awaiting-review / …) plug into the same slot.
 *
 * The supersession is documented in r26-prb-node-taxonomy +
 * r27-prb-graph-elements (the previous ratchets flipped their
 * diamond assertions into NEGATIVE forms so re-introduction
 * fails CI).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("R31 (Bundle 2) — node geometry", () => {
    describe("taxonomy", () => {
        const src = read("src/components/processes/node-taxonomy.ts");

        it("NodeShape union is two members (rect, note)", () => {
            // The supersession comment is intentional — it tells
            // a future engineer where to find the rationale.
            expect(src).toMatch(
                /export type NodeShape\s*=\s*['"]rect['"]\s*\|\s*['"]note['"]/,
            );
        });

        it("decision kind moves onto the rect chassis", () => {
            const start = src.indexOf("decision: {");
            expect(start).toBeGreaterThan(0);
            const slice = src.slice(start, start + 1200);
            expect(slice).toMatch(/shape:\s*['"]rect['"]/);
            // No regression — diamond MUST NOT come back here.
            expect(slice).not.toMatch(/shape:\s*['"]diamond['"]/);
        });

        it("subtle accent drops border-dashed (no more dashed-border kinds)", () => {
            // The accent table no longer adds `border-dashed` to the
            // subtle treatment. External / annotation now render
            // with the same quiet solid border as every other rect.
            expect(src).toMatch(
                /subtle:\s*['"]border-border-subtle['"]\s*,/,
            );
            expect(src).not.toMatch(
                /subtle:\s*['"]border-border-subtle border-dashed['"]/,
            );
        });
    });

    describe("renderer", () => {
        const src = read("src/components/processes/ProcessTypedNode.tsx");

        it("retires the diamond branch entirely", () => {
            // Three signs the diamond branch is gone:
            //   1. No `meta.shape === "diamond"` predicate
            //   2. No `rotate-45` (the rotated body)
            //   3. No DIAMOND_SIZE table
            expect(src).not.toMatch(/meta\.shape\s*===\s*['"]diamond['"]/);
            expect(src).not.toMatch(/rotate-45/);
            expect(src).not.toMatch(/DIAMOND_SIZE\s*=/);
        });

        it("introduces the per-kind corner-sticker affordance", () => {
            // Decision → "?", External → "EXT". Both via the same
            // `data-process-node-sticker` slot.
            expect(src).toMatch(
                /kind === ["']decision["'][\s\S]{0,80}\?/,
            );
            expect(src).toMatch(
                /kind === ["']external["'][\s\S]{0,80}["']EXT["']/,
            );
            expect(src).toMatch(/data-process-node-sticker/);
        });

        it("the rect chassis is now `relative` so the corner sticker can absolute-position", () => {
            // The chassis div carries `relative` to anchor the
            // top-right sticker; without it the sticker would
            // float relative to the canvas, not the node.
            // Anchor the assertion on the className string itself
            // — the chassis className must contain the magic
            // sequence "relative border transition-colors". A
            // file-wide search is cheaper than walking from any
            // particular `data-process-node` site.
            expect(src).toMatch(/"relative border transition-colors"/);
        });
    });
});
