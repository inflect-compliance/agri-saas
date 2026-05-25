/**
 * R31 — Capstone (round close-out).
 *
 * Locks the inventory of artefacts shipped across R31's eight
 * design-refinement bundles so a future PR cannot silently drop
 * one of the per-bundle ratchets or the round implementation
 * note.
 *
 * Pattern mirrors the canonical round-capstone tests
 * (`r26-prf-capstone.test.ts`, `r27-prf-capstone.test.ts`,
 * `r29-multi-select-perf-collab.test.ts` capstone block).
 * Same shape: file-existence checks + a written supersession
 * trail. The bundle PR descriptions carry the granular
 * per-bundle contracts; THIS ratchet just locks "the round
 * happened, and these are its artefacts".
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/**
 * Eight per-bundle ratchets — one per shipped design item. Each
 * file documents its bundle's scope + assertions in detail.
 */
const R31_BUNDLE_RATCHETS = [
    "tests/guards/r31-background-and-empty-state.test.ts", // Bundle 1
    "tests/guards/r31-node-geometry.test.ts",              // Bundle 2
    "tests/guards/r31-document-bar.test.ts",               // Bundle 3
    "tests/guards/r31-left-palette.test.ts",               // Bundle 4
    "tests/guards/r31-inspector-asidepanel.test.ts",       // Bundle 5
    "tests/guards/r31-minimap-zoom.test.ts",               // Bundle 6
    "tests/guards/r31-edge-label-chip.test.ts",            // Bundle 7
    "tests/guards/r31-command-palette.test.ts",            // Bundle 8
];

describe("R31 — round capstone", () => {
    it("every per-bundle ratchet ships in the same round", () => {
        for (const file of R31_BUNDLE_RATCHETS) {
            expect(exists(file)).toBe(true);
        }
    });

    it("the round implementation note ships alongside the code", () => {
        expect(
            exists(
                "docs/implementation-notes/2026-05-25-r31-design-refinement.md",
            ),
        ).toBe(true);
    });

    it("the implementation note documents every bundle", () => {
        // The deliverables table is the canonical "what shipped"
        // record. Each bundle row carries its PR number and the
        // roadmap item it closed. If a bundle gets retired
        // without a written supersession in the note, this
        // assertion fails.
        const note = fs.readFileSync(
            path.join(
                ROOT,
                "docs/implementation-notes/2026-05-25-r31-design-refinement.md",
            ),
            "utf8",
        );
        for (let bundle = 1; bundle <= 8; bundle += 1) {
            // Each row in the deliverables table starts with the
            // bundle number in bold.
            expect(note).toMatch(new RegExp(`\\*\\*${bundle}\\*\\*`));
        }
    });

    it("the deferred-to-R32 work is explicitly called out", () => {
        // PR 5 (selection-aware emphasis) + PR 10 (decomposition)
        // are the two slices held for the next round. Their
        // explicit mention in the note is what makes "deferred"
        // a deliberate decision rather than a forgotten gap.
        const note = fs.readFileSync(
            path.join(
                ROOT,
                "docs/implementation-notes/2026-05-25-r31-design-refinement.md",
            ),
            "utf8",
        );
        expect(note).toMatch(/Deferred to R32/);
        expect(note).toMatch(/selection-aware emphasis/);
        expect(note).toMatch(/decomposition/);
    });
});
