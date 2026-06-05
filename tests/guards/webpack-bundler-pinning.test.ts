/**
 * Ratchet: production is built with webpack, not Next 16's default
 * Turbopack.
 *
 * Why this is load-bearing: the strict production CSP (`script-src`
 * 'nonce-…' 'strict-dynamic', no 'unsafe-eval') needs the bundler runtime
 * to put the nonce on every dynamically-loaded chunk. Webpack does (via
 * `__webpack_nonce__` → `script.setAttribute('nonce', …)`); Turbopack's
 * runtime sets no nonce and relies on strict-dynamic propagation, which
 * left some dynamic chunks blocked by `script-src-elem`. A silent revert
 * to Turbopack (dropping `--webpack`) would reintroduce that console
 * violation, so every `next build` invocation must carry `--webpack`.
 *
 * See docs/implementation-notes/2026-06-05-csp-webpack-bundler.md.
 */
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');

function read(rel: string): string {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

// Every file that invokes `next build` for a production artifact, and the
// exact number of invocations each must contain (so a NEW bare
// `next build` can't slip in alongside the pinned ones).
const BUILD_SITES: ReadonlyArray<{ file: string; count: number }> = [
    { file: 'Dockerfile', count: 1 },
    { file: 'package.json', count: 1 },
    { file: '.github/workflows/ci.yml', count: 3 },
    { file: 'scripts/e2e-local.mjs', count: 1 },
    { file: 'scripts/ci-local.mjs', count: 1 },
];

// Matches a `next build` INVOCATION (prefixed by `npx ` or `&& `, the two
// shapes used here) — NOT a prose/comment mention of "next build" — and
// captures the rest of the line so we can assert `--webpack` is present.
const NEXT_BUILD_RE = /(?:npx |&& )next build\b([^\n]*)/g;

describe('webpack bundler pinning', () => {
    for (const { file, count } of BUILD_SITES) {
        it(`${file} invokes \`next build --webpack\` (${count}×) and never bare`, () => {
            const src = read(file);
            const matches = [...src.matchAll(NEXT_BUILD_RE)];
            expect(matches).toHaveLength(count);
            for (const m of matches) {
                // The remainder of the `next build …` line must contain --webpack.
                expect(m[1]).toMatch(/--webpack\b/);
                expect(m[1]).not.toMatch(/--turbopack\b/);
            }
        });
    }

    it('no production build site silently re-enables Turbopack', () => {
        for (const { file } of BUILD_SITES) {
            expect(read(file)).not.toMatch(/next build[^\n]*--turbopack/);
        }
    });
});
