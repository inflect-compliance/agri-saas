/**
 * Guardrail: deploy/env.prod.example stays in parity with src/env.ts.
 *
 * The deploy doc (deploy/env.prod.example) is the keys-only companion an
 * operator fills in on the VM. If a new REQUIRED-in-production env var lands in
 * src/env.ts but never reaches the example, the first anyone learns of it is a
 * prod boot crash. This test derives the required set straight from the live
 * schema source and fails CI if the example is missing any of them.
 *
 * "Required in production" =
 *   • a server var with neither `.optional()` nor `.default(...)` (always
 *     required), OR
 *   • one of the vars that is optional-shaped in the schema but enforced in
 *     production by a `NODE_ENV`-gated superRefine / a non-Vercel ternary
 *     (`ALSO_REQUIRED_IN_PROD` — a small, reviewed list).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const ENV_TS = fs.readFileSync(path.join(ROOT, 'src/env.ts'), 'utf8');
const EXAMPLE = fs.readFileSync(path.join(ROOT, 'deploy/env.prod.example'), 'utf8');

// Optional-shaped in the schema but prod-required via a NODE_ENV superRefine
// (REDIS_URL, DATA_ENCRYPTION_KEY) or a non-Vercel ternary (NEXTAUTH_URL,
// AUTH_URL). A new prod-conditional var must be added here in the same PR.
const ALSO_REQUIRED_IN_PROD = ['REDIS_URL', 'DATA_ENCRYPTION_KEY', 'NEXTAUTH_URL', 'AUTH_URL'];

function serverBlock(src: string): string {
    const start = src.indexOf('server: {');
    if (start < 0) throw new Error('could not locate server block in src/env.ts');
    // Bound at whichever section follows the server block first.
    const candidates = ['\n    client:', '\n    runtimeEnv', 'experimental__runtimeEnv']
        .map((m) => src.indexOf(m, start))
        .filter((i) => i > 0);
    const end = candidates.length ? Math.min(...candidates) : src.length;
    return src.slice(start, end);
}

function requiredServerVars(src: string): string[] {
    const block = serverBlock(src);
    // Server vars are declared at an 8-space indent as `NAME: z...`.
    const re = /\n {8}([A-Z][A-Z0-9_]*):\s*z/g;
    const matches = [...block.matchAll(re)];
    const required = new Set<string>();
    for (let i = 0; i < matches.length; i++) {
        const name = matches[i][1];
        const from = matches[i].index ?? 0;
        const to = i + 1 < matches.length ? (matches[i + 1].index ?? block.length) : block.length;
        const text = block.slice(from, to);
        const isOptional = text.includes('.optional()');
        const hasDefault = text.includes('.default(');
        if ((!isOptional && !hasDefault) || ALSO_REQUIRED_IN_PROD.includes(name)) {
            required.add(name);
        }
    }
    return [...required].sort();
}

function exampleKeys(src: string): Set<string> {
    const keys = new Set<string>();
    for (const line of src.split(/\r?\n/)) {
        const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
        if (m) keys.add(m[1]);
    }
    return keys;
}

describe('deploy/env.prod.example parity with src/env.ts', () => {
    const required = requiredServerVars(ENV_TS);
    const keys = exampleKeys(EXAMPLE);

    it('derives a non-trivial required set (sanity)', () => {
        expect(required.length).toBeGreaterThanOrEqual(8);
        // Anchor a few load-bearing ones so a parse regression is caught.
        expect(required).toEqual(
            expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'DATA_ENCRYPTION_KEY', 'AUTH_SECRET']),
        );
    });

    it.each(required)('deploy/env.prod.example lists prod-required var %s', (name) => {
        expect(keys.has(name)).toBe(true);
    });
});

describe('deploy shell scripts parse cleanly (bash -n)', () => {
    it.each(['deploy/apply.sh', 'deploy/check-drift.sh'])('%s has no syntax errors', (rel) => {
        const res = spawnSync('bash', ['-n', path.join(ROOT, rel)], { encoding: 'utf8' });
        expect(res.stderr || '').toBe('');
        expect(res.status).toBe(0);
    });
});
