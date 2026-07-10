/**
 * No-new-hardcoded-UI-string ratchet (i18n forward-enforcement).
 *
 * Key-PARITY between en.json and bg.json is already enforced
 * (`tests/guardrails/i18n-completeness.test.ts` + `scripts/i18n-diff.mjs`).
 * But parity is blind to the drift that let the catalog fall behind in the
 * first place: a NEW user-facing string that is hard-coded in JSX and never
 * becomes a key at all. Parity stays green while the string bypasses i18n.
 *
 * This ratchet closes that gap — the same shape as the `as any` down-ratchet
 * (`tests/guards/no-explicit-any-ratchet.test.ts`): it counts hard-coded
 * user-facing strings across `src/app` + `src/components` and caps them at
 * the current floor (`CURRENT_BASELINE`). A new hard-coded string pushes the
 * count up and fails CI; every extraction PR that wraps a string in `t()` /
 * `getTranslations()` lowers the count and must lower the baseline in the
 * same diff. A drift sentinel keeps slack from accumulating.
 *
 * Detection is AST-based (not regex) so it sees real JSX text nodes and
 * user-facing string attributes, and does NOT flag `{t('…')}` (a JSX
 * expression, not a string literal). Carve-outs live in `FILE_ALLOWLIST`
 * (each with a reason). Technical noise (all-caps enums, HTML entities,
 * className/id/href/etc. attributes) is excluded by construction.
 *
 * To LOWER the baseline after an extraction sweep: run this test, read the
 * reported actual count, set `CURRENT_BASELINE` to it (never higher).
 */
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const ROOTS = ['src/app', 'src/components'].map((d) => path.resolve(__dirname, '../../', d));

/**
 * Files that legitimately hard-code copy because next-intl is unavailable
 * or inappropriate there. Each entry carries a reason; a new entry needs one.
 */
const FILE_ALLOWLIST: { pattern: RegExp; reason: string }[] = [
    { pattern: /(^|\/)error\.tsx$/, reason: 'React error boundary — renders below the intl provider; must not depend on it' },
    { pattern: /(^|\/)global-error\.tsx$/, reason: 'Root error boundary — replaces the whole tree incl. the intl provider' },
    { pattern: /(^|\/)not-found\.tsx$/, reason: 'Next not-found boundary — may render outside the locale segment' },
];

/** JSX attributes whose STRING value is shown to the user (so a literal is a
 *  missed translation). Deliberately narrow — className/id/href/type/role/
 *  name/key/data-* are structural, not copy, and are never flagged. */
const USER_FACING_PROPS = new Set([
    'title', 'placeholder', 'aria-label', 'alt', 'label', 'tooltip',
    'confirmLabel', 'cancelLabel', 'searchPlaceholder', 'emptyMessage',
    'heading', 'subtitle', 'description',
]);

/** Current floor (measured 2026-07-10). Can only go DOWN as strings are
 *  extracted to the catalog — every extraction PR lowers this in the same diff. */
const CURRENT_BASELINE = 121;

/** A string counts as user-facing copy if — after stripping HTML entities —
 *  it has a real word (≥2 latin letters) and is not an ALL-CAPS enum/acronym
 *  (SOC, ALE, WYSIWYG) or a lone symbol. Same test for JSX text + attributes. */
