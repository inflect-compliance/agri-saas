/**
 * Guard: auth-form autofill semantics (P3.4).
 *
 * Invariant: every password and email input rendered by an auth form
 * carries the CORRECT `autoComplete` attribute so mobile keyboards and
 * password managers behave natively:
 *
 *   - a "current password" field  → autoComplete="current-password"
 *   - a "new / confirm password"  → autoComplete="new-password"
 *   - the dual-mode login password → a mode expression that references
 *     BOTH tokens (sign-in reads current, register reads new)
 *   - every email field            → autoComplete="email"
 *
 * Why it matters: without these, iOS/Android password managers can't
 * offer to save or fill credentials, and a "new password" field wrongly
 * marked `current-password` makes the OS suggest the OLD password on a
 * reset. The correctness is CONTEXTUAL (current vs new), so the guard
 * keys off each input's stable `name=` attribute.
 *
 * How to extend: when a new auth form ships (or a field is added), add
 * the file to `AUTH_FORM_FILES`. The structural scan below then holds it
 * to the same contract. Field classification is by `name=`; if you add a
 * password field with a novel name, add it to `NEW_PASSWORD_NAMES` /
 * `CURRENT_PASSWORD_NAMES` (or it falls to the dual-mode rule).
 *
 * Mirrors the template of `tests/guardrails/hibp-coverage.test.ts`:
 * curated file list + structural scan + an in-memory mutation self-test
 * proving the detector catches a removed / wrong attribute.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Auth-form files whose password/email inputs the guard polices. */
const AUTH_FORM_FILES: ReadonlyArray<string> = [
    'src/app/login/page.tsx', // sign-in + register (dual-mode password)
    'src/app/forgot-password/page.tsx', // email only
    'src/app/reset-password/page.tsx', // newPassword + confirmPassword
    'src/app/account/security/ChangePasswordForm.tsx', // current + new + confirm
];

/** Input `name=` values that are a NEW password (autoComplete new-password). */
const NEW_PASSWORD_NAMES = new Set(['newPassword', 'confirmPassword']);
/** Input `name=` values that are a CURRENT password (autoComplete current-password). */
const CURRENT_PASSWORD_NAMES = new Set(['currentPassword']);

// ── attribute helpers ──────────────────────────────────────────────────────

// Every input in these forms is a self-closing element (`<input …/>` or the
// shared `<Input …/>` primitive). Lazily capture the attribute text of each.
// `[\s\S]*?` stops at the first `/>`; JSX arrow funcs use `=>`, never `/>`, so
// they don't terminate the match early.
const INPUT_RE = /<(?:input|Input)\b([\s\S]*?)\/>/g;

type Attr =
    | { kind: 'string'; value: string }
    | { kind: 'expr'; value: string }
    | { kind: 'none' };

function readAttr(attrs: string, name: string): Attr {
    const str = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
    if (str) return { kind: 'string', value: str[1] };
    const expr = new RegExp(`\\b${name}\\s*=\\s*\\{([\\s\\S]*?)\\}`).exec(attrs);
    if (expr) return { kind: 'expr', value: expr[1] };
    return { kind: 'none' };
}

// ── detector ────────────────────────────────────────────────────────────────

interface Violation {
    file: string;
    detail: string;
}

/**
 * Scan one file's source for auth-form password/email inputs missing or
 * carrying a wrong `autoComplete`. Returns a list of human-readable
 * violations (empty === clean).
 */
