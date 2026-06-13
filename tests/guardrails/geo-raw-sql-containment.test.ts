/**
 * Guardrail: PostGIS `ST_*` SQL is contained in src/lib/db/geo.ts.
 *
 * `Parcel.geometry` is a Prisma `Unsupported(...)` column, so all
 * spatial reads/writes are raw SQL. Containing every `ST_*` fragment in
 * one audited file (geo.ts) keeps the spatial surface reviewable and
 * stops ad-hoc geometry SQL from scattering through usecases/repos.
 *
 * Any new geometry SQL must use the typed helpers exported from
 * `@/lib/db/geo` (geometrySql, areaHectaresSql, asGeoJsonSql, col).
 *
 * Comments/docstrings that merely *mention* ST_* are fine — they are
 * stripped before scanning so design docs can reference the functions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const SRC_DIR = path.resolve(__dirname, '../../src');
const GEO_FILE = 'lib/db/geo.ts';
const ST_PATTERN = /\bST_[A-Za-z]/;

/** Blank out block comments (newline-preserving) and trailing/line `//` comments. */
function stripComments(src: string): string {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return noBlock
        .split('\n')
        .map((line) => {
            const idx = line.indexOf('//');
            // keep `https://`-style sequences (not a comment)
            if (idx >= 0 && line[idx - 1] !== ':') return line.slice(0, idx);
            return line;
        })
        .join('\n');
}

describe('Guardrail: PostGIS ST_* SQL is contained in src/lib/db/geo.ts', () => {
    it('no raw ST_* appears outside src/lib/db/geo.ts', async () => {
        const files = await glob('**/*.{ts,tsx}', { cwd: SRC_DIR, posix: true });
        const violations: string[] = [];

        for (const rel of files) {
            if (rel === GEO_FILE) continue;
            if (rel.endsWith('.d.ts')) continue;
            const code = stripComments(fs.readFileSync(path.join(SRC_DIR, rel), 'utf-8'));
            code.split('\n').forEach((line, i) => {
                if (ST_PATTERN.test(line)) {
                    violations.push(`src/${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
                }
            });
        }

        if (violations.length > 0) {
            throw new Error(
                'Raw ST_* SQL found outside src/lib/db/geo.ts. Route all PostGIS through the ' +
                'typed helpers in @/lib/db/geo (geometrySql / areaHectaresSql / asGeoJsonSql / col):\n' +
                violations.map((v) => `  ${v}`).join('\n'),
            );
        }
    });

    it('geo.ts itself contains ST_* (guards against the helper file moving or emptying)', () => {
        const content = fs.readFileSync(path.join(SRC_DIR, GEO_FILE), 'utf-8');
        expect(ST_PATTERN.test(content)).toBe(true);
    });
});