function isUserFacingCopy(raw: string): boolean {
    const decoded = raw.replace(/&#?[a-zA-Z0-9]+;/g, '').trim();
    if (!/[A-Za-z]{2,}/.test(decoded)) return false; // no real word
    if (/^[A-Z0-9 ./&()-]+$/.test(decoded)) return false; // all-caps enum/acronym/label
    return true;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (/node_modules|\.next|__tests__/.test(entry.name)) continue;
            walk(full, out);
        } else if (/\.tsx$/.test(entry.name) && !/\.(test|spec|stories)\.tsx$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

interface Hit {
    file: string;
    kind: 'jsx-text' | 'attr';
    sample: string;
}

/** Count hard-coded user-facing strings in one TSX source via the TS AST. */
function scanSource(file: string, source: string): Hit[] {
    const hits: Hit[] = [];
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node)) {
            const text = node.text.trim();
            if (text && isUserFacingCopy(text)) {
                hits.push({ file, kind: 'jsx-text', sample: text.slice(0, 50) });
            }
        } else if (ts.isJsxAttribute(node) && node.name && USER_FACING_PROPS.has(node.name.getText(sf))) {
            const init = node.initializer;
            // A string LITERAL is a hard-coded value; `{t('…')}` is a
            // JsxExpression and correctly ignored.
            if (init && ts.isStringLiteral(init) && isUserFacingCopy(init.text)) {
                hits.push({ file, kind: 'attr', sample: `${node.name.getText(sf)}="${init.text.slice(0, 40)}"` });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return hits;
}

function scanAll(): Hit[] {
    const hits: Hit[] = [];
    for (const root of ROOTS) {
        for (const file of walk(root)) {
            const rel = path.relative(path.resolve(__dirname, '../../'), file);
            if (FILE_ALLOWLIST.some((a) => a.pattern.test(rel))) continue;
            hits.push(...scanSource(rel, fs.readFileSync(file, 'utf-8')));
        }
    }
    return hits;
}

describe('no-new-hardcoded-UI-string ratchet', () => {
    const hits = scanAll();

    it(`hard-coded user-facing strings stay ≤ ${CURRENT_BASELINE}`, () => {
        if (hits.length > CURRENT_BASELINE) {
            const sample = hits.slice(0, 25).map((h) => `  ${h.file} [${h.kind}]  ${h.sample}`).join('\n');
            throw new Error(
                `Hard-coded UI strings rose to ${hits.length} (baseline ${CURRENT_BASELINE}).\n` +
                    `A new user-facing string was added without going through next-intl.\n` +
                    `Wrap it with useTranslations()/getTranslations() and add the key to BOTH ` +
                    `messages/en.json AND messages/bg.json in the same PR.\n` +
                    `If it is genuinely not copy (a code token, a symbol) the detector should ` +
                    `already skip it — otherwise add a carve-out with a reason.\n\nFirst offenders:\n${sample}`,
            );
        }
        expect(hits.length).toBeLessThanOrEqual(CURRENT_BASELINE);
    });

    // Drift sentinel: the baseline must track the real count, so slack can't
    // silently accumulate. If an extraction sweep dropped the real count well
    // below the baseline, this nudges you to lower it in the same PR.
    it('baseline tracks the real count (no accumulated slack)', () => {
        expect(CURRENT_BASELINE).toBeLessThanOrEqual(hits.length + 15);
    });
});

// ─── Self-test: prove the detector actually fires ──────────────────────────
describe('hardcoded-string detector self-test', () => {
    it('flags raw JSX text', () => {
        const hits = scanSource('x.tsx', 'export const A = () => <div>Save changes</div>;');
        expect(hits.some((h) => h.kind === 'jsx-text')).toBe(true);
    });

    it('flags a user-facing string attribute', () => {
        const hits = scanSource('x.tsx', 'export const A = () => <input placeholder="Search offers" />;');
        expect(hits.some((h) => h.kind === 'attr')).toBe(true);
    });

    it('does NOT flag a t() call', () => {
        const hits = scanSource('x.tsx', "export const A = () => <div>{t('save')}</div>;");
        expect(hits).toHaveLength(0);
    });

    it('does NOT flag a t() attribute value', () => {
        const hits = scanSource('x.tsx', "export const A = () => <input placeholder={t('search')} />;");
        expect(hits).toHaveLength(0);
    });

    it('does NOT flag structural attributes or all-caps enums', () => {
        const structural = scanSource('x.tsx', 'export const A = () => <div className="flex gap-2" data-testid="row">HIGH</div>;');
        expect(structural).toHaveLength(0);
    });
});