export function findAutofillViolations(file: string, content: string): Violation[] {
    const violations: Violation[] = [];
    let m: RegExpExecArray | null;
    INPUT_RE.lastIndex = 0;
    while ((m = INPUT_RE.exec(content)) !== null) {
        const attrs = m[1];
        const type = readAttr(attrs, 'type');
        const name = readAttr(attrs, 'name');
        const ac = readAttr(attrs, 'autoComplete');
        const nameVal = name.kind === 'string' ? name.value : '';
        const label = nameVal || '(unnamed)';

        const isPassword = type.kind === 'string' && type.value === 'password';
        const isEmail = type.kind === 'string' && type.value === 'email';
        if (!isPassword && !isEmail) continue;

        if (ac.kind === 'none') {
            violations.push({
                file,
                detail: `input name="${label}" is missing an autoComplete attribute`,
            });
            continue;
        }

        if (isEmail) {
            if (!(ac.kind === 'string' && ac.value === 'email')) {
                violations.push({
                    file,
                    detail: `email input name="${label}" must be autoComplete="email"`,
                });
            }
            continue;
        }

        // Password field — correctness is contextual, keyed off `name`.
        if (CURRENT_PASSWORD_NAMES.has(nameVal)) {
            if (!(ac.kind === 'string' && ac.value === 'current-password')) {
                violations.push({
                    file,
                    detail: `password input name="${label}" must be autoComplete="current-password"`,
                });
            }
        } else if (NEW_PASSWORD_NAMES.has(nameVal)) {
            if (!(ac.kind === 'string' && ac.value === 'new-password')) {
                violations.push({
                    file,
                    detail: `password input name="${label}" must be autoComplete="new-password"`,
                });
            }
        } else {
            // Dual-mode / unknown password field: the value must reference a
            // recognised credential token. A single-mode field should be a
            // string literal of one token; a mode-switching field is an
            // expression referencing BOTH.
            const refsCurrent = ac.value.includes('current-password');
            const refsNew = ac.value.includes('new-password');
            if (ac.kind === 'string') {
                if (!(refsCurrent || refsNew)) {
                    violations.push({
                        file,
                        detail: `password input name="${label}" has autoComplete="${ac.value}" — expected current-password or new-password`,
                    });
                }
            } else if (!(refsCurrent && refsNew)) {
                // An expression that only picks one token can't be right for a
                // field the classifier couldn't statically pin down.
                violations.push({
                    file,
                    detail: `password input name="${label}" uses a mode expression that must reference BOTH current-password and new-password`,
                });
            }
        }
    }
    return violations;
}

function loadFile(rel: string): string {
    const abs = path.join(REPO_ROOT, rel);
    return fs.readFileSync(abs, 'utf8');
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('auth-form autofill guard', () => {
    it('every curated auth form file exists', () => {
        for (const file of AUTH_FORM_FILES) {
            expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
        }
    });

    it('every auth-form password/email input carries the correct autoComplete', () => {
        const all: Violation[] = [];
        for (const file of AUTH_FORM_FILES) {
            all.push(...findAutofillViolations(file, loadFile(file)));
        }
        if (all.length > 0) {
            const report = all.map((v) => `  - ${v.file}: ${v.detail}`).join('\n');
            throw new Error(
                `auth-form autofill violations found:\n${report}\n\n` +
                    'Add the correct autoComplete (current-password / new-password / email) to each field.',
            );
        }
        expect(all).toHaveLength(0);
    });

    it('each curated file actually contains a password or email input (scan is live)', () => {
        for (const file of AUTH_FORM_FILES) {
            const content = loadFile(file);
            const hasField = /type\s*=\s*"(?:password|email)"/.test(content);
            expect(hasField).toBe(true);
        }
    });

    // ── mutation self-tests: prove the detector actually catches regressions ──

    it('detects a password input whose autoComplete was removed', () => {
        const mutated =
            '<Input type="password" name="newPassword" value={x} required />';
        const v = findAutofillViolations('mutant.tsx', mutated);
        expect(v).toHaveLength(1);
        expect(v[0].detail).toMatch(/missing an autoComplete/);
    });

    it('detects a new-password field mislabelled current-password', () => {
        const mutated =
            '<Input type="password" name="newPassword" autoComplete="current-password" />';
        const v = findAutofillViolations('mutant.tsx', mutated);
        expect(v).toHaveLength(1);
        expect(v[0].detail).toMatch(/must be autoComplete="new-password"/);
    });

    it('detects an email input missing autoComplete="email"', () => {
        const mutated = '<Input type="email" name="email" autoComplete="username" />';
        const v = findAutofillViolations('mutant.tsx', mutated);
        expect(v).toHaveLength(1);
        expect(v[0].detail).toMatch(/must be autoComplete="email"/);
    });

    it('accepts a correctly-annotated set of fields', () => {
        const good = [
            '<Input type="password" name="currentPassword" autoComplete="current-password" />',
            '<Input type="password" name="newPassword" autoComplete="new-password" />',
            '<input type="email" name="email" autoComplete="email" />',
            `<input type="password" name="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />`,
        ].join('\n');
        expect(findAutofillViolations('good.tsx', good)).toHaveLength(0);
    });
});
