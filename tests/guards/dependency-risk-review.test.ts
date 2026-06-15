/**
 * Dependency risk-review ratchet.
 *
 * `docs/dependency-risk-review.md` is a periodic security review of
 * dependencies with CVE-active history or a large blast radius. The
 * review verdict for each package is: which `package.json` section
 * it belongs in, and which major it must stay on.
 *
 * This guard locks that verdict structurally. If a future change:
 *
 *   - moves a reviewed runtime package into `devDependencies`
 *     (the `Dockerfile`'s `npm prune --omit=dev` would strip it
 *     from the production image → prod crash CI can't catch), or
 *   - drops a reviewed package entirely, or
 *   - downgrades it below the reviewed major,
 *
 * the guard fails and points the author back at the review doc.
 *
 * It does NOT pin exact versions — in-major patch/minor bumps stay
 * free. It only enforces the section + the major floor, which is
 * the part the review actually reasoned about.
 *
 * When a new package is audited, add it to REVIEWED in the same
 * diff that adds its section to docs/dependency-risk-review.md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

/**
 * The reviewed runtime dependencies, with the major they must stay
 * on. Section is always `dependencies` — every entry here was proven
 * to be runtime-needed in docs/dependency-risk-review.md, so moving
 * any to devDependencies is a production-image regression.
 */
const REVIEWED: Record<string, { major: number }> = {
    'js-yaml': { major: 4 },
    jszip: { major: 3 },
    pdfkit: { major: 0 },
    nodemailer: { major: 9 },
};

/** Major of a caret/tilde/plain semver range (`^8.0.7` → 8). */
function rangeMajor(range: string): number {
    const m = range.match(/(\d+)\./);
    if (!m) throw new Error(`unparseable version range: ${range}`);
    return Number(m[1]);
}

describe('dependency risk review — reviewed packages stay classified', () => {
    for (const [name, { major }] of Object.entries(REVIEWED)) {
        it(`${name} stays a runtime dependency`, () => {
            expect(pkg.dependencies?.[name]).toBeDefined();
            // Must NOT have leaked into devDependencies — npm prune
            // --omit=dev in the Dockerfile would strip it from prod.
            expect(pkg.devDependencies?.[name]).toBeUndefined();
        });

        it(`${name} stays on its reviewed major (${major})`, () => {
            const range = pkg.dependencies?.[name];
            expect(range).toBeDefined();
            expect(rangeMajor(range as string)).toBe(major);
        });
    }

    it('the review doc exists alongside this guard', () => {
        expect(
            fs.existsSync(path.join(ROOT, 'docs/dependency-risk-review.md')),
        ).toBe(true);
    });
});
