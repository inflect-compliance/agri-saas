/**
 * Epic 51 — Admin page theme toggle + token migration guard.
 *
 * Verifies:
 *   1. The admin page has a ThemeToggle component
 *   2. The token migration codemod reduced hard-coded colors dramatically
 *   3. A ratchet prevents raw Tailwind colors from creeping back
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../src');
const APP_PAGES = path.resolve(SRC, 'app/t/[tenantSlug]/(app)');

function read(...segments: string[]): string {
    return fs.readFileSync(path.join(SRC, ...segments), 'utf-8');
}

function countPattern(dir: string, pattern: RegExp, ext = '.tsx'): number {
    let count = 0;
    function walk(d: string) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(ext)) {
                const content = fs.readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                for (const line of lines) {
                    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('import')) continue;
                    if (/color:\s*['"]#/.test(line)) continue; // SVG/chart literals
                    const matches = line.match(pattern);
                    if (matches) count += matches.length;
                }
            }
        }
    }
    walk(dir);
    return count;
}

// ── Theme toggle on admin page ────────────────────────────────────

describe('Admin page theme toggle', () => {
    const src = read('app/t/[tenantSlug]/(app)/admin/page.tsx');

    it('imports ThemeToggle from the theme module', () => {
        expect(src).toContain("from '@/components/theme/ThemeToggle'");
    });

    it('renders a ThemeToggle with id="admin-theme-toggle"', () => {
        expect(src).toContain('<ThemeToggle');
        expect(src).toContain('id="admin-theme-toggle"');
    });

    it('has a visible theme section with a label', () => {
        expect(src).toContain('id="admin-theme-section"');
        expect(src).toContain('Theme');
    });
});

// ── Token migration ratchet ───────────────────────────────────────

describe('Token migration ratchet', () => {
    const RAW_SLATE_RE = /\b(?:text|bg|border|hover:bg|hover:text|divide|ring)-slate-\d{2,3}\b/g;
    const TEXT_WHITE_RE = /\btext-white\b/g;

    it('raw slate-* color usage in app pages is below the baseline', () => {
        const count = countPattern(APP_PAGES, RAW_SLATE_RE);
        // After codemod: should be very low (edge cases in charts, SVG, etc.)
        expect(count).toBeLessThanOrEqual(25);
    });

    it('text-white usage in app pages is below the baseline', () => {
        const count = countPattern(APP_PAGES, TEXT_WHITE_RE);
        // All mapped to text-content-emphasis
        expect(count).toBeLessThanOrEqual(10);
    });

    it('combined raw color count tracks total debt', () => {
        const slateCount = countPattern(APP_PAGES, RAW_SLATE_RE);
        const whiteCount = countPattern(APP_PAGES, TEXT_WHITE_RE);
        const total = slateCount + whiteCount;
        // Combined baseline — this number should only go down
        expect(total).toBeLessThanOrEqual(35);
    });
});

// ── Semantic token adoption ───────────────────────────────────────

describe('Semantic token adoption', () => {
    const SEMANTIC_RE = /\b(?:text-content|bg-bg|border-border)-(?:emphasis|default|muted|subtle|elevated|page|inverted)\b/g;

    it('app pages use semantic tokens extensively', () => {
        const count = countPattern(APP_PAGES, SEMANTIC_RE);
        // After codemod: should be 800+ (replacing the former hard-coded values)
        expect(count).toBeGreaterThanOrEqual(500);
    });
});

// ── Token system integrity ────────────────────────────────────────

describe('Token system integrity', () => {
    it('tokens.css defines both dark and light theme tokens', () => {
        const css = fs.readFileSync(path.join(SRC, 'styles/tokens.css'), 'utf-8');
        expect(css).toContain(':root');
        expect(css).toContain('[data-theme="light"]');
        // Light mode should define at least the same number of surface tokens
        expect(css).toContain('--bg-page');
        expect(css).toContain('--content-emphasis');
        expect(css).toContain('--border-default');
    });

    it('defines the "sunlight" high-contrast overlay on top of the light theme', () => {
        // feat/delight-personality — the outdoor palette is the light theme
        // plus a [data-contrast="high"] overlay (the provider sets
        // data-theme="light" + data-contrast="high" together), so it inherits
        // every light token and only the contrast overrides apply. Keeping it
        // an overlay (not a third [data-theme] block) preserves the dark+light
        // token invariant the other theme guards rely on.
        const css = fs.readFileSync(path.join(SRC, 'styles/tokens.css'), 'utf-8');
        expect(css).toContain('[data-contrast="high"]');

        const start = css.indexOf('[data-contrast="high"]');
        const open = css.indexOf('{', start);
        const close = css.indexOf('\n}', open);
        const body = css.slice(open, close);
        // The overlay must push the key surfaces to maximum contrast.
        for (const tok of ['--bg-default', '--content-emphasis', '--border-default']) {
            expect(body).toContain(tok);
        }
        // It must be declared AFTER [data-theme="light"] so it wins on cascade.
        expect(css.indexOf('[data-contrast="high"]')).toBeGreaterThan(
            css.indexOf('[data-theme="light"]'),
        );
    });

    it('tailwind.config maps semantic tokens to utility classes', () => {
        const config = fs.readFileSync(
            path.join(__dirname, '../../tailwind.config.js'), 'utf-8'
        );
        expect(config).toContain("'var(--bg-default)'");
        expect(config).toContain("'var(--content-emphasis)'");
        expect(config).toContain("'var(--border-default)'");
    });
});
