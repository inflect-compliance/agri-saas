/**
 * Guardrail: HIBP coverage — password-handling routes.
 *
 * Invariant: every API route that ingests a user-chosen password MUST
 * import AND call `checkPasswordAgainstHIBP` from
 * `@/lib/security/password-check`. Skipping the call would allow a
 * breached password to be accepted by the API, defeating Epic A.3's
 * breach-screening protection.
 *
 * Failure mode: the test prints the exact file and password field that
 * slipped through, so the contributor knows exactly where to wire the
 * call in.
 *
 * How to extend: when a new password-accepting route ships (password
 * change, reset, recovery, admin-set, …):
 *   1. Import `checkPasswordAgainstHIBP` from
 *      `@/lib/security/password-check` in that route file.
 *   2. Await the call before persisting the password hash.
 *   3. Add an entry to `HIBP_REQUIRED_ROUTES` below with the file path
 *      and the Zod field name so failures are self-documenting.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

const HIBP_REQUIRED_ROUTES: ReadonlyArray<{
    /** Path relative to repo root. */
    file: string;
    /** Which password field this route accepts (for self-documenting failures). */
    field: string;
}> = [
    {
        file: 'src/app/api/auth/register/route.ts',
        field: 'password',
    },
    {
        file: 'src/app/api/auth/change-password/route.ts',
        field: 'newPassword',
    },
    {
        file: 'src/app/api/auth/reset-password/route.ts',
        field: 'newPassword',
    },
    // Future password-change / reset / recovery routes add themselves here.
];

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Import-presence regex.
 * Matches a static ES import of `checkPasswordAgainstHIBP` from the
 * canonical module path. A comment that merely mentions the name does NOT
 * match because it won't start with optional-whitespace + `import`.
 */
const IMPORT_RE =
    /^\s*import\s+\{[^}]*\bcheckPasswordAgainstHIBP\b[^}]*\}\s+from\s+['"]@\/lib\/security\/password-check['"]/m;

/**
 * Call-site regex.
 * Matches `checkPasswordAgainstHIBP(` anywhere in the file (after the
 * import line has been stripped), confirming the function is actually
 * invoked rather than dead-imported.
 */
const CALL_RE = /\bcheckPasswordAgainstHIBP\s*\(/;

/**
 * Password-field heuristic.
 * Detects Zod schema fields whose name looks like a password input.
 * Captures the field name for diagnostic messages.
 */
const PASSWORD_FIELD_RE =
    /\b(password|newPassword|currentPassword|confirmPassword)\s*:\s*z\./g;

function walkRouteFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkRouteFiles(full));
        } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
            out.push(full);
        }
    }
    return out;
}

function hasImport(src: string): boolean {
    return IMPORT_RE.test(src);
}

function hasCall(src: string): boolean {
    // Strip the import line first so the import itself doesn't count as a call.
    const importMatch = src.match(IMPORT_RE);
    const stripped = importMatch ? src.replace(importMatch[0], '') : src;
    return CALL_RE.test(stripped);
}

// ── Test 1 — curated list integrity ───────────────────────────────────────

describe('HIBP coverage guardrail — curated list integrity', () => {
    it('HIBP_REQUIRED_ROUTES is non-empty (sanity)', () => {
        expect(HIBP_REQUIRED_ROUTES.length).toBeGreaterThan(0);
    });

    test.each(HIBP_REQUIRED_ROUTES.map((r) => [r.file, r] as const))(
        '%s exists, imports, and calls checkPasswordAgainstHIBP',
        (relPath, entry) => {
            const abs = path.join(REPO_ROOT, relPath);
            expect(fs.existsSync(abs)).toBe(true);

            const src = fs.readFileSync(abs, 'utf8');

            if (!hasImport(src)) {
                throw new Error(
                    [
                        `Route missing checkPasswordAgainstHIBP import.`,
                        ``,
                        `  File:  ${relPath}`,
                        `  Field: ${entry.field}`,
                        `  Add:   import { checkPasswordAgainstHIBP } from '@/lib/security/password-check';`,
                    ].join('\n'),
                );
            }

            if (!hasCall(src)) {
                throw new Error(
                    [
                        `Route imports checkPasswordAgainstHIBP but never calls it.`,
                        ``,
                        `  File:  ${relPath}`,
                        `  Field: ${entry.field}`,
                        ``,
                        `A dangling import is a silent bypass. Await the call before`,
                        `hashing the password, then re-run this test.`,
                    ].join('\n'),
                );
            }
        },
    );
});

// ── Test 2 — structural scan ───────────────────────────────────────────────

describe('HIBP coverage guardrail — structural scan', () => {
    it('every route.ts that parses a password field is registered', () => {
        const apiDir = path.join(REPO_ROOT, 'src/app/api');
        const allRoutes = walkRouteFiles(apiDir);
        const registeredFiles = new Set(
            HIBP_REQUIRED_ROUTES.map((r) => path.join(REPO_ROOT, r.file)),
        );

        const violations: string[] = [];

        for (const absFile of allRoutes) {
            const src = fs.readFileSync(absFile, 'utf8');
            const matches = [...src.matchAll(PASSWORD_FIELD_RE)];
            if (matches.length === 0) continue;

            if (!registeredFiles.has(absFile)) {
                const fieldNames = [...new Set(matches.map((m) => m[1]))].join(', ');
                const rel = path.relative(REPO_ROOT, absFile);
                violations.push(
                    `Route \`${rel}\` parses a password field \`${fieldNames}\` but is not` +
                        ` registered in HIBP_REQUIRED_ROUTES. Add an entry so the HIBP check is` +
                        ` enforced on this route, or document why it's exempt.`,
                );
            }
        }

        if (violations.length > 0) {
            throw new Error(violations.join('\n\n'));
        }
    });
});

// ── Test 3 — regression proof ──────────────────────────────────────────────

describe('HIBP coverage guardrail — regression proof', () => {
    it('guardrail catches a mutated register/route.ts that lacks the HIBP import/call', () => {
        const entry = HIBP_REQUIRED_ROUTES.find(
            (r) => r.file === 'src/app/api/auth/register/route.ts',
        );
        expect(entry).toBeDefined();

        const abs = path.join(REPO_ROOT, entry!.file);
        const realSrc = fs.readFileSync(abs, 'utf8');

        // Strip the import line and any call site — simulate a PR that forgot both.
        const importMatch = realSrc.match(IMPORT_RE);
        const mutated = importMatch
            ? realSrc.replace(importMatch[0], '').replace(CALL_RE, '/* hibp-removed */')
            : realSrc.replace(CALL_RE, '/* hibp-removed */');

        // The helpers MUST flag the mutated copy.
        expect(hasImport(mutated)).toBe(false);
        expect(hasCall(mutated)).toBe(false);

        // And confirm the real file still passes (self-check).
        expect(hasImport(realSrc)).toBe(true);
        expect(hasCall(realSrc)).toBe(true);
    });
});
